"use client";

import { useEffect, useState, useCallback, type JSX } from "react";
import { useParams } from "next/navigation";
import { getJobForTracking } from "@/lib/dispatch/job-state";
import type { JobTrackingInfo, JobStatus } from "@/lib/dispatch/job-state";

const POLL_INTERVAL_MS = 5_000;

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; description: string }
> = {
  pending: {
    label: "Pending",
    color: "#d97706",
    description: "Your request is waiting for a tradesperson to respond.",
  },
  accepted: {
    label: "Accepted",
    color: "#2563eb",
    description: "A tradesperson has accepted your job and is on their way.",
  },
  in_progress: {
    label: "In Progress",
    color: "#7c3aed",
    description: "The tradesperson is currently working on your job.",
  },
  declined: {
    label: "Declined",
    color: "#dc2626",
    description: "The tradesperson was unable to take this job.",
  },
  completed: {
    label: "Completed",
    color: "#16a34a",
    description: "Your job has been completed successfully.",
  },
  cancelled: {
    label: "Cancelled",
    color: "#6b7280",
    description: "This job request has been cancelled.",
  },
};

const TERMINAL_STATUSES = new Set<JobStatus>(["completed", "cancelled", "declined"]);

function StatusBadge({ status }: { status: JobStatus }): JSX.Element {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "#6b7280",
    description: "",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.25rem 0.75rem",
        borderRadius: "9999px",
        background: cfg.color,
        color: "#fff",
        fontWeight: 600,
        fontSize: "0.9rem",
      }}
    >
      {cfg.label}
    </span>
  );
}

function PulsingDot({ active }: { active: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: active ? "#16a34a" : "#9ca3af",
        marginRight: "0.4rem",
        verticalAlign: "middle",
        animation: active ? "pulse 1.5s infinite" : "none",
      }}
    />
  );
}

function TrackingCard({ info, polling }: { info: JobTrackingInfo; polling: boolean }): JSX.Element {
  const cfg = STATUS_CONFIG[info.status] ?? STATUS_CONFIG.pending;
  const isTerminal = TERMINAL_STATUSES.has(info.status);

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <StatusBadge status={info.status} />
        {!isTerminal && (
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            <PulsingDot active={polling} />
            {polling ? "Live" : "Paused"}
          </span>
        )}
      </div>

      <p style={{ margin: "0 0 0.5rem" }}>{cfg.description}</p>

      <table>
        <tbody>
          <tr>
            <th scope="row">Service</th>
            <td>{info.service_type}</td>
          </tr>
          <tr>
            <th scope="row">Details</th>
            <td>{info.description}</td>
          </tr>
          {info.tradesperson_name && (
            <tr>
              <th scope="row">Tradesperson</th>
              <td>{info.tradesperson_name}</td>
            </tr>
          )}
          {info.tradesperson_eta && (
            <tr>
              <th scope="row">ETA</th>
              <td>{info.tradesperson_eta}</td>
            </tr>
          )}
          <tr>
            <th scope="row">Last updated</th>
            <td>{new Date(info.updated_at).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function JobTrackingPage(): JSX.Element {
  const params = useParams();
  const jobId = typeof params.id === "string" ? params.id : "";

  const [jobInfo, setJobInfo] = useState<JobTrackingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!jobId) return;
    try {
      const result = await getJobForTracking(jobId);
      if (result === null) {
        setError("Job not found or you are not authorised to view this job.");
        setPolling(false);
        return;
      }
      setJobInfo(result);
      setError(null);
      if (TERMINAL_STATUSES.has(result.status)) {
        setPolling(false);
      }
    } catch (fetchErr) {
      setError("Unable to fetch job status. Retrying…");
      console.error("[tracking] fetch failed:", fetchErr);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, fetchStatus]);

  return (
    <main>
      <h1>Job Status Tracker</h1>
      <p>
        Live updates for your service request. This page polls automatically
        every {POLL_INTERVAL_MS / 1000} seconds.
      </p>

      {loading && (
        <div className="empty">
          <p>Loading job status…</p>
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="card" style={{ borderColor: "#fca5a5" }}>
          <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
          {error.includes("authorised") && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Please sign in to track this job.
            </p>
          )}
        </div>
      )}

      {!loading && jobInfo && <TrackingCard info={jobInfo} polling={polling} />}

      {!loading && jobInfo && TERMINAL_STATUSES.has(jobInfo.status) && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          This job is no longer active. Live updates have stopped.
        </p>
      )}
    </main>
  );
}
