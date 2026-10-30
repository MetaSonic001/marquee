"""HTTP + SSE API. The browser identifies its anonymous workspace with a signed token header."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import shutil
import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from itsdangerous import BadSignature, Signer
from pydantic import BaseModel
from sqlmodel import select
from sse_starlette.sse import EventSourceResponse

from app.agents.category_map import CATEGORY_LABELS, DEFAULT_SLOTS, EVENT_TYPE_LABELS
from app.agents.check import check_brand
from app.agents.llm import json_call, prompt
from app.agents.pipeline import STAGES, start_run
from app.agents.resolve import resolve
from app.agents.scoring import LENSES, fit_score
from app.agents.slots import rank_slot
from app.config import get_settings
from app.db import (
    BrandCheck,
    BrandMatch,
    CrowdProfile,
    CrowdSignal,
    Event,
    LlmOnlyComparison,
    RateHit,
    Run,
    RunEvent,
    SponsorSlot,
    Workspace,
    now,
    session,
)
from app.intake.extract import run_intake
from app.qloo.gateway import gateway
from app.runbus import bus

log = logging.getLogger("marquee.api")
router = APIRouter()
SAMPLE_WS = "samples"
MAX_PDF_MB, MAX_IMG_MB = 15, 10


# ---------------- workspace ----------------
def signer() -> Signer:
    return Signer(get_settings().app_secret, salt="marquee-ws")


def current_ws(x_workspace: str | None = Header(default=None)) -> str | None:
    if not x_workspace:
        return None
    try:
        return signer().unsign(x_workspace).decode()
    except BadSignature:
        return None


def require_ws(ws: str | None = Depends(current_ws)) -> str:
    if not ws:
        raise HTTPException(401, "No workspace. Reload the page to get one.")
    return ws


def get_event(event_id: str) -> Event:
    with session() as db:
        ev = db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Event not found")
    return ev


def owned_event(event_id: str, ws: str) -> Event:
    ev = get_event(event_id)
    if ev.workspace_id != ws:
        raise HTTPException(403, "Sample events are read-only. Use “Duplicate to edit”.")
    return ev


def rate_limit(ws: str, kind: str, per_hour: int) -> None:
    with session() as db:
        since = now() - timedelta(hours=1)
        n = len(db.exec(select(RateHit).where(RateHit.workspace_id == ws, RateHit.kind == kind,
                                              RateHit.created_at > since)).all())
        if n >= per_hour:
            raise HTTPException(429, f"Limit reached: {per_hour} {kind.replace('_', ' ')}s per hour. Try again later.")
        db.add(RateHit(workspace_id=ws, kind=kind))
        db.commit()


@router.get("/health")
async def health() -> dict:
    db_ok = True
    try:
        with session() as db:
            db.exec(select(Workspace).limit(1)).all()
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"ok": True, "db": db_ok, "qloo_ready": gateway.ready, "qloo_error": gateway.last_error,
            "qloo_calls": gateway.calls}


@router.post("/workspace")
async def create_workspace() -> dict:
    with session() as db:
        w = Workspace()
        db.add(w)
        db.commit()
        wid = w.id
    return {"workspace_id": wid, "token": signer().sign(wid).decode()}


# ---------------- serialization ----------------
def event_card(ev: Event) -> dict:
    d = ev.model_dump()
    d["type_label"] = EVENT_TYPE_LABELS.get(ev.type, ev.type)
    with session() as db:
        top = []
        if ev.latest_run_id:
            ms = db.exec(select(BrandMatch).where(BrandMatch.run_id == ev.latest_run_id, BrandMatch.shelf != "local",
                                                  BrandMatch.is_existing == False, BrandMatch.hidden == False)).all()  # noqa: E712
            top = [{"name": m.name, "logo_url": m.logo_url, "fit": m.fit} for m in sorted(ms, key=lambda m: -m.fit)[:3]]
        sigs = db.exec(select(CrowdSignal).where(CrowdSignal.event_id == ev.id)).all()
    d["top_brands"] = top
    d["signals"] = [s.display_name or s.raw_text for s in sigs if s.status == "resolved"]
    return d


def full_event(ev: Event, ws: str | None) -> dict:
    with session() as db:
        sigs = db.exec(select(CrowdSignal).where(CrowdSignal.event_id == ev.id)).all()
        run = db.get(Run, ev.latest_run_id) if ev.latest_run_id else None
        last_run = db.exec(select(Run).where(Run.event_id == ev.id).order_by(Run.started_at.desc())).first()  # type: ignore[attr-defined]
        profile = db.exec(select(CrowdProfile).where(CrowdProfile.run_id == ev.latest_run_id)).first() if run else None
        matches = db.exec(select(BrandMatch).where(BrandMatch.run_id == ev.latest_run_id)).all() if run else []
        slots = db.exec(select(SponsorSlot).where(SponsorSlot.event_id == ev.id)).all()
        checks = db.exec(select(BrandCheck).where(BrandCheck.event_id == ev.id)).all()
        llm = db.exec(select(LlmOnlyComparison).where(LlmOnlyComparison.event_id == ev.id)
                      .order_by(LlmOnlyComparison.created_at.desc())).first()  # type: ignore[attr-defined]
    d = event_card(ev)
    d.update({
        "editable": ws is not None and ev.workspace_id == ws,
        "crowd_signals": [s.model_dump() for s in sigs],
        "run": run.model_dump() if run else None,
        "last_run": last_run.model_dump() if last_run else None,
        "crowd": profile.model_dump() if profile else None,
        "matches": [m.model_dump() for m in matches],
        "slots": [s.model_dump() for s in sorted(slots, key=lambda s: s.order)],
        "checks": [c.model_dump() for c in sorted(checks, key=lambda c: c.created_at)],
        "llm_only": llm.model_dump() if llm else None,
        "lenses": LENSES,
        "category_labels": CATEGORY_LABELS,
    })
    return d


# ---------------- samples / events ----------------
def _samples() -> list[dict]:
    with session() as db:
        evs = db.exec(select(Event).where(Event.is_sample == True).order_by(Event.sample_order)).all()  # noqa: E712
    return [event_card(e) for e in evs]


@router.get("/samples")
async def samples() -> list[dict]:
    return await asyncio.to_thread(cached, "samples", _samples)


@router.get("/events")
async def list_events(ws: str | None = Depends(current_ws)) -> dict:
    with session() as db:
        mine = db.exec(select(Event).where(Event.workspace_id == ws)).all() if ws else []
    return {"mine": [event_card(e) for e in sorted(mine, key=lambda e: e.created_at, reverse=True)],
            "samples": await samples()}


class SignalIn(BaseModel):
    raw_text: str
    qloo_entity_id: str | None = None
    entity_type: str | None = None
    display_name: str | None = None
    image_url: str | None = None
    status: str = "pending"


class EventIn(BaseModel):
    name: str
    type: str = "festival"
    city: str | None = None
    country: str | None = None
    dates: str | None = None
    attendance: int | None = None
    age_bands: list[str] = []
    exclude_categories: list[str] = []
    existing_sponsors: list[str] = []
    field_sources: dict = {}
    signals: list[SignalIn] = []


def create_event_row(data: EventIn, ws: str, **extra: Any) -> Event:
    with session() as db:
        ev = Event(workspace_id=ws, **data.model_dump(exclude={"signals"}), **extra)
        db.add(ev)
        db.commit()
        db.refresh(ev)
        for s in data.signals:
            st = "resolved" if s.qloo_entity_id else s.status
            db.add(CrowdSignal(event_id=ev.id, raw_text=s.raw_text, qloo_entity_id=s.qloo_entity_id,
                               entity_type=s.entity_type, display_name=s.display_name or s.raw_text,
                               image_url=s.image_url, status=st))
        db.commit()
        return ev


@router.post("/events")
async def create_event(data: EventIn, ws: str = Depends(require_ws)) -> dict:
    ev = create_event_row(data, ws)
    return full_event(ev, ws)


_sample_cache: dict[str, tuple[float, Any]] = {}
SAMPLE_TTL = 300.0


def cached(key: str, build):
    """Sample events are read-only for visitors, so their (slow, many-query) payloads are cached briefly."""
    import time

    hit = _sample_cache.get(key)
    if hit and time.monotonic() - hit[0] < SAMPLE_TTL:
        return hit[1]
    val = build()
    _sample_cache[key] = (time.monotonic(), val)
    return val


@router.get("/events/{event_id}")
async def read_event(event_id: str, ws: str | None = Depends(current_ws)) -> dict:
    ev = get_event(event_id)
    if ev.is_sample and ev.workspace_id != ws:
        return await asyncio.to_thread(cached, f"event:{event_id}", lambda: full_event(ev, ws))
    return await asyncio.to_thread(full_event, ev, ws)


class EventPatch(BaseModel):
    name: str | None = None
    city: str | None = None
    country: str | None = None
    dates: str | None = None
    attendance: int | None = None
    exclude_categories: list[str] | None = None
    existing_sponsors: list[str] | None = None
    age_bands: list[str] | None = None


@router.patch("/events/{event_id}")
async def patch_event(event_id: str, data: EventPatch, ws: str = Depends(require_ws)) -> dict:
    ev = owned_event(event_id, ws)
    with session() as db:
        ev = db.get(Event, event_id)
        assert ev
        for k, v in data.model_dump(exclude_none=True).items():
            setattr(ev, k, v)
        db.add(ev)
        db.commit()
    return full_event(ev, ws)


@router.post("/samples/{event_id}/duplicate")
async def duplicate(event_id: str, ws: str = Depends(require_ws)) -> dict:
    src = get_event(event_id)
    with session() as db:
        data = src.model_dump(exclude={"id", "workspace_id", "is_sample", "sample_order", "latest_run_id", "created_at"})
        ev = Event(workspace_id=ws, **{**data, "name": f"{src.name} (copy)"})
        db.add(ev)
        db.commit()
        for s in db.exec(select(CrowdSignal).where(CrowdSignal.event_id == src.id)).all():
            db.add(CrowdSignal(**s.model_dump(exclude={"id", "event_id"}), event_id=ev.id))
        if src.latest_run_id:
            old = db.get(Run, src.latest_run_id)
            run = Run(event_id=ev.id, status="done", stage=8, started_at=old.started_at if old else now(),
                      finished_at=old.finished_at if old else now())
            db.add(run)
            db.commit()
            for re_ in db.exec(select(RunEvent).where(RunEvent.run_id == src.latest_run_id)).all():
                db.add(RunEvent(run_id=run.id, seq=re_.seq, stage=re_.stage, kind=re_.kind,
                                payload={**re_.payload, "run_id": run.id}))
            for p in db.exec(select(CrowdProfile).where(CrowdProfile.run_id == src.latest_run_id)).all():
                db.add(CrowdProfile(**p.model_dump(exclude={"id", "run_id", "event_id"}), run_id=run.id, event_id=ev.id))
            for m in db.exec(select(BrandMatch).where(BrandMatch.run_id == src.latest_run_id)).all():
                db.add(BrandMatch(**m.model_dump(exclude={"id", "run_id", "event_id"}), run_id=run.id, event_id=ev.id))
            ev.latest_run_id = run.id
        for s in db.exec(select(SponsorSlot).where(SponsorSlot.event_id == src.id)).all():
            db.add(SponsorSlot(**s.model_dump(exclude={"id", "event_id"}), event_id=ev.id))
        for c in db.exec(select(BrandCheck).where(BrandCheck.event_id == src.id)).all():
            db.add(BrandCheck(**c.model_dump(exclude={"id", "event_id"}), event_id=ev.id))
        db.add(ev)
        db.commit()
        db.refresh(ev)
    return full_event(ev, ws)


# ---------------- resolve ----------------
class ResolveIn(BaseModel):
    text: str
    type: str | None = None


@router.post("/resolve")
async def resolve_route(data: ResolveIn) -> dict:
    return await resolve(data.text[:120], data.type)


# ---------------- runs ----------------
@router.post("/events/{event_id}/runs")
async def create_run(event_id: str, ws: str = Depends(require_ws)) -> dict:
    owned_event(event_id, ws)
    rate_limit(ws, "live_run", get_settings().live_runs_per_hour)
    rid = await start_run(event_id)
    return {"run_id": rid}


@router.get("/runs/{run_id}")
async def read_run(run_id: str) -> dict:
    with session() as db:
        r = db.get(Run, run_id)
    if not r:
        raise HTTPException(404, "Run not found")
    return {**r.model_dump(), "stages": STAGES}


@router.get("/runs/{run_id}/stream")
async def stream_run(run_id: str, after: int = 0):
    with session() as db:
        r = db.get(Run, run_id)
    if not r:
        raise HTTPException(404, "Run not found")

    async def gen():
        q = bus.subscribe(run_id)
        try:
            last = after
            for ev in await asyncio.to_thread(bus.history, run_id, after):
                last = ev["seq"]
                yield {"id": str(ev["seq"]), "data": json.dumps(ev)}
            with session() as db:
                cur = db.get(Run, run_id)
            if cur and cur.status != "running":
                if cur.status == "interrupted":
                    yield {"data": json.dumps({"seq": last + 1, "stage": cur.stage, "kind": "error",
                                               "summary": "Interrupted — re-run"})}
                return
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), 20)
                except TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                if ev["seq"] <= last:
                    continue
                last = ev["seq"]
                yield {"id": str(ev["seq"]), "data": json.dumps(ev)}
                if ev["kind"] in ("done", "error") and ev.get("stage") in (0, 8):
                    return
        finally:
            bus.unsubscribe(run_id, q)

    return EventSourceResponse(gen())


# ---------------- matches ----------------
class MatchPatch(BaseModel):
    saved: bool | None = None
    hidden: bool | None = None


@router.patch("/matches/{match_id}")
async def patch_match(match_id: str, data: MatchPatch, ws: str = Depends(require_ws)) -> dict:
    with session() as db:
        m = db.get(BrandMatch, match_id)
        if not m:
            raise HTTPException(404, "Not found")
        owned_event(m.event_id, ws)
        for k, v in data.model_dump(exclude_none=True).items():
            setattr(m, k, v)
        db.add(m)
        db.commit()
        db.refresh(m)
        return m.model_dump()


# ---------------- check a brand ----------------
class CheckIn(BaseModel):
    qloo_entity_id: str
    name: str


def sse_task(work) -> EventSourceResponse:
    """Run `work(emit)` and stream its events, ending with {"kind":"result"}."""
    q: asyncio.Queue = asyncio.Queue()
    seq = {"n": 0}

    async def emit(stage: int, kind: str, tool: str | None = None, summary: str = "", data: Any = None):
        seq["n"] += 1
        ev = {"seq": seq["n"], "stage": stage, "kind": kind, "summary": summary}
        if tool:
            ev["tool"] = tool
        if data is not None:
            ev["data"] = data
        await q.put(ev)

    async def runner():
        try:
            res = await work(emit)
            await q.put({"seq": seq["n"] + 1, "kind": "result", "data": res})
        except HTTPException as e:
            await q.put({"seq": seq["n"] + 1, "kind": "error", "summary": e.detail})
        except Exception as e:  # noqa: BLE001
            log.exception("task failed")
            await q.put({"seq": seq["n"] + 1, "kind": "error", "summary": str(e)[:300]})
        await q.put(None)

    async def gen():
        t = asyncio.create_task(runner())
        while True:
            try:
                ev = await asyncio.wait_for(q.get(), 15)
            except TimeoutError:
                yield {"event": "ping", "data": "{}"}
                continue
            if ev is None:
                break
            yield {"data": json.dumps(ev, default=str)}
        await t

    return EventSourceResponse(gen())


@router.post("/events/{event_id}/check-brand")
async def check_brand_route(event_id: str, data: CheckIn, ws: str = Depends(require_ws)):
    owned_event(event_id, ws)
    rate_limit(ws, "brand_check", get_settings().brand_checks_per_hour)

    async def work(emit):
        row = await check_brand(event_id, data.qloo_entity_id, data.name, emit)
        return row.model_dump()

    return sse_task(work)


@router.delete("/checks/{check_id}")
async def delete_check(check_id: str, ws: str = Depends(require_ws)) -> dict:
    with session() as db:
        c = db.get(BrandCheck, check_id)
        if not c:
            raise HTTPException(404, "Not found")
        owned_event(c.event_id, ws)
        db.delete(c)
        db.commit()
    return {"ok": True}


# ---------------- slots ----------------
class SlotIn(BaseModel):
    name: str
    category_key: str = "other"
    tier_label: str | None = "Official"


class SlotPatch(BaseModel):
    name: str | None = None
    tier_label: str | None = None
    add: list[dict] | None = None  # [{qloo_entity_id, name, source}]
    remove: list[str] | None = None


@router.get("/events/{event_id}/slots")
async def list_slots(event_id: str) -> list[dict]:
    with session() as db:
        return [s.model_dump() for s in db.exec(select(SponsorSlot).where(SponsorSlot.event_id == event_id)).all()]


@router.get("/slot-templates/{event_type}")
async def slot_templates(event_type: str) -> list[dict]:
    return [{"name": n, "category_key": k} for n, k in DEFAULT_SLOTS.get(event_type, DEFAULT_SLOTS["other"])]


@router.post("/events/{event_id}/slots")
async def create_slot(event_id: str, data: SlotIn, ws: str = Depends(require_ws)) -> dict:
    owned_event(event_id, ws)
    with session() as db:
        n = len(db.exec(select(SponsorSlot).where(SponsorSlot.event_id == event_id)).all())
        s = SponsorSlot(event_id=event_id, name=data.name[:60], category_key=data.category_key,
                        tier_label=data.tier_label, order=n)
        # prefill with discovered brands of the matching category
        ev = db.get(Event, event_id)
        if ev and ev.latest_run_id:
            from app.agents.slots import SLOT_ACCEPTS
            accepts = SLOT_ACCEPTS.get(data.category_key, {data.category_key})
            ms = db.exec(select(BrandMatch).where(BrandMatch.run_id == ev.latest_run_id)).all()
            s.candidates = [{"qloo_entity_id": m.qloo_entity_id, "name": m.name, "source": "discovered",
                             "logo_url": m.logo_url, "category_key": m.category_key}
                            for m in sorted(ms, key=lambda m: -m.fit) if m.category_key in accepts and not m.is_existing][:6]
        db.add(s)
        db.commit()
        db.refresh(s)
        return s.model_dump()


@router.patch("/slots/{slot_id}")
async def patch_slot(slot_id: str, data: SlotPatch, ws: str = Depends(require_ws)) -> dict:
    with session() as db:
        s = db.get(SponsorSlot, slot_id)
        if not s:
            raise HTTPException(404, "Not found")
        owned_event(s.event_id, ws)
        if data.name:
            s.name = data.name[:60]
        if data.tier_label is not None:
            s.tier_label = data.tier_label or None
        cands = list(s.candidates)
        if data.remove:
            cands = [c for c in cands if c["qloo_entity_id"] not in set(data.remove)]
        for a in data.add or []:
            if a.get("qloo_entity_id") and all(c["qloo_entity_id"] != a["qloo_entity_id"] for c in cands):
                cands.append({"qloo_entity_id": a["qloo_entity_id"], "name": a.get("name") or "?",
                              "source": a.get("source") or "user", "logo_url": a.get("logo_url")})
        if len(cands) > 8:
            raise HTTPException(400, "A slot holds up to 8 candidates.")
        s.candidates = cands
        db.add(s)
        db.commit()
        db.refresh(s)
        return s.model_dump()


@router.delete("/slots/{slot_id}")
async def delete_slot(slot_id: str, ws: str = Depends(require_ws)) -> dict:
    with session() as db:
        s = db.get(SponsorSlot, slot_id)
        if not s:
            raise HTTPException(404, "Not found")
        owned_event(s.event_id, ws)
        db.delete(s)
        db.commit()
    return {"ok": True}


@router.post("/slots/{slot_id}/rank")
async def rank_slot_route(slot_id: str, ws: str = Depends(require_ws)):
    with session() as db:
        s = db.get(SponsorSlot, slot_id)
    if not s:
        raise HTTPException(404, "Not found")
    owned_event(s.event_id, ws)

    async def work(emit):
        row = await rank_slot(slot_id, emit, 1)
        return row.model_dump()

    return sse_task(work)


# ---------------- LLM-only comparison ----------------
@router.post("/events/{event_id}/llm-only")
async def llm_only(event_id: str, ws: str | None = Depends(current_ws)) -> dict:
    ev = get_event(event_id)
    with session() as db:
        cached = db.exec(select(LlmOnlyComparison).where(LlmOnlyComparison.event_id == event_id)).first()
        if cached:
            return cached.model_dump()
        sigs = db.exec(select(CrowdSignal).where(CrowdSignal.event_id == event_id)).all()
    if ev.workspace_id != ws and not ev.is_sample:
        raise HTTPException(403, "Not your event")
    brief = {"name": ev.name, "type": EVENT_TYPE_LABELS.get(ev.type), "city": ev.city, "attendance": ev.attendance,
             "lineup": [s.display_name or s.raw_text for s in sigs], "exclude": ev.exclude_categories}
    model = get_settings().groq_agent_model
    out = await json_call(prompt("llm_only"), json.dumps(brief), model=model, temperature=0.4)
    sugg = [s for s in (out.get("suggestions") or []) if isinstance(s, dict) and s.get("brand")][:10]
    with session() as db:
        row = LlmOnlyComparison(event_id=event_id, suggestions=sugg, model=model)
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.model_dump()


# ---------------- export ----------------
def lens_fit(m: BrandMatch, lens: str) -> float:
    return fit_score(m.components, lens) if lens in LENSES else m.fit


@router.get("/events/{event_id}/export.csv")
async def export_csv(event_id: str, lens: str = "balanced", shelf: str | None = None, saved: bool = False,
                     min_fit: float = 0, category: str | None = None):
    ev = get_event(event_id)
    with session() as db:
        ms = db.exec(select(BrandMatch).where(BrandMatch.run_id == ev.latest_run_id)).all() if ev.latest_run_id else []
        slots = db.exec(select(SponsorSlot).where(SponsorSlot.event_id == event_id)).all()
    rows = [m for m in ms if not m.hidden and (not saved or m.saved) and (not shelf or m.shelf == shelf)
            and (not category or m.category_key == category) and lens_fit(m, lens) >= min_fit]
    rows.sort(key=lambda m: lens_fit(m, lens), reverse=True)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["brand", "category", "shelf", "saved", "existing_sponsor", f"marquee_fit_{lens}", "taste_match",
                "audience_overlap", "local_strength", "momentum_12m", "why_1", "why_2", "why_3",
                "sponsor_activity", "partnerships_url", "sources", "qloo_entity_id"])
    for m in rows:
        mt = m.metrics
        why = [x.get("text", "") for x in m.why][:3] + ["", "", ""]
        w.writerow([
            m.name, m.category, m.shelf, "yes" if m.saved else "", "yes" if m.is_existing else "", lens_fit(m, lens),
            f"#{mt.get('taste_rank')} of {mt.get('taste_n')}" if mt.get("taste_rank") else "n/a",
            f"{mt.get('overlap_shared')} of {mt.get('overlap_of')} top tastes" if mt.get("overlap_shared") is not None else "n/a",
            f"top {mt.get('local_top_pct')}% of areas in {mt.get('local_city')}" if mt.get("local_top_pct") is not None else "n/a",
            f"{mt.get('momentum_pct'):+}%" if mt.get("momentum_pct") is not None else "n/a",
            *why[:3], (m.sponsor_activity or {}).get("summary", ""),
            (m.start_here or {}).get("partnerships_page") or "",
            " ".join(c.get("url", "") for c in (m.sponsor_activity or {}).get("citations", [])), m.qloo_entity_id,
        ])
    ranked = [s for s in sorted(slots, key=lambda s: s.order) if s.winner_id]
    if ranked:
        w.writerow([])
        w.writerow(["sponsor_slot", "best_pick", "slot_score", "margin", "too_close", "runner_up"])
        for s in ranked:
            r = s.ranking
            w.writerow([s.name, r[0]["name"] if r else "", r[0]["slot_score"] if r else "", s.margin or "",
                        "yes" if s.too_close else "", r[1]["name"] if len(r) > 1 else ""])
    fname = "".join(ch for ch in ev.name if ch.isalnum() or ch in " -_").strip().replace(" ", "_") or "event"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="marquee_{fname}.csv"'})


# ---------------- portfolio ----------------
@router.get("/portfolio")
async def portfolio(ws: str | None = Depends(current_ws)) -> dict:
    with session() as db:
        evs = db.exec(select(Event).where((Event.is_sample == True) | (Event.workspace_id == (ws or "-")))).all()  # noqa: E712
        evs = [e for e in evs if e.latest_run_id]
        data = []
        for e in sorted(evs, key=lambda e: (not e.is_sample, e.sample_order, e.created_at)):
            ms = db.exec(select(BrandMatch).where(BrandMatch.run_id == e.latest_run_id, BrandMatch.shelf != "local",
                                                  BrandMatch.hidden == False)).all()  # noqa: E712
            data.append((e, ms))
    brand_names: dict[str, str] = {}
    brand_logo: dict[str, str | None] = {}
    brand_cat: dict[str, str] = {}
    union: dict[str, float] = {}
    per_event = max(3, 16 // max(1, len(data)))
    for _e, ms in data:  # every property contributes its own top brands as columns
        for m in sorted(ms, key=lambda m: -m.fit)[:per_event]:
            union[m.qloo_entity_id] = max(union.get(m.qloo_entity_id, 0), m.fit)
    cols = sorted(union, key=lambda k: -union[k])[:18]
    rows = []
    for e, ms in data:
        by = {m.qloo_entity_id: m for m in ms}
        for m in ms:
            brand_names[m.qloo_entity_id] = m.name
            brand_logo.setdefault(m.qloo_entity_id, m.logo_url)
            brand_cat[m.qloo_entity_id] = m.category
        rows.append({"event_id": e.id, "name": e.name, "type": EVENT_TYPE_LABELS.get(e.type), "city": e.city,
                     "is_sample": e.is_sample,
                     "cells": {c: ({"fit": by[c].fit, "match_id": by[c].id} if c in by else None) for c in cols}})
    best = []
    for c in cols:
        cands = [(r["name"], r["event_id"], r["cells"][c]["fit"]) for r in rows if r["cells"].get(c)]
        if cands:
            n, eid, f = max(cands, key=lambda x: x[2])
            best.append({"brand": brand_names.get(c), "brand_id": c, "event": n, "event_id": eid, "fit": f})
    # under-sold: categories scoring high but with no saved or existing sponsor on that event
    undersold = []
    for e, ms in data:
        cats: dict[str, list[BrandMatch]] = {}
        for m in ms:
            cats.setdefault(m.category, []).append(m)
        covered = {m.category for m in ms if m.saved or m.is_existing}
        covered |= {c for c in (e.existing_sponsors or [])}
        for cat, items in cats.items():
            top = max(items, key=lambda m: m.fit)
            if cat not in covered and top.fit >= 55:
                undersold.append({"event_id": e.id, "event": e.name, "category": cat, "top_brand": top.name,
                                  "fit": top.fit, "brands": len(items)})
    undersold.sort(key=lambda u: -u["fit"])
    return {"columns": [{"id": c, "name": brand_names.get(c), "logo_url": brand_logo.get(c), "category": brand_cat.get(c)}
                        for c in cols], "rows": rows, "best_property": best, "undersold": undersold[:12]}


# ---------------- intake ----------------
@router.post("/intake")
async def intake(files: list[UploadFile] = File(default=[]), url: str | None = Form(default=None),
                 text: str | None = Form(default=None)):
    tmp = Path(tempfile.mkdtemp(prefix="mq_intake_"))
    pdfs: list[tuple[str, Path]] = []
    imgs: list[tuple[str, Path]] = []
    try:
        for f in files:
            name = Path(f.filename or "upload").name[:80]
            ctype = (f.content_type or "").lower()
            is_pdf = ctype == "application/pdf" or name.lower().endswith(".pdf")
            is_img = ctype.startswith("image/") or name.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
            if not (is_pdf or is_img):
                raise HTTPException(400, f"{name}: only PDF and image files are supported")
            if (is_pdf and len(pdfs) >= 3) or (is_img and len(imgs) >= 5):
                raise HTTPException(400, "Up to 3 PDFs and 5 images")
            dest = tmp / f"{len(pdfs) + len(imgs)}_{name}"
            limit = (MAX_PDF_MB if is_pdf else MAX_IMG_MB) * 1024 * 1024
            size = 0
            with dest.open("wb") as out:
                while chunk := await f.read(1024 * 256):
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(400, f"{name} is larger than {limit // (1024 * 1024)} MB")
                    out.write(chunk)
            (pdfs if is_pdf else imgs).append((name, dest))
    except HTTPException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url

    async def work(emit):
        try:
            brief: dict = {}
            async for ev in run_intake(pdfs, imgs, url, text):
                if ev["kind"] == "brief":
                    brief = ev["data"]
                else:
                    await emit(1, ev["kind"], summary=ev["summary"])
            return brief
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    return sse_task(work)
