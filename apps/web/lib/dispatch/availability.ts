/**
 * Tradesperson availability — heartbeat ping storage and retrieval.
 * Pings arrive every 60 s while the tradesperson app is open.
 * Active window: 2 min (1 missed heartbeat is tolerated).
 */

export interface AvailabilityPing {
  id: string;
  tradesperson_id: string;
  latitude: number;
  longitude: number;
  pinged_at: Date;
}

export interface RecordPingInput {
  tradesperson_id: string;
  latitude: number;
  longitude: number;
}

/** Active ping threshold — pings are sent every 60 s; 2 min allows 1 missed. */
export const ACTIVE_PING_WINDOW_MS = 2 * 60 * 1000;

/** Default dispatch radius when the caller doesn't specify one. */
export const DEFAULT_RADIUS_METERS = 25_000; // 25 km

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

/**
 * Record a tradesperson heartbeat ping.
 * Each call creates a new row; the matcher queries the most-recent row
 * per tradesperson. Returns the persisted ping.
 */
export async function recordPing(input: RecordPingInput): Promise<AvailabilityPing> {
  const pool = getPool();
  const { tradesperson_id, latitude, longitude } = input;
  const sql =
    "INSERT INTO dispatch_availability_pings " +
    "  (id, tradesperson_id, latitude, longitude, pinged_at) " +
    "VALUES (gen_random_uuid(), $1, $2, $3, NOW()) " +
    "RETURNING id, tradesperson_id, latitude, longitude, pinged_at";
  const result = await pool.query(sql, [tradesperson_id, latitude, longitude]);
  const row = (result.rows as AvailabilityPing[])[0];
  if (!row) {
    throw new Error("dispatch_availability_pings insert returned no row");
  }
  return row;
}

/**
 * Return the most-recent ping per tradesperson where the ping arrived
 * within `maxAgeMs` of now.  Defaults to ACTIVE_PING_WINDOW_MS.
 */
export async function getActivePings(maxAgeMs?: number): Promise<AvailabilityPing[]> {
  const pool = getPool();
  const windowSecs = Math.ceil((maxAgeMs ?? ACTIVE_PING_WINDOW_MS) / 1000);
  const sql =
    "SELECT DISTINCT ON (tradesperson_id) " +
    "  id, tradesperson_id, latitude, longitude, pinged_at " +
    "FROM dispatch_availability_pings " +
    "WHERE pinged_at > NOW() - ($1 * INTERVAL '1 second') " +
    "ORDER BY tradesperson_id, pinged_at DESC";
  const result = await pool.query(sql, [windowSecs]);
  return result.rows as AvailabilityPing[];
}

/**
 * Count distinct active tradespeople within a lat/lng bounding box.
 * Used by the supply-density cron to compute per-cell coverage.
 */
export async function countActivePingsInBounds(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  maxAgeMs?: number,
): Promise<number> {
  const pool = getPool();
  const windowSecs = Math.ceil((maxAgeMs ?? ACTIVE_PING_WINDOW_MS) / 1000);
  const sql =
    "SELECT COUNT(DISTINCT tradesperson_id)::int AS cnt " +
    "FROM dispatch_availability_pings " +
    "WHERE pinged_at > NOW() - ($1 * INTERVAL '1 second') " +
    "  AND latitude  BETWEEN $2 AND $3 " +
    "  AND longitude BETWEEN $4 AND $5";
  const result = await pool.query(sql, [windowSecs, minLat, maxLat, minLng, maxLng]);
  const row = result.rows[0] as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

/**
 * Return per-cell active supply counts for the given geographic grid.
 * `cellDegrees` controls granularity (default 0.5° ≈ ~55 km).
 * Returns only cells that have at least one active ping.
 */
export async function getSupplyDensityGrid(
  cellDegrees: number = 0.5,
  maxAgeMs?: number,
): Promise<Array<{ cell_lat: number; cell_lng: number; supply_count: number }>> {
  const pool = getPool();
  const windowSecs = Math.ceil((maxAgeMs ?? ACTIVE_PING_WINDOW_MS) / 1000);
  const sql =
    "SELECT " +
    "  FLOOR(latitude  / $2) * $2 AS cell_lat, " +
    "  FLOOR(longitude / $2) * $2 AS cell_lng, " +
    "  COUNT(DISTINCT tradesperson_id)::int AS supply_count " +
    "FROM dispatch_availability_pings " +
    "WHERE pinged_at > NOW() - ($1 * INTERVAL '1 second') " +
    "GROUP BY cell_lat, cell_lng " +
    "ORDER BY supply_count ASC";
  const result = await pool.query(sql, [windowSecs, cellDegrees]);
  return result.rows as Array<{ cell_lat: number; cell_lng: number; supply_count: number }>;
}

/**
 * Delete pings older than `maxAgeMs`.  Called by the supply-density cron
 * to keep the table lean.  Returns the number of deleted rows.
 */
export async function purgeOldPings(maxAgeMs: number): Promise<number> {
  const pool = getPool();
  const windowSecs = Math.ceil(maxAgeMs / 1000);
  const sql =
    "DELETE FROM dispatch_availability_pings " +
    "WHERE pinged_at < NOW() - ($1 * INTERVAL '1 second') " +
    "RETURNING id";
  const result = await pool.query(sql, [windowSecs]);
  return (result.rows as unknown[]).length;
}
