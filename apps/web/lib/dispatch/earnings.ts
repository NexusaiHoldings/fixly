import { buildDb } from "@/lib/db";

export interface CompletedJob {
  id: string;
  title: string;
  completed_at: string;
  payout_amount: number;
  location: string | null;
  service_zone_id: string | null;
}

export interface EarningsSummary {
  weekly_total: number;
  monthly_total: number;
  all_time_total: number;
  completed_jobs: CompletedJob[];
}

export interface UpcomingJob {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  location: string | null;
  estimated_payout: number | null;
  service_zone_id: string | null;
}

export async function getEarningsSummary(
  tradespersonId: string,
): Promise<EarningsSummary> {
  const db = buildDb();

  const completedJobs = await db.query<CompletedJob>(
    `SELECT id, title, completed_at,
            COALESCE(payout_amount, 0)::float8 AS payout_amount,
            location, service_zone_id
     FROM dispatch_jobs
     WHERE tradesperson_id = $1::uuid
       AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 100`,
    tradespersonId,
  );

  const [weeklyRow] = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(payout_amount), 0)::float8 AS total
     FROM dispatch_jobs
     WHERE tradesperson_id = $1::uuid
       AND status = 'completed'
       AND completed_at >= NOW() - INTERVAL '7 days'`,
    tradespersonId,
  );

  const [monthlyRow] = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(payout_amount), 0)::float8 AS total
     FROM dispatch_jobs
     WHERE tradesperson_id = $1::uuid
       AND status = 'completed'
       AND completed_at >= NOW() - INTERVAL '30 days'`,
    tradespersonId,
  );

  const [allTimeRow] = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(payout_amount), 0)::float8 AS total
     FROM dispatch_jobs
     WHERE tradesperson_id = $1::uuid
       AND status = 'completed'`,
    tradespersonId,
  );

  return {
    weekly_total: weeklyRow?.total ?? 0,
    monthly_total: monthlyRow?.total ?? 0,
    all_time_total: allTimeRow?.total ?? 0,
    completed_jobs: completedJobs,
  };
}

export async function getUpcomingJobs(
  tradespersonId: string,
): Promise<UpcomingJob[]> {
  const db = buildDb();

  return db.query<UpcomingJob>(
    `SELECT j.id, j.title, j.description, j.scheduled_at, j.location,
            j.estimated_payout::float8 AS estimated_payout,
            j.service_zone_id
     FROM dispatch_jobs j
     INNER JOIN tradesperson_service_zones tsz
       ON tsz.tradesperson_id = $1::uuid
       AND tsz.service_zone_id = j.service_zone_id
     WHERE j.status = 'available'
       AND j.scheduled_at > NOW()
     ORDER BY j.scheduled_at ASC
     LIMIT 20`,
    tradespersonId,
  );
}
