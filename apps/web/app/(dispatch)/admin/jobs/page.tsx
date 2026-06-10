"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type JSX,
} from "react";
import {
  fetchActiveJobs,
  fetchAvailableTradespeople,
  reassignJobAction,
  overridePriceAction,
  cancelJobAction,
  type Job,
  type Tradesperson,
  type ActionResult,
} from "@/lib/dispatch/ops-override";

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivePanel =
  | { type: "reassign"; jobId: string; jobTitle: string }
  | { type: "price"; jobId: string; jobTitle: string; currentEstimate: string | null }
  | { type: "cancel"; jobId: string; jobTitle: string }
  | null;

type Toast = { kind: "success" | "error"; message: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In Progress",
  awaiting_payment: "Awaiting Payment",
  disputed: "Disputed",
  escalated: "Escalated",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#fef3c7",
  assigned: "#dbeafe",
  in_progress: "#dcfce7",
  awaiting_payment: "#fae8ff",
  disputed: "#fee2e2",
  escalated: "#ffedd5",
};

function fmtCurrency(value: string | null): string {
  if (!value) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function OpsJobsDashboard(): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tradespeople, setTradespeople] = useState<Tradesperson[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");

  // Cancel form controlled state
  const [cancelReason, setCancelReason] = useState("");
  const [cancelRefund, setCancelRefund] = useState(false);

  const [isPending, startTransition] = useTransition();

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [jobsData, tradespeopleData] = await Promise.all([
        fetchActiveJobs(),
        fetchAvailableTradespeople(),
      ]);
      setJobs(jobsData);
      setTradespeople(tradespeopleData);
      setFetchError(null);
    } catch (err) {
      setFetchError(`Failed to load data: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => void loadData(), 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Toast helper ─────────────────────────────────────────────────────────────

  const showToast = useCallback((kind: "success" | "error", message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 4_500);
  }, []);

  // ── Action handlers ───────────────────────────────────────────────────────────

  const handleReassign = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      startTransition(async () => {
        const result: ActionResult = await reassignJobAction(fd);
        if (result.success) {
          showToast("success", "Job reassigned successfully.");
          setActivePanel(null);
          await loadData();
        } else {
          showToast("error", result.error ?? "Failed to reassign job.");
        }
      });
    },
    [loadData, showToast],
  );

  const handlePriceOverride = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      startTransition(async () => {
        const result: ActionResult = await overridePriceAction(fd);
        if (result.success) {
          showToast("success", "Price override saved.");
          setActivePanel(null);
          await loadData();
        } else {
          showToast("error", result.error ?? "Failed to override price.");
        }
      });
    },
    [loadData, showToast],
  );

  const handleCancel = useCallback(
    (jobId: string) => {
      const fd = new FormData();
      fd.append("job_id", jobId);
      fd.append("reason", cancelReason);
      fd.append("refund", cancelRefund ? "true" : "false");
      startTransition(async () => {
        const result: ActionResult = await cancelJobAction(fd);
        if (result.success) {
          showToast(
            "success",
            cancelRefund ? "Job cancelled and refund issued." : "Job cancelled.",
          );
          setActivePanel(null);
          setCancelReason("");
          setCancelRefund(false);
          await loadData();
        } else {
          showToast("error", result.error ?? "Failed to cancel job.");
        }
      });
    },
    [loadData, showToast, cancelReason, cancelRefund],
  );

  // ── Filtered jobs ─────────────────────────────────────────────────────────────

  const filteredJobs = jobs.filter((job) => {
    if (filterStatus !== "all" && job.status !== filterStatus) return false;
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      return (
        job.title.toLowerCase().includes(q) ||
        (job.homeowner_name ?? "").toLowerCase().includes(q) ||
        (job.homeowner_email ?? "").toLowerCase().includes(q) ||
        (job.tradesperson_name ?? "").toLowerCase().includes(q) ||
        job.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main>
      <h1>Ops Override Dashboard</h1>
      <p>
        Real-time view of all active jobs. Reassign to a different tradesperson,
        override AI price estimates, or cancel and refund jobs. All actions are
        logged to the audit trail.
      </p>

      {/* Toast */}
      {toast && (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            borderRadius: "0.375rem",
            background: toast.kind === "success" ? "#d1fae5" : "#fee2e2",
            color: toast.kind === "success" ? "#065f46" : "#991b1b",
            border: `1px solid ${toast.kind === "success" ? "#6ee7b7" : "#fca5a5"}`,
            fontWeight: 500,
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Fetch error */}
      {fetchError && (
        <div
          role="alert"
          className="card"
          style={{ color: "#991b1b", marginBottom: "1rem" }}
        >
          {fetchError}
        </div>
      )}

      {/* Action panel */}
      {activePanel && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          {activePanel.type === "reassign" && (
            <>
              <h2 style={{ marginTop: 0 }}>Reassign Job</h2>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                {activePanel.jobTitle}
              </p>
              <form onSubmit={handleReassign}>
                <input type="hidden" name="job_id" value={activePanel.jobId} />
                <label>
                  <strong>Assign to tradesperson</strong>
                  <select
                    name="tradesperson_id"
                    required
                    style={{ display: "block", marginTop: "0.35rem", width: "100%", maxWidth: "480px" }}
                  >
                    <option value="">Select tradesperson…</option>
                    {tradespeople.length === 0 && (
                      <option disabled>No verified tradespeople available</option>
                    )}
                    {tradespeople.map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.name} — {tp.email}
                        {tp.specialty ? ` (${tp.specialty})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button type="submit" disabled={isPending}>
                    {isPending ? "Saving…" : "Reassign"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setActivePanel(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </>
          )}

          {activePanel.type === "price" && (
            <>
              <h2 style={{ marginTop: 0 }}>Override Price Estimate</h2>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                {activePanel.jobTitle} — AI estimate:{" "}
                <strong>{fmtCurrency(activePanel.currentEstimate)}</strong>
              </p>
              <form onSubmit={handlePriceOverride}>
                <input type="hidden" name="job_id" value={activePanel.jobId} />
                <label>
                  <strong>New price (USD)</strong>
                  <input
                    type="number"
                    name="new_price"
                    min="0"
                    step="0.01"
                    required
                    placeholder="e.g. 350.00"
                    defaultValue={activePanel.currentEstimate ?? ""}
                    style={{ display: "block", marginTop: "0.35rem", width: "200px" }}
                  />
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button type="submit" disabled={isPending}>
                    {isPending ? "Saving…" : "Save Override"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setActivePanel(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </>
          )}

          {activePanel.type === "cancel" && (
            <>
              <h2 style={{ marginTop: 0, color: "#991b1b" }}>Cancel Job</h2>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                {activePanel.jobTitle}
              </p>
              <label>
                <strong>Cancellation reason</strong>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(ev) => setCancelReason(ev.target.value)}
                  placeholder="Optional reason for cancellation…"
                  style={{ display: "block", marginTop: "0.35rem", width: "100%", maxWidth: "480px" }}
                />
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}
              >
                <input
                  type="checkbox"
                  checked={cancelRefund}
                  onChange={(ev) => setCancelRefund(ev.target.checked)}
                />
                <span>Issue refund to homeowner</span>
              </label>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  disabled={isPending}
                  style={{
                    background: "#fca5a5",
                    color: "#7f1d1d",
                    border: "1px solid #f87171",
                  }}
                  onClick={() => handleCancel(activePanel.jobId)}
                >
                  {isPending
                    ? "Processing…"
                    : cancelRefund
                    ? "Cancel & Refund"
                    : "Confirm Cancel"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setActivePanel(null);
                    setCancelReason("");
                    setCancelRefund(false);
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <input
          type="text"
          placeholder="Search by title, homeowner, tradesperson, or ID…"
          value={filterSearch}
          onChange={(ev) => setFilterSearch(ev.target.value)}
          style={{ minWidth: "260px" }}
        />
        <select
          value={filterStatus}
          onChange={(ev) => setFilterStatus(ev.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="assigned">Assigned</option>
          <option value="in_progress">In Progress</option>
          <option value="awaiting_payment">Awaiting Payment</option>
          <option value="disputed">Disputed</option>
          <option value="escalated">Escalated</option>
        </select>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void loadData()}
          disabled={isPending}
        >
          {isPending ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Job listing */}
      {loading ? (
        <p className="muted">Loading active jobs…</p>
      ) : filteredJobs.length === 0 ? (
        <div className="empty">
          <p>No active jobs found.</p>
          <p className="muted">
            {filterSearch || filterStatus !== "all"
              ? "Try clearing filters to see all active jobs."
              : "All jobs are currently completed, cancelled, or refunded."}
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Showing {filteredJobs.length} of {jobs.length} active job
            {jobs.length !== 1 ? "s" : ""}
            {" "}· auto-refreshes every 30 s
          </p>
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Homeowner</th>
                <th>Tradesperson</th>
                <th>AI Estimate</th>
                <th>Override Price</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => (
                <tr
                  key={job.id}
                  style={
                    activePanel?.jobId === job.id
                      ? { background: "#fefce8" }
                      : undefined
                  }
                >
                  <td>
                    <strong>{job.title}</strong>
                    <br />
                    <span className="muted" style={{ fontSize: "0.7rem" }}>
                      {job.id.slice(0, 8)}…
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "0.25rem",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: STATUS_COLORS[job.status] ?? "#f3f4f6",
                      }}
                    >
                      {STATUS_LABELS[job.status] ?? job.status}
                    </span>
                  </td>
                  <td>
                    <span>{job.homeowner_name ?? <span className="muted">—</span>}</span>
                    {job.homeowner_email && (
                      <>
                        <br />
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {job.homeowner_email}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    {job.tradesperson_name ?? (
                      <span className="muted">Unassigned</span>
                    )}
                  </td>
                  <td>{fmtCurrency(job.ai_price_estimate)}</td>
                  <td>
                    {job.final_price ? (
                      <strong>{fmtCurrency(job.final_price)}</strong>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="muted" style={{ fontSize: "0.75rem" }}>
                      {fmtDate(job.created_at)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() =>
                          setActivePanel({
                            type: "reassign",
                            jobId: job.id,
                            jobTitle: job.title,
                          })
                        }
                        disabled={isPending}
                      >
                        Reassign
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() =>
                          setActivePanel({
                            type: "price",
                            jobId: job.id,
                            jobTitle: job.title,
                            currentEstimate: job.ai_price_estimate,
                          })
                        }
                        disabled={isPending}
                      >
                        Override Price
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCancelReason("");
                          setCancelRefund(false);
                          setActivePanel({
                            type: "cancel",
                            jobId: job.id,
                            jobTitle: job.title,
                          });
                        }}
                        disabled={isPending}
                        style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          border: "1px solid #fca5a5",
                        }}
                      >
                        Cancel / Refund
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
