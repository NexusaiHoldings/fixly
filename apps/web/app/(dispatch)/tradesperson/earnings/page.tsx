import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin-auth";
import {
  getEarningsSummary,
  getUpcomingJobs,
  type CompletedJob,
  type UpcomingJob,
} from "@/lib/dispatch/earnings";
import type { JSX } from "react";

export const metadata = { title: "My Earnings" };
export const dynamic = "force-dynamic";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SummaryCard({
  label,
  amount,
}: {
  label: string;
  amount: number;
}): JSX.Element {
  return (
    <div className="card">
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        {label}
      </p>
      <p style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0.25rem 0 0" }}>
        {formatCurrency(amount)}
      </p>
    </div>
  );
}

function CompletedJobsTable({
  jobs,
}: {
  jobs: CompletedJob[];
}): JSX.Element {
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <p>No completed jobs yet. Accept your first job to start earning.</p>
      </div>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Job</th>
          <th>Location</th>
          <th>Completed</th>
          <th>Payout</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <td>{job.title}</td>
            <td>{job.location ?? <span className="muted">—</span>}</td>
            <td>{formatDate(job.completed_at)}</td>
            <td>{formatCurrency(job.payout_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UpcomingJobCard({ job }: { job: UpcomingJob }): JSX.Element {
  return (
    <li className="card" style={{ listStyle: "none" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
        }}
      >
        <div>
          <strong>{job.title}</strong>
          {job.description && (
            <p className="muted" style={{ margin: "0.25rem 0 0" }}>
              {job.description}
            </p>
          )}
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
            {job.location ?? "Location TBD"} &middot; {formatDate(job.scheduled_at)}
          </p>
        </div>
        {job.estimated_payout !== null && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <strong>{formatCurrency(job.estimated_payout)}</strong>
            <p
              className="muted"
              style={{ margin: 0, fontSize: "0.75rem" }}
            >
              est. payout
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export default async function EarningsDashboardPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }

  const [summary, upcomingJobs] = await Promise.all([
    getEarningsSummary(user.id),
    getUpcomingJobs(user.id),
  ]);

  return (
    <main>
      <h1>My Earnings</h1>
      <p>
        Track your completed jobs, payouts, and upcoming opportunities in your
        service zones.
      </p>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <SummaryCard label="This Week" amount={summary.weekly_total} />
        <SummaryCard label="This Month" amount={summary.monthly_total} />
        <SummaryCard label="All Time" amount={summary.all_time_total} />
      </section>

      <section>
        <h2>Completed Jobs</h2>
        <CompletedJobsTable jobs={summary.completed_jobs} />
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Upcoming Jobs in Your Service Zones</h2>
        {upcomingJobs.length === 0 ? (
          <div className="empty">
            <p>
              No upcoming jobs available in your service zones right now. Check
              back soon.
            </p>
          </div>
        ) : (
          <ul style={{ padding: 0, margin: 0 }}>
            {upcomingJobs.map((job) => (
              <UpcomingJobCard key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
