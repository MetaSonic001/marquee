"""Demo extras for the Dodgers watch party: inbound beverage brands in the slot + inbound brand checks.
Runs the real slot ranking and brand-check pipelines (no hand-written output)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import select  # noqa: E402

from app.agents.check import check_brand  # noqa: E402
from app.agents.slots import rank_slot  # noqa: E402
from app.db import BrandCheck, Event, SponsorSlot, init_db, session  # noqa: E402
from app.qloo.gateway import gateway  # noqa: E402
from scripts.seed_samples import confirm  # noqa: E402

INBOUND_BEVERAGE = ["Coca-Cola", "Pepsi", "Modelo", "Coors Light"]
INBOUND_CHECKS = ["Modelo", "Coors Light", "Liquid Death"]


async def main() -> None:
    init_db()
    await gateway.start()
    with session() as db:
        ev = db.exec(select(Event).where(Event.is_sample == True, Event.name == "Blue Heaven Watch Party")).first()  # noqa: E712
        slot = db.exec(select(SponsorSlot).where(SponsorSlot.event_id == ev.id,
                                                 SponsorSlot.name == "Official beverage partner")).first()
    cands = list(slot.candidates)
    have = {c["qloo_entity_id"] for c in cands}
    for name in INBOUND_BEVERAGE:
        c = await confirm(name, "brand")
        if c and c["id"] not in have and len(cands) < 8:
            cands.append({"qloo_entity_id": c["id"], "name": c["name"], "source": "user", "logo_url": c.get("image")})
            have.add(c["id"])
    with session() as db:
        s = db.get(SponsorSlot, slot.id)
        s.candidates = cands
        db.add(s)
        db.commit()
    await rank_slot(slot.id)
    print("beverage slot ranked")
    with session() as db:
        for c in db.exec(select(BrandCheck).where(BrandCheck.event_id == ev.id)).all():
            db.delete(c)
        db.commit()
    for name in INBOUND_CHECKS:
        c = await confirm(name, "brand")
        if c:
            row = await check_brand(ev.id, c["id"], c["name"])
            print("check", row.name, row.verdict, round(row.fit))
    await gateway.stop()


if __name__ == "__main__":
    asyncio.run(main())
