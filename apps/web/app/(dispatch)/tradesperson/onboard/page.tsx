"use client";

import { useState, useEffect } from "react";
import { FileUploader } from "@nexus/files-and-media";
import {
  upsertTradesperson,
  type TradeCategory,
} from "@/lib/dispatch/tradesperson";

type Step = 1 | 2 | 3 | 4;

interface SessionData {
  user?: { id?: string; email?: string };
}

const TRADE_OPTIONS: Array<{ value: TradeCategory; label: string }> = [
  { value: "plumbing",    label: "Plumbing" },
  { value: "electrical",  label: "Electrical" },
  { value: "hvac",        label: "HVAC / Heating & Cooling" },
  { value: "carpentry",   label: "Carpentry" },
  { value: "masonry",     label: "Masonry" },
  { value: "painting",    label: "Painting" },
  { value: "roofing",     label: "Roofing" },
  { value: "landscaping", label: "Landscaping" },
  { value: "general",     label: "General Contractor" },
];

function parseZips(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((z) => z.trim())
    .filter((z) => /^\d{5}$/.test(z));
}

export default function TradespersonOnboardPage() {
  const [step, setStep]                       = useState<Step>(1);
  const [userId, setUserId]                   = useState<string>("");
  const [tradespersonId, setTradespersonId]   = useState<string>("");
  const [error, setError]                     = useState<string | null>(null);
  const [submitting, setSubmitting]           = useState(false);

  // Step 1 — basic info
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone]             = useState("");
  const [bio, setBio]                 = useState("");

  // Step 2 — trade categories
  const [tradeCategories, setTradeCategories] = useState<TradeCategory[]>([]);

  // Step 3 — service zip codes
  const [zipInput, setZipInput] = useState("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json() as Promise<SessionData>)
      .then((data) => {
        if (data?.user?.id) setUserId(data.user.id);
      })
      .catch(() => {
        /* session unavailable — user will see auth error on submit */
      });
  }, []);

  function toggleCategory(cat: TradeCategory) {
    setTradeCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  async function handleProfileSubmit() {
    setError(null);
    const zips = parseZips(zipInput);

    if (!displayName.trim()) { setError("Display name is required."); return; }
    if (!phone.trim())        { setError("Phone number is required."); return; }
    if (tradeCategories.length === 0) { setError("Select at least one trade category."); return; }
    if (zips.length === 0)    { setError("Enter at least one valid 5-digit ZIP code."); return; }
    if (!userId)              { setError("Session not found — please refresh and sign in."); return; }

    setSubmitting(true);
    const result = await upsertTradesperson({
      user_id:          userId,
      display_name:     displayName.trim(),
      phone:            phone.trim(),
      trade_categories: tradeCategories,
      service_zip_codes: zips,
      bio:              bio.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.success || !result.data) {
      setError(result.error ?? "Failed to save profile — please try again.");
      return;
    }
    setTradespersonId(result.data.id);
    setStep(4);
  }

  // ── Step 1: Basic Info ────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <div className="card">
        <h2>Step 1 — Your Details</h2>
        <p className="muted">Tell homeowners a bit about yourself.</p>

        <label htmlFor="displayName">Display Name</label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Jane Smith"
          required
        />

        <label htmlFor="phone" style={{ marginTop: 12, display: "block" }}>Phone Number</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="555-867-5309"
          required
        />

        <label htmlFor="bio" style={{ marginTop: 12, display: "block" }}>Short Bio (optional)</label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="15 years of licensed plumbing in the Chicago metro area…"
          rows={3}
        />

        <div style={{ marginTop: 16 }}>
          <button
            className="btn"
            onClick={() => {
              if (!displayName.trim()) { setError("Display name is required."); return; }
              if (!phone.trim())       { setError("Phone number is required."); return; }
              setError(null);
              setStep(2);
            }}
          >
            Next →
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Trade Categories ──────────────────────────────────────────────

  function renderStep2() {
    return (
      <div className="card">
        <h2>Step 2 — Your Trades</h2>
        <p className="muted">
          Select every trade category you are licensed to perform. You will need to upload a
          valid license for each trade you select.
        </p>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          {TRADE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={tradeCategories.includes(opt.value)}
                onChange={() => toggleCategory(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </fieldset>

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button className="btn secondary" onClick={() => { setError(null); setStep(1); }}>← Back</button>
          <button
            className="btn"
            onClick={() => {
              if (tradeCategories.length === 0) { setError("Select at least one trade category."); return; }
              setError(null);
              setStep(3);
            }}
          >
            Next →
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Service Area ──────────────────────────────────────────────────

  function renderStep3() {
    const recognized = parseZips(zipInput);
    return (
      <div className="card">
        <h2>Step 3 — Service Area</h2>
        <p className="muted">
          Enter the 5-digit ZIP codes where you accept jobs. Separate multiple codes with
          commas or spaces.
        </p>

        <label htmlFor="zips">Service ZIP Codes</label>
        <textarea
          id="zips"
          value={zipInput}
          onChange={(e) => setZipInput(e.target.value)}
          placeholder="60601, 60602, 60603"
          rows={3}
        />
        {zipInput.trim().length > 0 && (
          <p className="muted" style={{ marginTop: 4 }}>
            {recognized.length > 0
              ? `Recognized ${recognized.length} code${recognized.length === 1 ? "" : "s"}: ${recognized.join(", ")}`
              : "No valid 5-digit ZIP codes detected yet."}
          </p>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button className="btn secondary" onClick={() => { setError(null); setStep(2); }}>← Back</button>
          <button
            className="btn"
            disabled={submitting}
            onClick={() => {
              if (parseZips(zipInput).length === 0) {
                setError("Enter at least one valid 5-digit ZIP code.");
                return;
              }
              setError(null);
              handleProfileSubmit();
            }}
          >
            {submitting ? "Saving…" : "Save & Continue →"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 4: License Upload ────────────────────────────────────────────────

  function renderStep4() {
    return (
      <div className="card">
        <h2>Step 4 — License Documents</h2>
        <p className="muted">
          Upload your trade license or contractor certificate for each trade you selected
          ({tradeCategories.join(", ")}). Documents are reviewed by our compliance team before
          your profile goes live.
        </p>

        <p className="muted" style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 12px" }}>
          Per regulatory requirements, trade credential verification requires human review and
          cannot be fully automated. Our team reviews submissions within 2–3 business days.
        </p>

        {userId ? (
          <div style={{ marginTop: 16 }}>
            <FileUploader userId={userId} />
          </div>
        ) : (
          <p className="muted">Loading upload area…</p>
        )}

        {tradespersonId && (
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            Profile reference: <code>{tradespersonId}</code>
          </p>
        )}

        <div style={{ marginTop: 20 }}>
          <a href="/" className="btn" style={{ display: "inline-block" }}>
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // ── Step indicator ────────────────────────────────────────────────────────

  const STEP_LABELS: Record<Step, string> = {
    1: "Details",
    2: "Trades",
    3: "Area",
    4: "License",
  };

  return (
    <main>
      <h1>Tradesperson Onboarding</h1>
      <p>
        Complete the steps below to register as a licensed tradesperson on the platform.
        Your profile will be visible to homeowners once your credentials are verified.
      </p>

      <div className="toolbar" style={{ marginBottom: 24 }}>
        {([1, 2, 3, 4] as Step[]).map((n) => (
          <span
            key={n}
            className={step === n ? "btn" : "btn secondary"}
            style={{ pointerEvents: "none", opacity: step < n ? 0.5 : 1 }}
          >
            {n}. {STEP_LABELS[n]}
          </span>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            color: "#b91c1c",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </main>
  );
}
