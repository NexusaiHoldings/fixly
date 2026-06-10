/**
 * Agent tool handler: match_available_tradespeople
 *
 * Queries dispatch_availability_pings within a configurable radius using
 * PostGIS ST_DWithin, applies license_category and license_verified_at
 * constraints, ranks candidates by distance and avg_rating, then writes
 * the selected tradesperson_id to dispatch_jobs.
 *
 * Autonomy = autonomous — mutation executes when called from the approved-
 * actions cron route via DOMAIN_DISPATCH (cross-boundary bridge).
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

type Args = Record<string, unknown>;

interface AvailabilityCandidate {
  tradesperson_id: string;
  distance_m: number;
  avg_rating: number | null;
  license_category: string;
  license_verified_at: string | null;
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`match_available_tradespeople: missing or invalid '${field}'`);
  }
  return v.trim();
}

function num(v: unknown, field: string): number {
  const n = Number(v);
  if (v == null || isNaN(n)) {
    throw new Error(`match_available_tradespeople: missing or invalid '${field}'`);
  }
  return n;
}

export async function handleMatchAvailableTradespeople(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  let jobId: string;
  let lat: number;
  let lng: number;
  let radiusKm: number;
  let licenseCategory: string;

  try {
    jobId = str(args.job_id, "job_id");
    lat = num(args.lat, "lat");
    lng = num(args.lng, "lng");
    const rawRadius =
      args.radius_km != null
        ? args.radius_km
        : args.radius_miles != null
          ? Number(args.radius_miles) * 1.60934
          : undefined;
    radiusKm = num(rawRadius, "radius_km");
    licenseCategory = str(args.license_category, "license_category");
  } catch (e) {
    return {
      status: 400,
      body: e instanceof Error ? e.message : "invalid arguments",
    };
  }

  const radiusMeters = radiusKm * 1000;

  // Verify the job exists and is in a state that allows dispatching.
  const jobRows = await ctx.db.query<{ id: string; status: string }>(
    `SELECT id, status FROM dispatch_jobs WHERE id = $1 LIMIT 1`,
    jobId,
  );

  if (jobRows.length === 0) {
    return { status: 404, body: `dispatch_jobs row not found for job_id=${jobId}` };
  }

  const job = jobRows[0];
  if (!["pending", "searching"].includes(job.status)) {
    return {
      status: 409,
      body: `job ${jobId} is in status '${job.status}' — cannot reassign tradesperson`,
    };
  }

  // Query availability pings within radius, applying license constraints.
  // PostGIS ST_DWithin with geography cast for metre-accurate radius.
  const candidates = await ctx.db.query<AvailabilityCandidate>(
    `
    SELECT
      dap.tradesperson_id,
      ST_Distance(
        dap.location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) AS distance_m,
      tp.avg_rating,
      tp.license_category,
      tp.license_verified_at
    FROM dispatch_availability_pings dap
    JOIN tradespeople tp ON tp.id = dap.tradesperson_id
    WHERE
      ST_DWithin(
        dap.location::geography,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
      AND tp.license_category = $4
      AND tp.license_verified_at IS NOT NULL
      AND dap.available = true
      AND dap.pinged_at > NOW() - INTERVAL '30 minutes'
    ORDER BY
      distance_m ASC,
      tp.avg_rating DESC NULLS LAST
    LIMIT 20
    `,
    lat,
    lng,
    radiusMeters,
    licenseCategory,
  );

  if (candidates.length === 0) {
    return {
      status: 200,
      body: {
        matched: false,
        job_id: jobId,
        message: "no available tradespeople found within radius with matching license",
        radius_km: radiusKm,
        license_category: licenseCategory,
      },
    };
  }

  // Best candidate: already sorted by distance ASC, avg_rating DESC.
  const best = candidates[0];

  // Write selected tradesperson_id to dispatch_jobs and update status.
  await ctx.db.execute(
    `
    UPDATE dispatch_jobs
    SET
      tradesperson_id = $1,
      status          = 'dispatched',
      dispatched_at   = NOW(),
      updated_at      = NOW()
    WHERE id = $2
    `,
    best.tradesperson_id,
    jobId,
  );

  return {
    status: 200,
    body: {
      matched: true,
      job_id: jobId,
      tradesperson_id: best.tradesperson_id,
      distance_m: Math.round(best.distance_m),
      avg_rating: best.avg_rating,
      candidates_evaluated: candidates.length,
      license_category: licenseCategory,
    },
  };
}
