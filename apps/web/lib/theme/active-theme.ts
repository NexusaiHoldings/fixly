/**
 * active-theme — the resolved ThemeContract this company wears.
 *
 * company-theme-authoring-001 (2026-06-09). DEFAULT below is the `generic`
 * preset so the substrate builds standalone. At provisioning, the engine
 * OVERWRITES this whole file with the company's resolved tokens (from the CMO's
 * ThemeContract in the unified_plan). Concrete inline values — no import of
 * PRESETS — so the writer emits a clean, deterministic, reviewable file.
 *
 * Consumed by app/layout.tsx → emits :root --substrate-* overrides + loads the
 * registry fonts. Do NOT hand-edit in a company repo; it's provisioning-owned.
 */
import type { ThemeContract } from "./contract";

export const activeTheme: ThemeContract = {
  color: {
    bg: "#ffffff",
    surface: "#fafafa",
    surfaceAlt: "#f4f4f4",
    text: "#111111",
    textMuted: "#555555",
    border: "#e2e2e2",
    borderStrong: "#c9c9c9",
    accent: "#2563eb",
    accentText: "#ffffff",
    danger: "#c0341d",
    success: "#15803d",
  },
  type: { fontHeading: "system-sans", fontBody: "system-sans" },
  shape: { radius: 8 },
};
