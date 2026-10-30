import type { Metrics } from "./types";

export function cn(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export const GLOSSARY: Record<string, { title: string; def: string; example: string }> = {
  taste: {
    title: "Taste match",
    def: "Where Qloo ranks this brand among every candidate brand for your crowd's combined taste profile (qloo_rank).",
    example: "“#2 of 28” means only one candidate scored higher for this crowd.",
  },
  overlap: {
    title: "Audience overlap",
    def: "How many of your crowd's top 20 Qloo tastes also characterise the brand's fans (qloo_recommend → qloo_compare_audiences).",
    example: "“9 of 20” means 9 of your crowd's defining tastes show up among the brand's fans too.",
  },
  local: {
    title: "Local strength",
    def: "How strongly Qloo's heatmap places this brand in your event city, as a top-% of all areas it measures (qloo_where_popular).",
    example: "“Top 6% in Austin” — Austin areas rank in the top 6% for this brand.",
  },
  momentum: {
    title: "Momentum",
    def: "Change in the brand's Qloo popularity percentile over the last 12 months (qloo_trends).",
    example: "“+12%” — the brand's popularity percentile rose 12% relative to a year ago.",
  },
  sponsor: {
    title: "Sponsor activity",
    def: "Public, cited web evidence that the brand sponsored events in 2025–26. May miss private deals.",
    example: "“3 found” — three cited sponsorships, each linked to its source.",
  },
  fit: {
    title: "Marquee Fit",
    def: "A 0–100 score Marquee computes from the measured components with fixed weights. Missing components are re-weighted, never guessed.",
    example: "Fit means audience alignment, not guaranteed ROI.",
  },
};

export function fmtTaste(m: Metrics): string {
  if (!m.taste_rank || !m.taste_n) return "n/a";
  return `#${m.taste_rank} of ${m.taste_n}`;
}

export function fmtTasteSub(m: Metrics): string {
  if (!m.taste_rank || !m.taste_n) return "";
  const pct = Math.max(1, Math.round((100 * m.taste_rank) / m.taste_n));
  return `Top ${pct}% for this crowd`;
}

export function fmtOverlap(m: Metrics): string {
  if (m.overlap_shared == null || !m.overlap_of) return "n/a";
  return `${m.overlap_shared} of ${m.overlap_of}`;
}

export function fmtLocal(m: Metrics): string {
  if (m.local_top_pct == null) return "n/a";
  return `Top ${m.local_top_pct < 1 ? m.local_top_pct.toFixed(1) : Math.round(m.local_top_pct)}%`;
}

export function fmtMomentum(m: Metrics): string {
  if (m.momentum_pct == null) return m.momentum_flat ? "Flat" : "n/a";
  const v = m.momentum_pct;
  return `${v > 0 ? "+" : ""}${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

export function initials(name: string) {
  return name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function talkingPoints(b: { name: string; category: string; fit: number; metrics: Metrics; why: { text: string }[]; sponsor_activity?: { summary?: string } }, fit?: number, eventName?: string) {
  const m = b.metrics;
  const lines = [
    `${b.name} — ${b.category}${eventName ? ` · for ${eventName}` : ""}`,
    `Marquee Fit: ${Math.round(fit ?? b.fit)}/100`,
    `• Taste match: ${fmtTaste(m)}${fmtTasteSub(m) ? ` (${fmtTasteSub(m)})` : ""}`,
    `• Audience overlap: ${fmtOverlap(m)} of the crowd's top tastes shared`,
    `• Local strength: ${fmtLocal(m)}${m.local_city ? ` of areas in ${m.local_city}` : ""}`,
    `• Momentum (12 mo): ${fmtMomentum(m)}`,
    ...b.why.map((w) => `• ${w.text}`),
  ];
  if (b.sponsor_activity?.summary) lines.push(`• ${b.sponsor_activity.summary}`);
  lines.push("Source: Qloo Taste AI (aggregate affinities) via Marquee.");
  return lines.join("\n");
}

export const SHELF_COPY: Record<string, { title: string; blurb: (t: string) => string }> = {
  natural: { title: "Natural fits", blurb: (t) => `The categories that usually sponsor a ${t} — now ranked by evidence.` },
  hidden: { title: "Hidden gems", blurb: (t) => `Brands your crowd over-indexes on that aren't typical sponsors for a ${t}.` },
  local: { title: "Local heroes", blurb: () => "Places in your city this crowd loves, from Qloo's place graph." },
};
