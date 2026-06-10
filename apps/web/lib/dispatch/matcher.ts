/**
 * Dispatch matcher — assigns the nearest available, licensed tradesperson
 * to a job request.
 *
 * Strategy:
 *   1. Try PostGIS ST_DWithin + ST_Distance for accurate geodetic matching.
 *   2. On PostGIS error, fall back to a pure-SQL haversine implementation
 *      so the feature degrades gracefully on databases without the PostGIS
 *      extension.
 *
 * Competitive differentiator (ceo_briefing): only surfaces tradespeople who
 * are *active right now* (heartbeat ≤ 2 min ago) and within a configurable
 * radius — enabling sub-60-minute response windows vs Thumbtack/Angi's
 * 24–48-hour lead-gen model.
 */

export interface DispatchJob {
  id: string;
  latitude: number;
  longitude: number;
  trade_category: string;
}

export interface MatchResult {
  tradesperson_id: string;
  distance_meters: number;
  latitude: number;
  longitude: number;
  last_ping_at: Date;
}

export interface MatcherOptions {
  /** Dispatch radius in metres. Default: 25 000 m (25 km). */
  radius_meters?: number;
  /** Ping age threshold in ms. Default: 120 000 ms (2 min). */
  active_window_ms?: number;
}

const DEFAULT_RADIUS_METERS = 25_000;
const DEFAULT_ACTIVE_WINDOW_MS = 2 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool;
  const { Pool: PgPool } = require("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

/** PostGIS query — accurate geodetic distance via ST_DWithin + ST_Distance. */
async function queryPostGIS(
  pool: ReturnType<typeof getPool>,
  job: DispatchJob,
  radiusMeters: number,
  windowSecs: number,
): Promise<MatchResult | null> {
  const sql =
    "SELECT " +
    "  dap.tradesperson_id, " +
    "  dap.latitude, " +
    "  dap.longitude, " +
    "  dap.pinged_at AS last_ping_at, " +
    "  ST_Distance( " +
    "    ST_SetSRID(ST_MakePoint(dap.longitude, dap.latitude), 4326)::geography, " +
    "    ST_SetSRID(ST_MakePoint($2,             $1),           4326)::geography  " +
    "  ) AS distance_meters " +
    "FROM dispatch_availability_pings dap " +
    "JOIN tradesperson_profiles tp ON tp.user_id = dap.tradesperson_id " +
    "WHERE dap.pinged_at > NOW() - ($3 * INTERVAL '1 second') " +
    "  AND tp.license_category  = $4 " +
    "  AND tp.license_verified_at IS NOT NULL " +
    "  AND ST_DWithin( " +
    "    ST_SetSRID(ST_MakePoint(dap.longitude, dap.latitude), 4326)::geography, " +
    "    ST_SetSRID(ST_MakePoint($2,             $1),           4326)::geography, " +
    "    $5 " +
    "  ) " +
    "ORDER BY dap.tradesperson_id, dap.pinged_at DESC " +  // deduplicate within the join
    "LIMIT 1";
  // Wrap in a subquery to pick the nearest after per-tradesperson dedup
  const outer =
    "SELECT tradesperson_id, latitude, longitude, last_ping_at, distance_meters " +
    "FROM (" + sql + ") AS ranked " +
    "ORDER BY distance_meters ASC " +
    "LIMIT 1";
  const result = await pool.query(outer, [
    job.latitude,
    job.longitude,
    windowSecs,
    job.trade_category,
    radiusMeters,
  ]);
  if (!result.rows.length) return null;
  return result.rows[0] as MatchResult;
}

/** Haversine fallback — no PostGIS required; works on plain Postgres. */
async function queryHaversine(
  pool: ReturnType<typeof getPool>,
  job: DispatchJob,
  radiusMeters: number,
  windowSecs: number,
): Promise<MatchResult | null> {
  // Earth radius in metres
  const earthRadius = 6_371_000;
  // Haversine expressed in SQL using standard trig functions available in Postgres
  const distExpr =
    "(" + earthRadius + " * 2 * ASIN(SQRT(" +
    "  SIN(RADIANS((dap.latitude  - $1) / 2)) ^ 2 " +
    "  + COS(RADIANS($1)) * COS(RADIANS(dap.latitude)) " +
    "    * SIN(RADIANS((dap.longitude - $2) / 2)) ^ 2 " +
    ")))";
  const inner =
    "SELECT DISTINCT ON (dap.tradesperson_id) " +
    "  dap.tradesperson_id, " +
    "  dap.latitude, " +
    "  dap.longitude, " +
    "  dap.pinged_at AS last_ping_at, " +
    "  " + distExpr + " AS distance_meters " +
    "FROM dispatch_availability_pings dap " +
    "JOIN tradesperson_profiles tp ON tp.user_id = dap.tradesperson_id " +
    "WHERE dap.pinged_at > NOW() - ($3 * INTERVAL '1 second') " +
    "  AND tp.license_category    = $4 " +
    "  AND tp.license_verified_at IS NOT NULL " +
    "ORDER BY dap.tradesperson_id, dap.pinged_at DESC";
  const outer =
    "SELECT tradesperson_id, latitude, longitude, last_ping_at, distance_meters " +
    "FROM (" + inner + ") AS deduped " +
    "WHERE distance_meters <= $5 " +
    "ORDER BY distance_meters ASC " +
    "LIMIT 1";
  const result = await pool.query(outer, [
    job.latitude,
    job.longitude,
    windowSecs,
    job.trade_category,
    radiusMeters,
  ]);
  if (!result.rows.length) return null;
  return result.rows[0] as MatchResult;
}

/**
 * Find the nearest available tradesperson for a job.
 *
 * Tries PostGIS first for geodetically accurate results; on error (e.g.
 * PostGIS not installed) transparently retries with the haversine fallback.
 *
 * Returns `null` when no matching, active, licensed tradesperson is found
 * within the configured radius.
 */
export async function findNearestTradesperson(
  job: DispatchJob,
  opts?: MatcherOptions,
): Promise<MatchResult | null> {
  const pool = getPool();
  const radiusMeters = opts?.radius_meters ?? DEFAULT_RADIUS_METERS;
  const windowSecs = Math.ceil((opts?.active_window_ms ?? DEFAULT_ACTIVE_WINDOW_MS) / 1000);

  try {
    return await queryPostGIS(pool, job, radiusMeters, windowSecs);
  } catch (postgisErr) {
    const msg = String((postgisErr as Error).message ?? "");
    // Only fall back on PostGIS-specific errors (function unknown / extension missing)
    if (
      msg.includes("function st_dwithin") ||
      msg.includes("function st_distance") ||
      msg.includes("function st_makepoint") ||
      msg.includes("does not exist") ||
      msg.includes("geography")
    ) {
      return await queryHaversine(pool, job, radiusMeters, windowSecs);
    }
    // Any other DB error — propagate as-is
    throw postgisErr;
  }
}

/**
 * Find ALL available tradespeople within radius (not just the nearest).
 * Useful for showing a list of candidates before confirming an assignment.
 */
export async function findAvailableTradespeople(
  job: DispatchJob,
  opts?: MatcherOptions,
): Promise<MatchResult[]> {
  const pool = getPool();
  const radiusMeters = opts?.radius_meters ?? DEFAULT_RADIUS_METERS;
  const windowSecs = Math.ceil((opts?.active_window_ms ?? DEFAULT_ACTIVE_WINDOW_MS) / 1000);

  async function runPostGISAll(): Promise<MatchResult[]> {
    const sql =
      "SELECT tradesperson_id, latitude, longitude, last_ping_at, distance_meters " +
      "FROM ( " +
      "  SELECT DISTINCT ON (dap.tradesperson_id) " +
      "    dap.tradesperson_id, " +
      "    dap.latitude, " +
      "    dap.longitude, " +
      "    dap.pinged_at AS last_ping_at, " +
      "    ST_Distance( " +
      "      ST_SetSRID(ST_MakePoint(dap.longitude, dap.latitude), 4326)::geography, " +
      "      ST_SetSRID(ST_MakePoint($2,             $1),           4326)::geography  " +
      "    ) AS distance_meters " +
      "  FROM dispatch_availability_pings dap " +
      "  JOIN tradesperson_profiles tp ON tp.user_id = dap.tradesperson_id " +
      "  WHERE dap.pinged_at > NOW() - ($3 * INTERVAL '1 second') " +
      "    AND tp.license_category    = $4 " +
      "    AND tp.license_verified_at IS NOT NULL " +
      "    AND ST_DWithin( " +
      "      ST_SetSRID(ST_MakePoint(dap.longitude, dap.latitude), 4326)::geography, " +
      "      ST_SetSRID(ST_MakePoint($2,             $1),           4326)::geography, " +
      "      $5 " +
      "    ) " +
      "  ORDER BY dap.tradesperson_id, dap.pinged_at DESC " +
      ") AS ranked " +
      "ORDER BY distance_meters ASC";
    const res = await pool.query(sql, [
      job.latitude,
      job.longitude,
      windowSecs,
      job.trade_category,
      radiusMeters,
    ]);
    return res.rows as MatchResult[];
  }

  async function runHaversineAll(): Promise<MatchResult[]> {
    const earthRadius = 6_371_000;
    const distExpr =
      "(" + earthRadius + " * 2 * ASIN(SQRT(" +
      "  SIN(RADIANS((dap.latitude  - $1) / 2)) ^ 2 " +
      "  + COS(RADIANS($1)) * COS(RADIANS(dap.latitude)) " +
      "    * SIN(RADIANS((dap.longitude - $2) / 2)) ^ 2 " +
      ")))";
    const sql =
      "SELECT tradesperson_id, latitude, longitude, last_ping_at, distance_meters " +
      "FROM ( " +
      "  SELECT DISTINCT ON (dap.tradesperson_id) " +
      "    dap.tradesperson_id, dap.latitude, dap.longitude, " +
      "    dap.pinged_at AS last_ping_at, " +
      "    " + distExpr + " AS distance_meters " +
      "  FROM dispatch_availability_pings dap " +
      "  JOIN tradesperson_profiles tp ON tp.user_id = dap.tradesperson_id " +
      "  WHERE dap.pinged_at > NOW() - ($3 * INTERVAL '1 second') " +
      "    AND tp.license_category    = $4 " +
      "    AND tp.license_verified_at IS NOT NULL " +
      "  ORDER BY dap.tradesperson_id, dap.pinged_at DESC " +
      ") AS deduped " +
      "WHERE distance_meters <= $5 " +
      "ORDER BY distance_meters ASC";
    const res = await pool.query(sql, [
      job.latitude,
      job.longitude,
      windowSecs,
      job.trade_category,
      radiusMeters,
    ]);
    return res.rows as MatchResult[];
  }

  try {
    return await runPostGISAll();
  } catch (err) {
    const msg = String((err as Error).message ?? "");
    if (
      msg.includes("function st_dwithin") ||
      msg.includes("function st_distance") ||
      msg.includes("function st_makepoint") ||
      msg.includes("does not exist") ||
      msg.includes("geography")
    ) {
      return await runHaversineAll();
    }
    throw err;
  }
}
