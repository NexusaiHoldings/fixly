/**
 * Dispatch domain schema — tradesperson registry, jobs, photos, price estimates,
 * credential reviews, availability pings, and post-job reviews.
 *
 * Exports matching *_DDL or *_SCHEMA_SQL are loaded and executed by
 * packages/db/migrate.ts at build time (CREATE TABLE IF NOT EXISTS — idempotent).
 */

// ─── TypeScript Types ─────────────────────────────────────────────────────────

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

export type JobStatus =
  | "draft"
  | "posted"
  | "accepted"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "disputed";

export type ReviewOutcome = "approved" | "rejected" | "needs_more_info";

/** Registered tradesperson — core profile record. */
export interface Tradesperson {
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
  location_lat: number | null;
  location_lng: number | null;
  stripe_account_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Job posted by a homeowner. Drives the state machine (draft → completed). */
export interface Job {
  id: string;
  homeowner_user_id: string;
  tradesperson_id: string | null;
  title: string;
  description: string;
  trade_category: TradeCategory;
  zip_code: string;
  status: JobStatus;
  scheduled_at: Date | null;
  completed_at: Date | null;
  final_price_cents: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Photo attached to a job — references a file managed by @nexus/files-and-media. */
export interface JobPhoto {
  id: string;
  job_id: string;
  file_id: string;
  uploaded_by_user_id: string;
  caption: string | null;
  created_at: Date;
}

/** AI-generated price estimate produced from job photos via Claude Sonnet vision. */
export interface PriceEstimate {
  id: string;
  job_id: string;
  estimated_low_cents: number;
  estimated_high_cents: number;
  model_version: string;
  reasoning: string | null;
  created_at: Date;
}

/**
 * Human-review record for a tradesperson's trade license / contractor certificate.
 * Per liability_assessor finding: credential verification must not be fully automated.
 */
export interface CredentialReview {
  id: string;
  tradesperson_id: string;
  reviewer_user_id: string | null;
  file_id: string;
  trade_category: TradeCategory;
  outcome: ReviewOutcome | null;
  reviewer_notes: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
}

/** Tradesperson signals availability for dispatch within a zip + time window. */
export interface AvailabilityPing {
  id: string;
  tradesperson_id: string;
  trade_category: TradeCategory;
  zip_code: string;
  available_from: Date;
  available_until: Date | null;
  created_at: Date;
}

/** Homeowner review submitted after job completion (1–5 star rating). */
export interface PostJobReview {
  id: string;
  job_id: string;
  reviewer_user_id: string;
  tradesperson_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

// ─── SQL DDL — executed by packages/db/migrate.ts ────────────────────────────

export const DISPATCH_DDL = `
-- Dispatch domain: tradesperson registry + credential schema.
-- All statements are idempotent (CREATE TABLE/INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS dispatch_tradespeople (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL,
  display_name      TEXT        NOT NULL,
  phone             TEXT        NOT NULL,
  trade_categories  TEXT[]      NOT NULL DEFAULT '{}',
  service_zip_codes TEXT[]      NOT NULL DEFAULT '{}',
  credential_status TEXT        NOT NULL DEFAULT 'pending',
  bio               TEXT,
  years_experience  INTEGER,
  hourly_rate_cents INTEGER,
  location_lat      DOUBLE PRECISION,
  location_lng      DOUBLE PRECISION,
  stripe_account_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_tradespeople_pkey    PRIMARY KEY (id),
  CONSTRAINT dispatch_tradespeople_user_uq UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_tradespeople_trade_cats
  ON dispatch_tradespeople USING GIN (trade_categories);

CREATE INDEX IF NOT EXISTS idx_dispatch_tradespeople_zip_codes
  ON dispatch_tradespeople USING GIN (service_zip_codes);

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  homeowner_user_id UUID        NOT NULL,
  tradesperson_id   UUID,
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  trade_category    TEXT        NOT NULL,
  zip_code          TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'draft',
  scheduled_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  final_price_cents INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_jobs_pkey         PRIMARY KEY (id),
  CONSTRAINT dispatch_jobs_tradesperson FOREIGN KEY (tradesperson_id)
    REFERENCES dispatch_tradespeople(id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_homeowner
  ON dispatch_jobs (homeowner_user_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_tradesperson
  ON dispatch_jobs (tradesperson_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_status
  ON dispatch_jobs (status);

CREATE TABLE IF NOT EXISTS dispatch_job_photos (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL,
  file_id             TEXT        NOT NULL,
  uploaded_by_user_id UUID        NOT NULL,
  caption             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_job_photos_pkey   PRIMARY KEY (id),
  CONSTRAINT dispatch_job_photos_job_fk FOREIGN KEY (job_id)
    REFERENCES dispatch_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_job_photos_job
  ON dispatch_job_photos (job_id);

CREATE TABLE IF NOT EXISTS dispatch_price_estimates (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid(),
  job_id               UUID        NOT NULL,
  estimated_low_cents  INTEGER     NOT NULL,
  estimated_high_cents INTEGER     NOT NULL,
  model_version        TEXT        NOT NULL,
  reasoning            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_price_estimates_pkey   PRIMARY KEY (id),
  CONSTRAINT dispatch_price_estimates_job_fk FOREIGN KEY (job_id)
    REFERENCES dispatch_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dispatch_credential_reviews (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  tradesperson_id  UUID        NOT NULL,
  reviewer_user_id UUID,
  file_id          TEXT        NOT NULL,
  trade_category   TEXT        NOT NULL,
  outcome          TEXT,
  reviewer_notes   TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  CONSTRAINT dispatch_credential_reviews_pkey         PRIMARY KEY (id),
  CONSTRAINT dispatch_credential_reviews_tradesperson FOREIGN KEY (tradesperson_id)
    REFERENCES dispatch_tradespeople(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_cred_reviews_tradesperson
  ON dispatch_credential_reviews (tradesperson_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_cred_reviews_outcome
  ON dispatch_credential_reviews (outcome);

CREATE TABLE IF NOT EXISTS dispatch_availability_pings (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tradesperson_id UUID        NOT NULL,
  trade_category  TEXT        NOT NULL,
  zip_code        TEXT        NOT NULL,
  available_from  TIMESTAMPTZ NOT NULL,
  available_until TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_availability_pings_pkey         PRIMARY KEY (id),
  CONSTRAINT dispatch_availability_pings_tradesperson FOREIGN KEY (tradesperson_id)
    REFERENCES dispatch_tradespeople(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_avail_pings_zip_trade
  ON dispatch_availability_pings (zip_code, trade_category);

CREATE TABLE IF NOT EXISTS dispatch_post_job_reviews (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL,
  reviewer_user_id UUID        NOT NULL,
  tradesperson_id  UUID        NOT NULL,
  rating           SMALLINT    NOT NULL,
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_post_job_reviews_pkey         PRIMARY KEY (id),
  CONSTRAINT dispatch_post_job_reviews_job_fk       FOREIGN KEY (job_id)
    REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
  CONSTRAINT dispatch_post_job_reviews_tradesperson FOREIGN KEY (tradesperson_id)
    REFERENCES dispatch_tradespeople(id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_post_job_reviews_tradesperson
  ON dispatch_post_job_reviews (tradesperson_id);
`;
