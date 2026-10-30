"""Check a brand: a quantified fit report for one (often inbound) brand against the event's crowd."""
from __future__ import annotations

import asyncio

from sqlmodel import select

from app.agents import metrics as M
from app.agents.category_map import CATEGORY_LABELS, EVENT_TYPE_LABELS, classify
from app.agents.scoring import components_from_metrics, fit_score, verdict
from app.agents.slots import crowd_ids_for, demographic_from, measure
from app.agents.web import sponsor_activity
from app.agents.writer import write_brand_bullets
from app.db import BrandCheck, BrandMatch, Event, session
from app.qloo.gateway import gateway


async def check_brand(event_id: str, brand_id: str, brand_name: str, emit: M.Emit = M._noop) -> BrandCheck:
    with session() as db:
        event = db.get(Event, event_id)
        assert event
        peers = db.exec(select(BrandMatch).where(BrandMatch.run_id == event.latest_run_id, BrandMatch.shelf != "local")
                        ).all() if event.latest_run_id else []
    crowd = crowd_ids_for(event_id)
    if not crowd:
        raise ValueError("This event has no confirmed crowd signals yet.")
    # peers sampled across the run's whole taste ranking, so the position reads as a percentile
    ordered = [p.qloo_entity_id for p in sorted(peers, key=lambda p: p.metrics.get("taste_rank") or 99)
               if p.qloo_entity_id != brand_id]
    step = max(1, len(ordered) // 9)
    peer_ids = ordered[::step][:9]
    args = {"options": [brand_id, *peer_ids], "option_type": "brand", "signals": crowd}
    demo = demographic_from(event.age_bands)
    if demo:
        args["demographic"] = demo
    await emit(1, "stage_start", summary=f"Checking {brand_name} against your crowd")
    rank_env = M.qcall("qloo_rank", args, emit, 1, f"Ranking {brand_name} against {len(peer_ids)} brands from your shortlist")
    ents_task = gateway.entities([brand_id])
    meas_task = measure(brand_id, brand_name, event, crowd, emit, 1)
    web_task = sponsor_activity(brand_name, EVENT_TYPE_LABELS.get(event.type, "event"))
    env, ents, (ov, loc, tr), sp = await asyncio.gather(rank_env, ents_task, meas_task, web_task)
    aff = M.rank_affinities(env)
    order = [k for k, _ in sorted(aff.items(), key=lambda kv: kv[1], reverse=True)]
    taste = {"rank": order.index(brand_id) + 1, "n": len(order), "affinity": aff[brand_id]} if brand_id in aff else None
    e = ents[0] if ents else {}
    cat = classify(e.get("tags"), e.get("short_description"))
    m = M.metrics_from(taste, ov, loc, tr, sp.get("count") if sp.get("status") == "ok" else None)
    comps = components_from_metrics(m)
    fit = fit_score(comps)
    b = {"qloo_entity_id": brand_id, "name": brand_name, "category": CATEGORY_LABELS.get(cat, "Other"),
         "category_key": cat, "shelf": "check", "metrics": m, "overlap": ov, "sponsor_activity": sp}
    await emit(1, "tool_call", tool="writer", summary="Writing the verdict")
    await write_brand_bullets([b], {"name": event.name, "type": EVENT_TYPE_LABELS.get(event.type), "city": event.city})
    v = verdict(fit)
    reasons = [w["text"] for w in b.get("why", [])]
    row = BrandCheck(event_id=event_id, qloo_entity_id=brand_id, name=brand_name, category=b["category"],
                     category_key=cat, logo_url=e.get("image"), fit=fit, components=comps, metrics=m,
                     why=b.get("why", []), overlap=ov, local=loc, trend=tr, sponsor_activity=sp,
                     verdict=v, verdict_reasons=reasons)
    with session() as db:
        db.add(row)
        db.commit()
        db.refresh(row)
    await emit(1, "done", summary=f"{brand_name}: {v} ({fit:.0f})")
    return row
