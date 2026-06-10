"use server";

import { buildDb } from "@/lib/db";
import { getAdminUser } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  title: string;
  description: string | null;
  status: string;
  homeowner_id: string;
  homeowner_name: string | null;
  homeowner_email: string | null;
  tradesperson_id: string | null;
  tradesperson_name: string | null;
  ai_price_estimate: string | null;
  final_price: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tradesperson {
  id: string;
  name: string;
  email: string;
  specialty: string | null;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FALLBACK_ADMIN_ID = "00000000-0000-0000-0000-000000000000";

// ── Data fetching ──────────────────────────────────────────────────────────────

export async function fetchActiveJobs(): Promise<Job[]> {
  const db = buildDb();
  try {
    const rows = await db.query<Job>(
      `SELECT
        j.id,
        j.title,
        j.description,
        j.status,
        j.homeowner_id,
        u_home.name        AS homeowner_name,
        u_home.email       AS homeowner_email,
        j.tradesperson_id,
        u_trade.name       AS tradesperson_name,
        j.ai_price_estimate::text AS ai_price_estimate,
        j.final_price::text       AS final_price,
        j.cancellation_reason,
        j.created_at::text AS created_at,
        j.updated_at::text AS updated_at
      FROM jobs j
      LEFT JOIN users u_home  ON u_home.id  = j.homeowner_id
      LEFT JOIN users u_trade ON u_trade.id = j.tradesperson_id
      WHERE j.status NOT IN ('cancelled', 'completed', 'refunded')
      ORDER BY j.created_at DESC
      LIMIT 100`,
    );
    return rows;
  } catch {
    return [];
  }
}

export async function fetchAvailableTradespeople(): Promise<Tradesperson[]> {
  const db = buildDb();
  try {
    const rows = await db.query<Tradesperson>(
      `SELECT
        u.id,
        u.name,
        u.email,
        tp.specialty
      FROM users u
      JOIN tradesperson_profiles tp ON tp.user_id = u.id
      WHERE u.role = 'tradesperson' AND tp.is_verified = true
      ORDER BY u.name ASC
      LIMIT 200`,
    );
    return rows;
  } catch {
    return [];
  }
}

// ── Audit helper ───────────────────────────────────────────────────────────────

async function writeAuditLog(
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = buildDb();
  const safeAdminId = adminUserId || FALLBACK_ADMIN_ID;
  await db.execute(
    `INSERT INTO admin_audit_log
       (id, admin_user_id, action, target_type, target_id, payload, performed_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, now())`,
    randomUUID(),
    safeAdminId,
    action,
    targetType,
    targetId,
    JSON.stringify(payload),
  );
}

// ── Server Actions ─────────────────────────────────────────────────────────────

export async function reassignJobAction(formData: FormData): Promise<ActionResult> {
  const admin = await getAdminUser();
  if (!admin) return { success: false, error: "Unauthorized: admin session required" };

  const jobId = formData.get("job_id") as string | null;
  const tradespersonId = formData.get("tradesperson_id") as string | null;
  if (!jobId || !tradespersonId) {
    return { success: false, error: "Missing required fields: job_id and tradesperson_id" };
  }

  const db = buildDb();
  try {
    await db.execute(
      `UPDATE jobs
       SET tradesperson_id = $1::uuid,
           status          = 'assigned',
           updated_at      = now()
       WHERE id = $2::uuid
         AND status NOT IN ('cancelled', 'completed', 'refunded')`,
      tradespersonId,
      jobId,
    );
    await writeAuditLog(admin.id, "job.reassign", "job", jobId, {
      new_tradesperson_id: tradespersonId,
      admin_email: admin.email,
    });
    revalidatePath("/admin/jobs");
    return { success: true };
  } catch (err) {
    return { success: false, error: `Database error: ${String(err)}` };
  }
}

export async function overridePriceAction(formData: FormData): Promise<ActionResult> {
  const admin = await getAdminUser();
  if (!admin) return { success: false, error: "Unauthorized: admin session required" };

  const jobId = formData.get("job_id") as string | null;
  const newPriceStr = formData.get("new_price") as string | null;
  if (!jobId || !newPriceStr) {
    return { success: false, error: "Missing required fields: job_id and new_price" };
  }
  const newPrice = parseFloat(newPriceStr);
  if (isNaN(newPrice) || newPrice < 0) {
    return { success: false, error: "Invalid price: must be a non-negative number" };
  }

  const db = buildDb();
  try {
    await db.execute(
      `UPDATE jobs
       SET final_price = $1,
           updated_at  = now()
       WHERE id = $2::uuid
         AND status NOT IN ('cancelled', 'completed', 'refunded')`,
      newPrice,
      jobId,
    );
    await writeAuditLog(admin.id, "job.price_override", "job", jobId, {
      new_price: newPrice,
      admin_email: admin.email,
    });
    revalidatePath("/admin/jobs");
    return { success: true };
  } catch (err) {
    return { success: false, error: `Database error: ${String(err)}` };
  }
}

export async function cancelJobAction(formData: FormData): Promise<ActionResult> {
  const admin = await getAdminUser();
  if (!admin) return { success: false, error: "Unauthorized: admin session required" };

  const jobId = formData.get("job_id") as string | null;
  if (!jobId) return { success: false, error: "Missing required field: job_id" };

  const reason = (formData.get("reason") as string | null) ?? "";
  const refund = formData.get("refund") === "true";
  const newStatus = refund ? "refunded" : "cancelled";

  const db = buildDb();
  try {
    await db.execute(
      `UPDATE jobs
       SET status               = $1,
           cancellation_reason  = $2,
           updated_at           = now()
       WHERE id = $3::uuid
         AND status NOT IN ('cancelled', 'completed', 'refunded')`,
      newStatus,
      reason || null,
      jobId,
    );
    await writeAuditLog(admin.id, `job.${newStatus}`, "job", jobId, {
      reason: reason || null,
      refund_issued: refund,
      admin_email: admin.email,
    });
    revalidatePath("/admin/jobs");
    return { success: true };
  } catch (err) {
    return { success: false, error: `Database error: ${String(err)}` };
  }
}
