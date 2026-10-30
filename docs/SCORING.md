# Marquee Fit — scoring

Computed deterministically in `apps/api/app/agents/scoring.py` and mirrored in `apps/web/src/lib/scoring.ts`. Both are tested against `docs/scoring_vectors.json`.

| Component | Weight | Raw Qloo value | Normalisation (0–1) |
|---|---|---|---|
| Taste match | 40 | Position of the brand among all candidates in `qloo_rank` (same crowd profile, batches of ≤10) | `1 − (rank − 1)/(n − 1)` |
| Audience overlap | 30 | Tags shared by `compare_audiences(crowd, brand-fans' top artists)`, out of the crowd's top 20 | `(shared/20) / 0.6`, capped at 1 |
| Local strength | 15 | Mean `affinity_rank` of the brand's top 5 areas inside the event city (`where_popular`) | `(x − 0.5)/0.5`, clamped |
| Momentum | 10 | Relative change of `population_percentile` (first vs last weeks, `trends`) | `0.5 + change`, clamped; flat series = unavailable |
| Sponsor activity | 5 | Count of cited web findings (2025–26) | `count/3`, capped |

**Fit** = `100 × Σ wᵢ·cᵢ / Σ wᵢ` over the *available* components. A missing component is shown as "n/a" and its weight is redistributed.

**Lenses** (client-side re-weighting, no API calls):

| Lens | taste | overlap | local | momentum | sponsor |
|---|---|---|---|---|---|
| Balanced | 40 | 30 | 15 | 10 | 5 |
| Most loved by this crowd | 45 | 40 | 5 | 5 | 5 |
| Strong in our city | 25 | 20 | 45 | 5 | 5 |
| Rising brands | 25 | 20 | 10 | 40 | 5 |
| Proven sponsors | 25 | 20 | 10 | 5 | 40 |

**Sponsor slots:** slot score = the same formula, with taste taken from the brand's position in a `qloo_rank` call over just that slot's candidates. Winner = highest score; "Too close to call" when the margin is under 5 points. If `qloo_rank` is empty, the slot is ranked on the other components and labelled accordingly.

**Verdicts (Check a brand):** Strong ≥ 70, Good ≥ 50, else Weak.

**Local heroes** (places) are ranked on their own shelf; their fit is Qloo's recommendation affinity for the crowd.
