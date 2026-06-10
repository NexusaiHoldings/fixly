/**
 * /admin/credentials — Human Credential Review Queue (F1-003).
 *
 * Ops-facing page that lists pending tradesperson license submissions.
 * Approving sets license_verified_at + license_category[].
 * Rejecting sets license_rejected_at + license_rejection_reason.
 * Both actions write to the @nexus/admin-console admin_audit_log.
 * Only verified tradespeople appear in the dispatch engine job-matching.
 */

import type { JSX } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/admin-auth";
import {
  getPendingCredentials,
  approveCredential,
  rejectCredential,
} from "@/lib/dispatch/credential-review";

export const dynamic = "force-dynamic";

export default async function CredentialReviewPage(): Promise<JSX.Element> {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/login?redirect=/admin/credentials");
  }

  const pending = await getPendingCredentials();

  async function handleApprove(formData: FormData): Promise<void> {
    "use server";
    const resolvedAdmin = await getAdminUser();
    if (!resolvedAdmin) return;
    const id = formData.get("id") as string;
    const raw = (formData.get("categories") as string | null) ?? "";
    const categories = raw
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    await approveCredential(id, resolvedAdmin.id, categories);
    revalidatePath("/admin/credentials");
  }

  async function handleReject(formData: FormData): Promise<void> {
    "use server";
    const resolvedAdmin = await getAdminUser();
    if (!resolvedAdmin) return;
    const id = formData.get("id") as string;
    const reason =
      (formData.get("reason") as string | null) ??
      "License documentation insufficient";
    await rejectCredential(id, resolvedAdmin.id, reason);
    revalidatePath("/admin/credentials");
  }

  return (
    <main>
      <h1>Credential Review Queue</h1>
      <p>
        Review pending tradesperson license submissions. Approving a submission
        enables the tradesperson for job matching. Every decision is recorded in
        the audit log.
      </p>

      {pending.length === 0 ? (
        <div className="empty">
          <p>No pending credential submissions — all caught up.</p>
        </div>
      ) : (
        <div>
          {pending.map((cred) => (
            <div key={cred.id} className="card">
              <h2>
                {cred.firstName} {cred.lastName}
              </h2>
              <p>
                <strong>Email:</strong> {cred.email}
                {cred.phone ? (
                  <>
                    {" · "}
                    <strong>Phone:</strong> {cred.phone}
                  </>
                ) : null}
              </p>
              <p>
                <strong>License no.:</strong>{" "}
                {cred.licenseNumber ?? <span className="muted">not provided</span>}
                {cred.licenseExpiry ? (
                  <>
                    {" · "}
                    <strong>Expires:</strong> {cred.licenseExpiry}
                  </>
                ) : null}
              </p>
              {cred.licenseDocumentUrl ? (
                <p>
                  <a
                    href={cred.licenseDocumentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View license document ↗
                  </a>
                </p>
              ) : (
                <p className="muted">No license document uploaded.</p>
              )}
              <p className="muted">
                Submitted {new Date(cred.submittedAt).toLocaleDateString()}
              </p>

              <form action={handleApprove} style={{ marginTop: "0.75rem" }}>
                <input type="hidden" name="id" value={cred.id} />
                <label htmlFor={`categories-${cred.id}`}>
                  License categories (comma-separated)
                </label>
                <input
                  id={`categories-${cred.id}`}
                  type="text"
                  name="categories"
                  placeholder="e.g. plumbing, electrical"
                  required
                />
                <button type="submit">Approve</button>
              </form>

              <form action={handleReject} style={{ marginTop: "0.5rem" }}>
                <input type="hidden" name="id" value={cred.id} />
                <label htmlFor={`reason-${cred.id}`}>Rejection reason</label>
                <input
                  id={`reason-${cred.id}`}
                  type="text"
                  name="reason"
                  placeholder="e.g. Expired license, missing documentation"
                  required
                />
                <button type="submit" className="btn secondary">
                  Reject
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
