/**
 * Server-side helpers for the human credential review queue (F1-003).
 *
 * Reads pending tradesperson license submissions and writes approve/reject
 * decisions back to dispatch_tradespeople, recording every action in
 * admin_audit_log for the @nexus/admin-console audit trail.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): any {
  if (_pool) return _pool;
  // pg is externalized in next.config.js (serverComponentsExternalPackages) so
  // a plain require resolves from node_modules at runtime without webpack bundling.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool: PgPool } = require("pg") as {
    Pool: new (cfg: Record<string, unknown>) => any;
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

export interface PendingCredential {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  licenseDocumentUrl: string | null;
  submittedAt: string;
}

export async function getPendingCredentials(): Promise<PendingCredential[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, first_name, last_name, email, phone,
            license_number, license_expiry, license_document_url, created_at
     FROM dispatch_tradespeople
     WHERE license_verified_at IS NULL
       AND (license_rejected_at IS NULL)
     ORDER BY created_at ASC`,
  );
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    email: row.email as string,
    phone: (row.phone ?? null) as string | null,
    licenseNumber: (row.license_number ?? null) as string | null,
    licenseExpiry:
      row.license_expiry != null
        ? new Date(row.license_expiry as string).toISOString().slice(0, 10)
        : null,
    licenseDocumentUrl: (row.license_document_url ?? null) as string | null,
    submittedAt: new Date(row.created_at as string).toISOString(),
  }));
}

export async function approveCredential(
  tradespersonId: string,
  adminUserId: string,
  licenseCategories: string[],
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE dispatch_tradespeople
       SET license_verified_at  = NOW(),
           license_category     = $2::text[],
           license_rejected_at  = NULL,
           license_rejection_reason = NULL
       WHERE id = $1`,
      [tradespersonId, licenseCategories],
    );
    await client.query(
      `INSERT INTO admin_audit_log
         (id, admin_user_id, action, target_type, target_id, payload)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        adminUserId,
        "credential.approved",
        "tradesperson_credential",
        tradespersonId,
        JSON.stringify({ license_categories: licenseCategories }),
      ],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectCredential(
  tradespersonId: string,
  adminUserId: string,
  reason: string,
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE dispatch_tradespeople
       SET license_rejected_at       = NOW(),
           license_rejection_reason  = $2,
           license_verified_at       = NULL,
           license_category          = '{}'::text[]
       WHERE id = $1`,
      [tradespersonId, reason],
    );
    await client.query(
      `INSERT INTO admin_audit_log
         (id, admin_user_id, action, target_type, target_id, payload)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        adminUserId,
        "credential.rejected",
        "tradesperson_credential",
        tradespersonId,
        JSON.stringify({ reason }),
      ],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
