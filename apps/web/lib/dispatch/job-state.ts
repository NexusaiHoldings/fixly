"use server";

import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { handleSendNotification } from "@nexus/notifications";
import { getSessionUser } from "@/lib/admin-auth";

export type JobStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Job {
  id: string;
  status: JobStatus;
  tradesperson_id: string | null;
  customer_id: string;
  customer_name: string;
  customer_address: string | null;
  customer_phone: string | null;
  service_type: string;
  description: string;
  estimated_payout: number;
  tradesperson_eta: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobTrackingInfo {
  id: string;
  status: JobStatus;
  service_type: string;
  description: string;
  tradesperson_eta: string | null;
  tradesperson_name: string | null;
  updated_at: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

interface JobRow {
  id: string;
  status: string;
  tradesperson_id: string | null;
  customer_id: string;
  customer_name: string;
  customer_address: string | null;
  customer_phone: string | null;
  service_type: string;
  description: string;
  estimated_payout: string | number;
  tradesperson_eta: string | null;
  created_at: string;
  updated_at: string;
}

export async function getTradesPersonJobs(tradespersonId: string): Promise<Job[]> {
  const db = buildDb();
  const rows = await db.query<JobRow>(
    `SELECT
       id, status, tradesperson_id, customer_id, customer_name,
       CASE WHEN status IN ('accepted', 'in_progress', 'completed')
            THEN customer_address ELSE NULL END AS customer_address,
       CASE WHEN status IN ('accepted', 'in_progress', 'completed')
            THEN customer_phone ELSE NULL END AS customer_phone,
       service_type, description, estimated_payout,
       tradesperson_eta, created_at, updated_at
     FROM dispatch_jobs
     WHERE tradesperson_id = $1::uuid
       AND status IN ('pending', 'accepted', 'in_progress')
     ORDER BY created_at DESC
     LIMIT 50`,
    tradespersonId,
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status as JobStatus,
    tradesperson_id: row.tradesperson_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_address: row.customer_address,
    customer_phone: row.customer_phone,
    service_type: row.service_type,
    description: row.description,
    estimated_payout: Number(row.estimated_payout) || 0,
    tradesperson_eta: row.tradesperson_eta,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

export async function acceptJob(
  jobId: string,
  tradespersonId: string,
): Promise<ActionResult> {
  if (!jobId || !tradespersonId) {
    return { success: false, error: "Missing required parameters" };
  }
  const db = buildDb();
  const rows = await db.query<{
    id: string;
    customer_id: string;
    service_type: string;
  }>(
    `UPDATE dispatch_jobs
     SET status = 'accepted', updated_at = NOW()
     WHERE id = $1::uuid
       AND tradesperson_id = $2::uuid
       AND status = 'pending'
     RETURNING id, customer_id, service_type`,
    jobId,
    tradespersonId,
  );
  if (rows.length === 0) {
    return { success: false, error: "Job not found or already processed" };
  }
  const { customer_id, service_type } = rows[0];
  await notifyCustomerOnAccept(customer_id, jobId, service_type);
  return { success: true };
}

export async function declineJob(
  jobId: string,
  tradespersonId: string,
): Promise<ActionResult> {
  if (!jobId || !tradespersonId) {
    return { success: false, error: "Missing required parameters" };
  }
  const db = buildDb();
  const rows = await db.query<{ id: string }>(
    `UPDATE dispatch_jobs
     SET status = 'declined', updated_at = NOW()
     WHERE id = $1::uuid
       AND tradesperson_id = $2::uuid
       AND status = 'pending'
     RETURNING id`,
    jobId,
    tradespersonId,
  );
  if (rows.length === 0) {
    return { success: false, error: "Job not found or already processed" };
  }
  return { success: true };
}

export async function getJobForTracking(
  jobId: string,
): Promise<JobTrackingInfo | null> {
  if (!jobId) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const db = buildDb();
  const rows = await db.query<{
    id: string;
    status: string;
    service_type: string;
    description: string;
    tradesperson_eta: string | null;
    tradesperson_name: string | null;
    updated_at: string;
  }>(
    `SELECT
       j.id, j.status, j.service_type, j.description,
       j.tradesperson_eta,
       u.name AS tradesperson_name,
       j.updated_at
     FROM dispatch_jobs j
     LEFT JOIN users u ON u.id = j.tradesperson_id
     WHERE j.id = $1::uuid
       AND j.customer_id = $2::uuid`,
    jobId,
    user.id,
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    status: row.status as JobStatus,
    service_type: row.service_type,
    description: row.description,
    tradesperson_eta: row.tradesperson_eta,
    tradesperson_name: row.tradesperson_name,
    updated_at: String(row.updated_at),
  };
}

export async function notifyTradesPersonOnAssignment(
  tradespersonId: string,
  jobId: string,
  serviceType: string,
  estimatedPayout: number,
): Promise<void> {
  try {
    const ctx = { db: buildDb(), events: buildEventBus() };
    const htmlTemplate =
      "<h2>New job request assigned to you</h2>" +
      "<p>You have a new <strong>{{service_type}}</strong> job request. " +
      "Estimated payout: <strong>{{estimated_payout}}</strong>.</p>" +
      "<p>Open the app to accept or decline: {{jobs_url}}</p>";
    await handleSendNotification({
      body: {
        user_id: tradespersonId,
        template_name: "new_job_assignment",
        category: "job_updates",
        variables: {
          service_type: serviceType,
          estimated_payout: `$${estimatedPayout.toFixed(2)}`,
          jobs_url: "/tradesperson/jobs",
          job_id: jobId,
        },
        html_template: htmlTemplate,
      },
      config: { default_channels: ["in_app", "sms"] },
      ctx,
    });
  } catch (notifyErr) {
    console.error("[dispatch] notify tradesperson on assignment failed:", notifyErr);
  }
}

async function notifyCustomerOnAccept(
  customerId: string,
  jobId: string,
  serviceType: string,
): Promise<void> {
  try {
    const ctx = { db: buildDb(), events: buildEventBus() };
    const htmlTemplate =
      "<h2>Your {{service_type}} request has been accepted</h2>" +
      "<p>A tradesperson has accepted your job and is on their way.</p>" +
      "<p>Track the live status here: <a href='{{tracking_url}}'>{{tracking_url}}</a></p>";
    await handleSendNotification({
      body: {
        user_id: customerId,
        template_name: "job_accepted_customer",
        category: "job_updates",
        variables: {
          service_type: serviceType,
          tracking_url: `/jobs/${jobId}/track`,
        },
        html_template: htmlTemplate,
      },
      config: { default_channels: ["in_app", "sms"] },
      ctx,
    });
  } catch (notifyErr) {
    console.error("[dispatch] notify customer on accept failed:", notifyErr);
  }
}
