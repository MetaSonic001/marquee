"""LLM writing with code-side validation: every bullet must contain a number and a known evidence id."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.category_map import ACTIVATIONS, CATEGORY_ACTIVATION
from app.agents.llm import json_call, prompt

log = logging.getLogger("marquee.writer")
NUM_RE = re.compile(r"\d")


def valid_bullet(b: Any, allowed: set[str]) -> bool:
    if not isinstance(b, dict):
        return False
    text, ev = str(b.get("text") or ""), str(b.get("evidence") or "")
    return bool(NUM_RE.search(text)) and ev in allowed and 12 <= len(text) <= 320


def evidence_ids(brand_id: str, m: dict, sponsor: dict | None) -> dict[str, str]:
    ids = {f"qloo:rank:{brand_id}": "Qloo · rank"}
    if m.get("overlap_shared") is not None:
        ids[f"qloo:compare_audiences:{brand_id}"] = "Qloo · compare_audiences"
    if m.get("local_affinity_rank") is not None:
        ids[f"qloo:where_popular:{brand_id}"] = "Qloo · where_popular"
    if m.get("momentum_rel") is not None:
        ids[f"qloo:trends:{brand_id}"] = "Qloo · trends"
    if sponsor and sponsor.get("count"):
        ids[f"web:{brand_id}"] = "Web · cited"
    return ids


def fallback_bullets(name: str, m: dict, ov: dict, sponsor: dict | None, brand_id: str) -> list[dict]:
    """Deterministic bullets built straight from the metrics (used only if the model fails validation twice)."""
    out = []
    if m.get("taste_rank"):
        out.append({"text": f"Qloo ranks {name} #{m['taste_rank']} of {m['taste_n']} brands for your crowd's taste profile.",
                    "evidence": f"qloo:rank:{brand_id}"})
    if m.get("overlap_shared") is not None:
        shared = ", ".join(s["name"] for s in (ov.get("shared") or [])[:3])
        out.append({"text": f"{name}'s fans share {m['overlap_shared']} of your crowd's top {m['overlap_of']} tastes"
                            + (f" ({shared})." if shared else "."), "evidence": f"qloo:compare_audiences:{brand_id}"})
    if m.get("local_top_pct") is not None:
        out.append({"text": f"In {m.get('local_city')}, {name} sits in the top {m['local_top_pct']:g}% of areas Qloo measures.",
                    "evidence": f"qloo:where_popular:{brand_id}"})
    elif m.get("momentum_pct") is not None:
        out.append({"text": f"Qloo popularity for {name} moved {m['momentum_pct']:+g}% over 12 months.",
                    "evidence": f"qloo:trends:{brand_id}"})
    return out[:3]


def brand_payload(b: dict) -> dict:
    m = b["metrics"]
    ov = b.get("overlap") or {}
    return {
        "brand_id": b["qloo_entity_id"], "name": b["name"], "category": b["category"], "shelf": b["shelf"],
        "metrics": {k: v for k, v in m.items() if v is not None},
        "shared_tastes": [s["name"] for s in (ov.get("shared") or [])[:6]],
        "brand_fans_also_like": [a["name"] for a in (ov.get("brand_fan_artists") or [])[:4]],
        "sponsor_activity": (b.get("sponsor_activity") or {}).get("summary"),
        "allowed_evidence": list(b["_evidence"].keys()),
    }


async def write_brand_bullets(brands: list[dict], event: dict) -> None:
    """Mutates each brand dict: sets why[] and start_here{}."""
    if not brands:
        return
    for b in brands:
        b["_evidence"] = evidence_ids(b["qloo_entity_id"], b["metrics"], b.get("sponsor_activity"))
    pending = list(brands)
    for _attempt in range(2):
        if not pending:
            break
        chunks = [pending[i:i + 3] for i in range(0, len(pending), 3)]
        failed: list[dict] = []
        for chunk in chunks:
            user = json.dumps({"event": event, "activation_options": ACTIVATIONS,
                               "brands": [brand_payload(b) for b in chunk]})
            try:
                data = await json_call(prompt("why_bullets"), user, max_tokens=1800)
            except Exception as e:  # noqa: BLE001
                log.warning("bullet writing failed: %s", e)
                data = {}
            by_id = {x.get("brand_id"): x for x in (data.get("brands") or []) if isinstance(x, dict)}
            for b in chunk:
                got = by_id.get(b["qloo_entity_id"]) or {}
                allowed = set(b["_evidence"])
                bullets = [x for x in (got.get("why") or []) if valid_bullet(x, allowed)][:3]
                act = got.get("activation") or {}
                if len(bullets) >= 2:
                    b["why"] = [{**x, "source": b["_evidence"][x["evidence"]]} for x in bullets]
                    a_type = act.get("type") if act.get("type") in ACTIVATIONS else CATEGORY_ACTIVATION.get(b["category_key"], "Content series")
                    b["start_here"] = {"activation": a_type, "reason": str(act.get("reason") or "")[:200]}
                else:
                    failed.append(b)
        pending = failed
    for b in pending:
        bl = fallback_bullets(b["name"], b["metrics"], b.get("overlap") or {}, b.get("sponsor_activity"), b["qloo_entity_id"])
        b["why"] = [{**x, "source": b["_evidence"].get(x["evidence"], "Qloo")} for x in bl]
        b["start_here"] = {"activation": CATEGORY_ACTIVATION.get(b["category_key"], "Content series"),
                           "reason": "Suggested from the brand's category (writer unavailable)."}
    for b in brands:
        b.pop("_evidence", None)


async def crowd_summary(fingerprint: dict, tags: list, demographics: dict, event: dict) -> tuple[str, list]:
    data = {"event": event, "fingerprint": {d: [{"id": i["id"], "name": i["name"], "affinity": i.get("affinity")}
                                                for i in items[:6]] for d, items in fingerprint.items()},
            "top_tags": tags[:12], "demographics": demographics}
    try:
        out = await json_call(prompt("crowd_summary"), json.dumps(data), max_tokens=700)
        text = str(out.get("summary") or "").strip()
        cited = [c for c in (out.get("cited_ids") or []) if isinstance(c, str)]
        all_ids = {i["id"] for items in fingerprint.values() for i in items}
        cited = [c for c in cited if c in all_ids]
        if text and cited:
            return text, cited
    except Exception as e:  # noqa: BLE001
        log.warning("crowd summary failed: %s", e)
    return "", []


async def slot_rationale(slot_name: str, first: dict, second: dict, too_close: bool) -> list[dict]:
    # compute in code which metrics actually favour #1, so the model can only cite real advantages
    adv: list[dict] = []
    if first.get("rank_position") and second.get("rank_position") and first["rank_position"] < second["rank_position"]:
        adv.append({"metric": "Qloo head-to-head rank", "first": f"#{first['rank_position']}", "second": f"#{second['rank_position']}",
                    "evidence": "qloo:rank:slot"})
    if (first.get("overlap_shared") or 0) > (second.get("overlap_shared") or 0):
        adv.append({"metric": "shared tastes with the crowd (higher is better)", "first": first["overlap_shared"],
                    "second": second["overlap_shared"], "of": first.get("overlap_of"), "evidence": "qloo:compare_audiences"})
    if first.get("local_top_pct") is not None and second.get("local_top_pct") is not None             and first["local_top_pct"] < second["local_top_pct"]:
        adv.append({"metric": "local strength: top % of areas in the event city (lower is stronger)",
                    "first": first["local_top_pct"], "second": second["local_top_pct"], "evidence": "qloo:where_popular"})
    if (first.get("momentum_pct") or -999) > (second.get("momentum_pct") or -999) and first.get("momentum_pct") is not None:
        adv.append({"metric": "12-month momentum %", "first": first["momentum_pct"], "second": second["momentum_pct"],
                    "evidence": "qloo:trends"})
    allowed = {a["evidence"] for a in adv}
    if not adv:
        return []
    payload = {"slot": slot_name, "too_close": too_close, "first": first["name"], "second": second["name"],
               "advantages_of_first": adv}
    for _ in range(2):
        try:
            out = await json_call(prompt("slot_rationale"), json.dumps(payload), max_tokens=500)
            bullets = [b for b in (out.get("bullets") or []) if valid_bullet(b, allowed)][:2]
            if bullets:
                return bullets
        except Exception as e:  # noqa: BLE001
            log.warning("slot rationale failed: %s", e)
    # deterministic fallback straight from the advantages
    return [{"text": f"{a['metric'].split(' (')[0].capitalize()}: {first['name']} {a['first']} vs {a['second']} for {second['name']}.",
             "evidence": a["evidence"]} for a in adv[:2]]
