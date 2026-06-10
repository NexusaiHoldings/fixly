"use server";

/**
 * Dispatch domain — server actions for tradesperson registry and credential management.
 * All DB access uses raw SQL via the pg Pool (drizzle-orm is not used per task constraints).
 */

import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

export type TradeCategory =
  | "plumbing"
  | "electrical"
  | "hvac"
  | "carpentry"
  | "masonry"
  | "painting"
  | "roofing"
  | "landscaping"
  | "general";

export type CredentialStatus = "pending" | "approved" | "rejected" | "expired";

export interface TradespersonProfile {
  id: string;
  user_id: string;
  display_name: string;
  phone: string;
  trade_categories: TradeCategory[];
  service_zip_codes: string[];
  credential_status: CredentialStatus;
  bio: string | null;
  years_experience: number | null;
  hourly_rate_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertTradespersonInput {
  user_id: string;
  display_name: string;
  phone: string;
  trade_categories: TradeCategory[];
  service_zip_codes: string[];
  bio?: string;
  years_experience?: number;
}

export interface SubmitCredentialInput {
  tradesperson_id: string;
  file_id: string;
  trade_category: TradeCategory;
}

export interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CredentialReviewRow {
  id: string;
  trade_category: string;
  outcome: string | null;
  submitted_at: string;
}

// ─── Server Actions ────────────────────────────────────────────────────────────

/**
 * Insert or update a tradesperson profile keyed on user_id.
 * Called from the onboarding page after form validation.
 */
export async function upsertTradesperson(
  input: UpsertTradespersonInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const db = getPool();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO dispatch_tradespeople
         (user_id, display_name, phone, trade_categories, service_zip_codes, bio, years_experience)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name      = EXCLUDED.display_name,
         phone             = EXCLUDED.phone,
         trade_categories  = EXCLUDED.trade_categories,
         service_zip_codes = EXCLUDED.service_zip_codes,
         bio               = EXCLUDED.bio,
         years_experience  = EXCLUDED.years_experience,
         updated_at        = NOW()
       RETURNING id`,
      [
        input.user_id,
        input.display_name,
        input.phone,
        input.trade_categories,
        input.service_zip_codes,
        input.bio ?? null,
        input.years_experience ?? null,
      ],
    );
    return { success: true, data: { id: rows[0].id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Fetch a tradesperson profile by the auth user_id.
 * Returns null when no profile exists yet.
 */
export async function getTradespersonByUserId(
  user_id: string,
): Promise<TradespersonProfile | null> {
  const db = getPool();
  const { rows } = await db.query<TradespersonProfile>(
    `SELECT
       id, user_id, display_name, phone, trade_categories, service_zip_codes,
       credential_status, bio, years_experience, hourly_rate_cents,
       created_at::text AS created_at, updated_at::text AS updated_at
     FROM dispatch_tradespeople
     WHERE user_id = $1
     LIMIT 1`,
    [user_id],
  );
  return rows[0] ?? null;
}

/**
 * Update the list of service ZIP codes for a tradesperson.
 * Replaces the entire array (caller provides the full desired set).
 */
export async function updateServiceZipCodes(
  tradesperson_id: string,
  zip_codes: string[],
): Promise<ActionResult<void>> {
  try {
    const db = getPool();
    await db.query(
      `UPDATE dispatch_tradespeople
       SET service_zip_codes = $2, updated_at = NOW()
       WHERE id = $1`,
      [tradesperson_id, zip_codes],
    );
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Submit a trade license / contractor certificate for human review.
 * Per liability_assessor finding: must NOT be auto-approved; queues for admin review.
 */
export async function submitCredentialForReview(
  input: SubmitCredentialInput,
): Promise<ActionResult<{ review_id: string }>> {
  try {
    const db = getPool();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO dispatch_credential_reviews
         (tradesperson_id, file_id, trade_category)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [input.tradesperson_id, input.file_id, input.trade_category],
    );
    return { success: true, data: { review_id: rows[0].id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * List all credential review submissions for a given tradesperson,
 * most recent first.
 */
export async function getCredentialReviews(
  tradesperson_id: string,
): Promise<CredentialReviewRow[]> {
  const db = getPool();
  const { rows } = await db.query<CredentialReviewRow>(
    `SELECT id, trade_category, outcome, submitted_at::text AS submitted_at
     FROM dispatch_credential_reviews
     WHERE tradesperson_id = $1
     ORDER BY submitted_at DESC`,
    [tradesperson_id],
  );
  return rows;
}

/**
 * Record a tradesperson availability signal for a specific ZIP + trade window.
 * Used by the dispatch engine to surface tradespeople within a defined radius.
 */
export async function createAvailabilityPing(
  tradesperson_id: string,
  trade_category: TradeCategory,
  zip_code: string,
  available_from: Date,
  available_until?: Date,
): Promise<ActionResult<{ ping_id: string }>> {
  try {
    const db = getPool();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO dispatch_availability_pings
         (tradesperson_id, trade_category, zip_code, available_from, available_until)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tradesperson_id, trade_category, zip_code, available_from, available_until ?? null],
    );
    return { success: true, data: { ping_id: rows[0].id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
