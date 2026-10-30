"""Re-run only the LLM writing steps for sample events whose copy fell back to templates
(e.g. after a Groq rate limit). Uses the stored Qloo metrics; makes no Qloo calls.

    uv run python scripts/refresh_copy.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import select  # noqa: E402

from app.agents.category_map import EVENT_TYPE_LABELS  # noqa: E402
from app.agents.slots import rank_slot  # noqa: E402
from app.agents.writer import crowd_summary, write_brand_bullets  # noqa: E402
from app.db import BrandMatch, CrowdProfile, Event, SponsorSlot, session  # noqa: E402


async def main() -> None:
    with session() as db:
        events = db.exec(select(Event).where(Event.is_sample == True)).all()  # noqa: E712
    for ev in events:
        brief = {"name": ev.name, "type": EVENT_TYPE_LABELS.get(ev.type), "city": ev.city}
        with session() as db:
            ms = db.exec(select(BrandMatch).where(BrandMatch.run_id == ev.latest_run_id, BrandMatch.shelf != "local")).all()
            prof = db.exec(select(CrowdProfile).where(CrowdProfile.run_id == ev.latest_run_id)).first()
        todo = [m for m in ms if "writer unavailable" in str(m.start_here)]
        print(f"{ev.name}: {len(todo)} cards to rewrite, summary={'yes' if prof and prof.summary else 'missing'}")
        if todo:
            items = [m.model_dump() for m in todo]
            await write_brand_bullets(items, brief)
            with session() as db:
                for it in items:
                    row = db.get(BrandMatch, it["id"])
                    if row and "writer unavailable" not in str(it.get("start_here")):
                        pp = (row.start_here or {}).get("partnerships_page")
                        row.why, row.start_here = it["why"], {**it["start_here"], **({"partnerships_page": pp} if pp else {})}
                        db.add(row)
                db.commit()
        if prof and not prof.summary:
            text, cited = await crowd_summary(prof.fingerprint, prof.tags, prof.demographics, brief)
            if text:
                with session() as db:
                    row = db.get(CrowdProfile, prof.id)
                    row.summary, row.evidence = text, {**(row.evidence or {}), "cited_ids": cited}
                    db.add(row)
                    db.commit()
        with session() as db:
            slots = db.exec(select(SponsorSlot).where(SponsorSlot.event_id == ev.id)).all()
        for s in slots:
            if len(s.ranking) >= 2 and not (s.rationale or {}).get("bullets"):
                await rank_slot(s.id)
                print(f"  re-ranked {s.name}")


if __name__ == "__main__":
    asyncio.run(main())
