/**
 * home-config (company-root-landing-001 backport). Do NOT hand-edit.
 */
export interface HomeCta { label: string; href: string; }
export interface HomeConfig {
  mode: "landing" | "conversation";
  headline?: string;
  subhead?: string;
  primaryCta?: HomeCta;
  secondaryCta?: HomeCta;
}

export const homeConfig: HomeConfig = {
  "mode": "landing",
  "headline": "Your pipe burst. A licensed plumber arrives in under an hour \u2014 price locked before they knock. (demand_estimator.pain_po",
  "subhead": "An on-demand emergency home repair platform that dispatches pre-vetted, currently-available tradespeople to homeowners within 60 minutes \u2014 with an AI-generated upfront price before booking \u2014 eliminating the 24-48 hour wait and pricing opaci"
};
