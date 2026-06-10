/**
 * GET /api/cron/supply-density
 *
 * Vercel cron job — runs periodically to monitor tradesperson supply density
 * by geographic region. Computes active-ping counts per grid cell, identifies
 * under-served areas, logs structured results, and purges stale pings.
 *
 * Auth: validated via CRON_SECRET bearer token (same pattern as other crons).
 * Schedule: configure in vercel.json (recommended: every 5 minutes).
 */

import { NextResponse } from "next/server";
import {
  getSupplyDensityGrid,
  purgeOldPings,
  ACTIVE_PING_WINDOW_MS,
} from "@/lib/dispatch/availability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Minimum acceptable supply count per grid cell before flagging a gap. */
const MIN_SUPPLY_THRESHOLD = parseInt(
  process.env.DISPATCH_MIN_SUPPLY_PER_CELL ?? "2",
  10,
);

/** Grid cell size in degrees (default 0.5° ≈ 55 km at the equator). */
const CELL_DEGREES = parseFloat(
  process.env.DISPATCH_DENSITY_CELL_DEGREES ?? "0.5",
);

/**
 * Stale ping retention window: keep pings for 24 hours so we can do
 * look-back analysis; active dispatch window is only 2 minutes.
 */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === "Bearer " + secret;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const startMs = Date.now();

  let grid: Array<{ cell_lat: number; cell_lng: number; supply_count: number }>;
  try {
    grid = await getSupplyDensityGrid(CELL_DEGREES, ACTIVE_PING_WINDOW_MS);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "supply_density_grid_error",
        error: String((err as Error).message),
      }),
    );
    return NextResponse.json(
      { error: "failed to query supply density: " + String((err as Error).message) },
      { status: 502 },
    );
  }

  const totalCells = grid.length;
  const lowSupplyCells = grid.filter((c) => c.supply_count < MIN_SUPPLY_THRESHOLD);
  const totalActivePings = grid.reduce((acc, c) => acc + c.supply_count, 0);

  const gaps = lowSupplyCells.map((c) => ({
    cell_lat: c.cell_lat,
    cell_lng: c.cell_lng,
    supply_count: c.supply_count,
    gap: MIN_SUPPLY_THRESHOLD - c.supply_count,
  }));

  console.log(
    JSON.stringify({
      event: "supply_density_report",
      total_active_pings: totalActivePings,
      total_cells_with_supply: totalCells,
      low_supply_cells: lowSupplyCells.length,
      min_supply_threshold: MIN_SUPPLY_THRESHOLD,
      cell_degrees: CELL_DEGREES,
      gaps,
    }),
  );

  let purgedCount = 0;
  try {
    purgedCount = await purgeOldPings(PURGE_AFTER_MS);
  } catch (err) {
    // Non-fatal — log but don't fail the cron response
    console.error(
      JSON.stringify({
        event: "supply_density_purge_error",
        error: String((err as Error).message),
      }),
    );
  }

  const durationMs = Date.now() - startMs;

  return NextResponse.json({
    ok: true,
    duration_ms: durationMs,
    total_active_pings: totalActivePings,
    total_cells_with_supply: totalCells,
    low_supply_cells: lowSupplyCells.length,
    min_supply_threshold: MIN_SUPPLY_THRESHOLD,
    cell_degrees: CELL_DEGREES,
    gaps,
    purged_old_pings: purgedCount,
  });
}
