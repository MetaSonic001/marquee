// Mirror of apps/api/app/agents/scoring.py — checked against docs/scoring_vectors.json by both test suites.
import type { Components } from "./types";

export const COMPONENTS = ["taste", "overlap", "local", "momentum", "sponsor"] as const;
export type ComponentKey = (typeof COMPONENTS)[number];
export type Lens = "balanced" | "loved" | "city" | "rising" | "proven";

export const LENSES: Record<Lens, Record<ComponentKey, number>> = {
  balanced: { taste: 40, overlap: 30, local: 15, momentum: 10, sponsor: 5 },
  loved: { taste: 45, overlap: 40, local: 5, momentum: 5, sponsor: 5 },
  city: { taste: 25, overlap: 20, local: 45, momentum: 5, sponsor: 5 },
  rising: { taste: 25, overlap: 20, local: 10, momentum: 40, sponsor: 5 },
  proven: { taste: 25, overlap: 20, local: 10, momentum: 5, sponsor: 40 },
};

export const LENS_LABELS: Record<Lens, string> = {
  balanced: "Balanced",
  loved: "Most loved by this crowd",
  city: "Strong in our city",
  rising: "Rising brands",
  proven: "Proven sponsors",
};

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  taste: "Taste match",
  overlap: "Audience overlap",
  local: "Local strength",
  momentum: "Momentum",
  sponsor: "Sponsor activity",
};

export function fitScore(components: Partial<Components>, lens: Lens = "balanced"): number {
  const w = LENSES[lens] ?? LENSES.balanced;
  let total = 0;
  let acc = 0;
  for (const k of COMPONENTS) {
    const v = components[k];
    if (v === null || v === undefined) continue;
    total += w[k];
    acc += w[k] * v;
  }
  if (total === 0) return 0;
  return Math.round((1000 * acc) / total) / 10;
}

export function effectiveWeights(components: Partial<Components>, lens: Lens = "balanced"): Record<ComponentKey, number | null> {
  const w = LENSES[lens] ?? LENSES.balanced;
  const total = COMPONENTS.reduce((s, k) => (components[k] == null ? s : s + w[k]), 0);
  const out = {} as Record<ComponentKey, number | null>;
  for (const k of COMPONENTS) out[k] = components[k] == null || !total ? null : Math.round((1000 * w[k]) / total) / 10;
  return out;
}

export function isLens(x: string | null | undefined): x is Lens {
  return !!x && x in LENSES;
}
