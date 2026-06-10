import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin-auth";
import {
  getTradesPersonJobs,
  acceptJob,
  declineJob,
} from "@/lib/dispatch/job-state";
import type { Job } from "@/lib/dispatch/job-state";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting Response",
  accepted: "Accepted",
  in_progress: "In Progress",
  declined: "Declined",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatPayout(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function JobCardPending({
  job,
  onAccept,
  onDecline,
}: {
  job: Job;
  onAccept: (formData: FormData) => Promise<void>;
  onDecline: (formData: FormData) => Promise<void>;
}): JSX.Element {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{job.service_type}</strong>
          <span className="muted" style={{ marginLeft: "0.75rem" }}>
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>
        <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
          {formatPayout(job.estimated_payout)}
        </span>
      </div>

      <p style={{ margin: "0.5rem 0" }}>{job.description}</p>

      <p className="muted" style={{ margin: "0.25rem 0" }}>
        Customer: {job.customer_name} &bull; Location revealed after acceptance
      </p>

      <p className="muted" style={{ margin: "0.25rem 0", fontSize: "0.85rem" }}>
        Received: {new Date(job.created_at).toLocaleString()}
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <form action={onAccept} style={{ display: "inline" }}>
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="btn">
            Accept Job
          </button>
        </form>
        <form action={onDecline} style={{ display: "inline" }}>
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="btn secondary">
            Decline
          </button>
        </form>
      </div>
    </div>
  );
}

function JobCardActive({ job }: { job: Job }): JSX.Element {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{job.service_type}</strong>
          <span
            className="muted"
            style={{ marginLeft: "0.75rem", color: "#16a34a", fontWeight: 600 }}
          >
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>
        <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
          {formatPayout(job.estimated_payout)}
        </span>
      </div>

      <p style={{ margin: "0.5rem 0" }}>{job.description}</p>

      {job.customer_address && (
        <p style={{ margin: "0.25rem 0" }}>
          <strong>Address:</strong> {job.customer_address}
        </p>
      )}
      {job.customer_phone && (
        <p style={{ margin: "0.25rem 0" }}>
          <strong>Customer phone:</strong>{" "}
          <a href={`tel:${job.customer_phone}`}>{job.customer_phone}</a>
        </p>
      )}
      {job.tradesperson_eta && (
        <p className="muted" style={{ margin: "0.25rem 0" }}>
          ETA: {job.tradesperson_eta}
        </p>
      )}

      <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
        Accepted: {new Date(job.updated_at).toLocaleString()}
      </p>
    </div>
  );
}

export default async function TradesPersonJobsPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  let jobs: Job[] = [];
  let fetchError: string | null = null;

  try {
    jobs = await getTradesPersonJobs(user.id);
  } catch (err) {
    fetchError = "Unable to load jobs. Please refresh the page.";
    console.error("[dispatch] getTradesPersonJobs failed:", err);
  }

  const pendingJobs = jobs.filter((j) => j.status === "pending");
  const activeJobs = jobs.filter(
    (j) => j.status === "accepted" || j.status === "in_progress",
  );

  async function doAccept(formData: FormData): Promise<void> {
    "use server";
    const session = await getSessionUser();
    if (!session) redirect("/login");
    const jobId = formData.get("jobId");
    if (typeof jobId !== "string" || !jobId) return;
    await acceptJob(jobId, session.id);
    redirect("/tradesperson/jobs");
  }

  async function doDecline(formData: FormData): Promise<void> {
    "use server";
    const session = await getSessionUser();
    if (!session) redirect("/login");
    const jobId = formData.get("jobId");
    if (typeof jobId !== "string" || !jobId) return;
    await declineJob(jobId, session.id);
    redirect("/tradesperson/jobs");
  }

  return (
    <main>
      <h1>My Job Requests</h1>
      <p>
        Review inbound job assignments and accept or decline. Customer address
        is revealed once you accept.
      </p>

      {fetchError && (
        <div role="alert" style={{ color: "#b91c1c", marginBottom: "1rem" }}>
          {fetchError}
        </div>
      )}

      {pendingJobs.length > 0 && (
        <section>
          <h2>Awaiting Your Response ({pendingJobs.length})</h2>
          {pendingJobs.map((job) => (
            <JobCardPending
              key={job.id}
              job={job}
              onAccept={doAccept}
              onDecline={doDecline}
            />
          ))}
        </section>
      )}

      {activeJobs.length > 0 && (
        <section>
          <h2>Active Jobs ({activeJobs.length})</h2>
          {activeJobs.map((job) => (
            <JobCardActive key={job.id} job={job} />
          ))}
        </section>
      )}

      {!fetchError && jobs.length === 0 && (
        <div className="empty">
          <p>No job requests assigned to you yet.</p>
          <p className="muted">
            New requests will appear here when dispatched to you.
          </p>
        </div>
      )}
    </main>
  );
}
