"""Deterministic Marquee Fit. The LLM never produces scores. See docs/SCORING.md.

Each component is normalised to 0..1 from a raw Qloo-derived value; missing components are
dropped and the remaining weights re-normalised. The same weights/lenses are mirrored in
apps/web/src/lib/scoring.ts and checked against shared vectors in docs/scoring_vectors.json."""
from __future__ import annotations

from typing import Any

COMPONENTS = ["taste", "overlap", "local", "momentum", "sponsor"]

LENSES: dict[str, dict[str, float]] = {
    "balanced": {"taste": 40, "overlap": 30, "local": 15, "momentum": 10, "sponsor": 5},
    "loved": {"taste": 45, "overlap": 40, "local": 5, "momentum": 5, "sponsor": 5},
    "city": {"taste": 25, "overlap": 20, "local": 45, "momentum": 5, "sponsor": 5},
    "rising": {"taste": 25, "overlap": 20, "local": 10, "momentum": 40, "sponsor": 5},
    "proven": {"taste": 25, "overlap": 20, "local": 10, "momentum": 5, "sponsor": 40},
}

TOO_CLOSE_POINTS = 5.0


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def norm_taste(rank_position: int | None, n: int) -> float | None:
    """Percentile of the brand's position among n candidates (1 = best)."""
    if rank_position is None or n <= 0:
        return None
    if n == 1:
        return 1.0
    return clamp(1 - (rank_position - 1) / (n - 1))


def norm_overlap(shared: int | None, of: int = 20) -> float | None:
    """Share of the crowd's top tastes also characteristic of the brand's fans; 60%+ saturates."""
    if shared is None or of <= 0:
        return None
    return clamp((shared / of) / 0.6)


def norm_local(city_affinity_rank: float | None) -> float | None:
    """Mean Qloo affinity_rank of the brand's top areas inside the event city (0.5 = median area)."""
    if city_affinity_rank is None:
        return None
    return clamp((city_affinity_rank - 0.5) / 0.5)


def norm_momentum(rel_change: float | None) -> float | None:
    """Relative change in Qloo population percentile over the window; +/-50% saturates."""
    if rel_change is None:
        return None
    return clamp(0.5 + rel_change)


def norm_sponsor(credible_findings: int | None) -> float | None:
    if credible_findings is None:
        return None
    return clamp(credible_findings / 3)


def fit_score(components: dict[str, float | None], lens: str = "balanced") -> float:
    weights = LENSES.get(lens, LENSES["balanced"])
    avail = {k: v for k, v in components.items() if k in weights and v is not None}
    total_w = sum(weights[k] for k in avail)
    if total_w == 0:
        return 0.0
    return round(100 * sum(weights[k] * avail[k] for k in avail) / total_w, 1)


def effective_weights(components: dict[str, float | None], lens: str = "balanced") -> dict[str, float | None]:
    weights = LENSES.get(lens, LENSES["balanced"])
    total = sum(weights[k] for k in COMPONENTS if components.get(k) is not None)
    return {k: (round(100 * weights[k] / total, 1) if components.get(k) is not None and total else None)
            for k in COMPONENTS}


def components_from_metrics(m: dict[str, Any]) -> dict[str, float | None]:
    return {
        "taste": norm_taste(m.get("taste_rank"), m.get("taste_n") or 0),
        "overlap": norm_overlap(m.get("overlap_shared"), m.get("overlap_of") or 20),
        "local": norm_local(m.get("local_affinity_rank")),
        "momentum": norm_momentum(m.get("momentum_rel")),
        "sponsor": norm_sponsor(m.get("sponsor_findings")),
    }


def pick_winner(scored: list[dict]) -> tuple[str | None, float | None, bool]:
    """scored: [{id, slot_score}] -> (winner_id, margin, too_close)."""
    ranked = sorted(scored, key=lambda r: r["slot_score"], reverse=True)
    if not ranked:
        return None, None, False
    if len(ranked) == 1:
        return ranked[0]["id"], None, False
    margin = round(ranked[0]["slot_score"] - ranked[1]["slot_score"], 1)
    return ranked[0]["id"], margin, margin < TOO_CLOSE_POINTS


def verdict(fit: float) -> str:
    if fit >= 70:
        return "Strong fit"
    if fit >= 50:
        return "Good fit"
    return "Weak fit"
