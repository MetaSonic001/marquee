"""Create the demo portfolio by running the REAL pipeline. Nothing here is hand-written output:
the script only supplies event briefs (user input) and then stores what Qloo + the pipeline return.

    uv run python scripts/seed_samples.py            # all three
    uv run python scripts/seed_samples.py sean       # one
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import select  # noqa: E402

from app.agents.check import check_brand  # noqa: E402
from app.agents.pipeline import Pipeline  # noqa: E402
from app.agents.resolve import resolve  # noqa: E402
from app.agents.slots import rank_slot  # noqa: E402
from app.db import BrandCheck, Event, Run, SponsorSlot, init_db, session  # noqa: E402
from app.qloo.gateway import gateway  # noqa: E402
from app.routes.api import EventIn, SignalIn, create_event_row  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")
log = logging.getLogger("seed")
LABEL = "Demo scenario: fictional events with real performers, teams and brands as taste signals. Not affiliated with Live Nation or any performer, team or brand shown."

SAMPLES = {
    "sean": dict(order=1, name="SEAN Fest", type="festival", city="Austin", country="United States",
                 dates="3 days · late April", attendance=20000, exclude_categories=["tobacco", "gambling"],
                 existing_sponsors=["Dr. Martens"], age_bands=[],
                 tagline="A 3-day indie & alt festival in Austin, TX · ~20,000 per day",
                 signals=[("Khruangbin", "artist"), ("Japanese Breakfast", "artist"), ("Mac DeMarco", "artist"),
                          ("Alvvays", "artist"), ("Beach House", "artist")]),
    "laugh": dict(order=2, name="Laugh Track Live", type="comedy", city="St. Louis", country="United States",
                  dates="One night · Friday", attendance=2500, exclude_categories=["tobacco"], existing_sponsors=[],
                  age_bands=[], tagline="A stand-up night in St. Louis · ~2,500 seats · looking for a presenting sponsor",
                  signals=[("Cedric the Entertainer", "person"), ("Steve Harvey", "person"), ("D. L. Hughley", "person"),
                           ("Kevin Hart", "person")]),
    "dodgers": dict(order=3, name="Blue Heaven Watch Party", type="sports_fan", city="Los Angeles",
                    country="United States", dates="Postseason game nights", attendance=1200,
                    exclude_categories=["tobacco", "gambling"], existing_sponsors=[], age_bands=[],
                    tagline="A Dodgers supporters' watch party in LA · ~1,200 fans a night",
                    signals=[("Los Angeles Dodgers", "brand"), ("Shohei Ohtani", "person"), ("Clayton Kershaw", "person")]),
    "ritmo": dict(order=4, name="Ritmo Arena Tour", type="concert_tour", city="Miami", country="United States",
                  dates="12 US arena dates", attendance=18000, exclude_categories=["tobacco", "gambling"],
                  existing_sponsors=[], age_bands=[],
                  tagline="A Latin-pop arena tour across US cities",
                  signals=[("Bad Bunny", "artist"), ("Karol G", "artist"), ("Peso Pluma", "artist"),
                           ("Rauw Alejandro", "artist"), ("Shakira", "artist")]),
}
SEAN_BEVERAGE_ADDS = ["Pepsi", "Coca-Cola", "Gatorade", "Red Bull", "Liquid Death"]
SEAN_INBOUND = ["Red Bull", "Liquid Death", "Topo Chico"]


async def confirm(name: str, etype: str | None) -> dict | None:
    r = await resolve(name, etype)
    cands = r.get("candidates") or []
    if r["status"] == "needs_input":
        # seed author confirms: the candidate of the intended type with the highest Qloo popularity
        typed = [c for c in cands if c.get("type") == etype] or cands
        cands = sorted(typed, key=lambda c: -(c.get("popularity") or 0))
    if r["status"] in ("resolved", "needs_input") and cands:
        return cands[0]
    log.warning("could not confirm %s (%s)", name, r["status"])
    return None


async def seed_one(key: str) -> None:
    spec = SAMPLES[key]
    with session() as db:
        for old in db.exec(select(Event).where(Event.is_sample == True, Event.name == spec["name"])).all():  # noqa: E712
            old.is_sample = False
            old.workspace_id = "archived-samples"
            db.add(old)
        db.commit()
    sigs = []
    for name, et in spec["signals"]:
        c = await confirm(name, et)
        if c:
            sigs.append(SignalIn(raw_text=name, qloo_entity_id=c["id"], entity_type=c.get("type") or et,
                                 display_name=c["name"], image_url=c.get("image"), status="resolved"))
    data = EventIn(name=spec["name"], type=spec["type"], city=spec["city"], country=spec["country"],
                   dates=spec["dates"], attendance=spec["attendance"], exclude_categories=spec["exclude_categories"],
                   existing_sponsors=spec["existing_sponsors"], age_bands=spec["age_bands"], signals=sigs)
    ev = create_event_row(data, "samples", is_sample=True, sample_order=spec["order"], tagline=spec["tagline"])
    with session() as db:
        run = Run(event_id=ev.id)
        db.add(run)
        db.commit()
        rid = run.id
    t = time.monotonic()
    await Pipeline(rid, ev.id).run()
    with session() as db:
        r = db.get(Run, rid)
        log.info("%s run %s: %s in %.0fs %s", spec["name"], rid, r.status, time.monotonic() - t, r.error or "")

    if key == "sean":
        await sean_extras(ev.id)


async def sean_extras(event_id: str) -> None:
    with session() as db:
        slot = db.exec(select(SponsorSlot).where(SponsorSlot.event_id == event_id,
                                                 SponsorSlot.name == "Official beverage partner")).first()
        if not slot:
            slot = SponsorSlot(event_id=event_id, name="Official beverage partner", category_key="beverage",
                               tier_label="Official", order=0)
            db.add(slot)
            db.commit()
            db.refresh(slot)
        cands = list(slot.candidates)
    have = {c["qloo_entity_id"] for c in cands}
    for name in SEAN_BEVERAGE_ADDS:
        c = await confirm(name, "brand")
        if c and c["id"] not in have and len(cands) < 8:
            cands.insert(0, {"qloo_entity_id": c["id"], "name": c["name"], "source": "user", "logo_url": c.get("image")})
            have.add(c["id"])
    users = [c for c in cands if c["source"] == "user"]
    disc = [c for c in cands if c["source"] != "user"]
    with session() as db:
        s = db.get(SponsorSlot, slot.id)
        s.candidates = (users + disc)[:8]
        db.add(s)
        db.commit()
    await rank_slot(slot.id)
    log.info("beverage slot ranked")
    with session() as db:
        for c in db.exec(select(BrandCheck).where(BrandCheck.event_id == event_id)).all():
            db.delete(c)
        db.commit()
    for name in SEAN_INBOUND:
        c = await confirm(name, "brand")
        if c:
            row = await check_brand(event_id, c["id"], c["name"])
            log.info("check %s: %s %.0f", row.name, row.verdict, row.fit)


async def main() -> None:
    init_db()
    await gateway.start()
    keys = sys.argv[1:] or list(SAMPLES)
    for k in keys:
        await seed_one(k)
    await gateway.stop()


if __name__ == "__main__":
    asyncio.run(main())
