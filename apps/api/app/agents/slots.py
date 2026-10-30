"""Sponsor slots: one brand per category, ranked head-to-head with qloo_rank for this crowd."""
from __future__ import annotations

import asyncio
from typing import Any

from sqlmodel import select

from app.agents import metrics as M
from app.agents.category_map import CATEGORY_LABELS, classify, excluded_categories
from app.agents.scoring import components_from_metrics, fit_score, norm_taste, pick_winner
from app.agents.writer import slot_rationale
from app.db import BrandCheck, BrandMatch, CrowdSignal, Event, SponsorSlot, now, session
from app.qloo.gateway import gateway

# a slot accepts brands from these categories
SLOT_ACCEPTS = {
    "beverage": {"beverage", "energy_drink", "alcohol"},
    "energy_drink": {"energy_drink", "beverage"},
    "apparel": {"apparel"},
    "food_delivery": {"food_delivery"},
    "telecom": {"telecom"},
    "tech_gaming": {"tech_gaming", "music_gear"},
    "automotive": {"automotive"},
    "financial": {"financial"},
    "media": {"media", "tech_gaming"},
}


def demographic_from(age_bands: list[str] | None) -> str | None:
    if not age_bands:
        return None
    nums: list[int] = []
    for b in age_bands:
        for part in str(b).replace("+", "-99").split("-"):
            if part.strip().isdigit():
                nums.append(int(part))
    if not nums:
        return None
    lo, hi = min(nums), max(nums)
    return f"adults {lo}+" if hi >= 99 else f"adults {lo}-{hi}"


def fan_type_for(event_id: str) -> str:
    """Compare like with like: musician crowds against brand fans' artists, everyone else against people."""
    with session() as db:
        sigs = db.exec(select(CrowdSignal).where(CrowdSignal.event_id == event_id,
                                                 CrowdSignal.status == "resolved")).all()
    artists = sum(1 for s in sigs if (s.entity_type or "artist") == "artist")
    return "artist" if artists * 2 >= max(1, len(sigs)) else "person"


def crowd_ids_for(event_id: str) -> list[str]:
    with session() as db:
        sigs = db.exec(select(CrowdSignal).where(CrowdSignal.event_id == event_id,
                                                 CrowdSignal.status == "resolved")).all()
    return [s.qloo_entity_id for s in sigs if s.qloo_entity_id][:10]


async def measure(brand_id: str, name: str, event: Event, crowd_ids: list[str], emit: M.Emit = M._noop,
                  stage: int = 0) -> tuple[dict, dict, dict]:
    ov, loc, tr = await asyncio.gather(
        M.overlap(brand_id, name, crowd_ids, emit, stage, fan_type_for(event.id)),
        M.local_strength(brand_id, name, event.city, event.country, emit, stage),
        M.momentum([brand_id], "brand", emit, stage),
    )
    return ov, loc, tr.get(brand_id, {"available": False})


def known_measurements(event_id: str) -> dict[str, dict]:
    """Reuse measurements already stored for this event (run matches first, then brand checks)."""
    out: dict[str, dict] = {}
    with session() as db:
        ev = db.get(Event, event_id)
        if ev and ev.latest_run_id:
            for m in db.exec(select(BrandMatch).where(BrandMatch.run_id == ev.latest_run_id)).all():
                out[m.qloo_entity_id] = {"overlap": m.overlap, "local": m.local, "trend": m.trend,
                                         "sponsor": m.sponsor_activity, "category_key": m.category_key,
                                         "logo_url": m.logo_url}
        for c in db.exec(select(BrandCheck).where(BrandCheck.event_id == event_id)).all():
            out.setdefault(c.qloo_entity_id, {"overlap": c.overlap, "local": c.local, "trend": c.trend,
                                              "sponsor": c.sponsor_activity, "category_key": c.category_key,
                                              "logo_url": c.logo_url})
    return out


async def rank_slot(slot_id: str, emit: M.Emit = M._noop, stage: int = 0) -> SponsorSlot:
    with session() as db:
        slot = db.get(SponsorSlot, slot_id)
        if not slot:
            raise ValueError("slot not found")
        event = db.get(Event, slot.event_id)
    assert event
    crowd = crowd_ids_for(event.id)
    known = known_measurements(event.id)
    excl = excluded_categories(event.exclude_categories)
    existing = {s.lower() for s in (event.existing_sponsors or [])}

    cands: list[dict[str, Any]] = [dict(c) for c in slot.candidates][:8]
    # categories for candidates we haven't seen (user-added)
    unknown = [c["qloo_entity_id"] for c in cands if c["qloo_entity_id"] not in known and not c.get("category_key")]
    if unknown:
        for e in await gateway.entities(unknown):
            for c in cands:
                if c["qloo_entity_id"] == e["entity_id"]:
                    c["category_key"] = classify(e.get("tags"), e.get("short_description"))
                    c.setdefault("logo_url", e.get("image"))
    for c in cands:
        k = known.get(c["qloo_entity_id"], {})
        c.setdefault("category_key", k.get("category_key") or "other")
        if not c.get("logo_url"):
            c["logo_url"] = k.get("logo_url")
        c["excluded_reason"] = None
        if c["category_key"] in excl:
            c["excluded_reason"] = f"{CATEGORY_LABELS.get(c['category_key'], c['category_key'])} is excluded for this event"
        elif c["name"].lower() in existing:
            c["excluded_reason"] = "Already an existing sponsor"

    active = [c for c in cands if not c["excluded_reason"]]
    ranking: list[dict] = []
    without_rank = False
    if len(active) >= 2:
        args: dict[str, Any] = {"options": [c["qloo_entity_id"] for c in active], "option_type": "brand",
                                "signals": crowd}
        demo = demographic_from(event.age_bands)
        if demo:
            args["demographic"] = demo
        env = await M.qcall("qloo_rank", args, emit, stage, f"Head-to-head: {len(active)} candidates for {slot.name}")
        aff = M.rank_affinities(env) if env.get("status") in {"ok", "partial", "degraded"} else {}
        without_rank = not aff
        order = sorted(aff.items(), key=lambda kv: kv[1], reverse=True)
        pos = {cid: i + 1 for i, (cid, _a) in enumerate(order)}

        async def one(c: dict) -> dict:
            k = known.get(c["qloo_entity_id"])
            if k and k.get("overlap") and k.get("trend") is not None and k.get("local") is not None:
                ov, loc, tr, sp = k["overlap"], k["local"], k["trend"], k.get("sponsor") or {}
            else:
                ov, loc, tr = await measure(c["qloo_entity_id"], c["name"], event, crowd, emit, stage)
                sp = {}
            rp = pos.get(c["qloo_entity_id"])
            m = M.metrics_from({"rank": rp, "n": len(active), "affinity": aff.get(c["qloo_entity_id"])} if rp else None,
                               ov, loc, tr, sp.get("count") if sp else None)
            comps = components_from_metrics(m)
            if rp is None:
                comps["taste"] = None
            else:
                comps["taste"] = norm_taste(rp, len(pos))
            return {"qloo_entity_id": c["qloo_entity_id"], "name": c["name"], "source": c.get("source", "discovered"),
                    "logo_url": c.get("logo_url"), "category_key": c["category_key"],
                    "rank_position": rp, "rank_score": aff.get(c["qloo_entity_id"]),
                    "metrics": m, "components": comps, "slot_score": fit_score(comps),
                    "shared": [s["name"] for s in (ov.get("shared") or [])[:5]] if ov else []}

        ranking = list(await asyncio.gather(*(one(c) for c in active)))
        ranking.sort(key=lambda r: r["slot_score"], reverse=True)
    winner, margin, too_close = pick_winner([{"id": r["qloo_entity_id"], "slot_score": r["slot_score"]} for r in ranking])

    rationale: dict[str, Any] = {}
    if len(ranking) >= 2:
        def brief(r: dict) -> dict:
            m = r["metrics"]
            return {"name": r["name"], "slot_score": r["slot_score"], "rank_position": r["rank_position"],
                    "rank_score": round(r["rank_score"], 3) if r["rank_score"] else None,
                    "overlap_shared": m.get("overlap_shared"), "overlap_of": m.get("overlap_of"),
                    "local_top_pct": m.get("local_top_pct"), "momentum_pct": m.get("momentum_pct")}
        rationale = {"bullets": await slot_rationale(slot.name, brief(ranking[0]), brief(ranking[1]), too_close)}

    with session() as db:
        s = db.get(SponsorSlot, slot_id)
        assert s
        s.candidates = cands
        s.ranking = ranking
        s.winner_id = winner
        s.margin = margin
        s.too_close = too_close
        s.rationale = rationale
        s.ranked_without_qloo_rank = without_rank
        s.ranked_at = now()
        db.add(s)
        db.commit()
        db.refresh(s)
        return s
