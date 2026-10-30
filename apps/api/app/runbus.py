"""Run events: persisted (RunEvent) so a finished or interrupted run replays exactly, and
fanned out live to SSE subscribers. Writes are batched in the background so the pipeline never
waits on database latency; live history is served from memory until flushed."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from sqlmodel import select

from app.db import RunEvent, session

log = logging.getLogger("marquee.runbus")


class RunBus:
    def __init__(self) -> None:
        self.subs: dict[str, set[asyncio.Queue]] = {}
        self.seq: dict[str, int] = {}
        self.live: dict[str, list[dict]] = {}  # events of runs in progress (memory copy)
        self.pending: list[dict] = []
        self._flusher: asyncio.Task | None = None

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.subs.setdefault(run_id, set()).add(q)
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue) -> None:
        self.subs.get(run_id, set()).discard(q)

    def _persist(self, evs: list[dict]) -> None:
        with session() as db:
            for ev in evs:
                db.add(RunEvent(run_id=ev["run_id"], seq=ev["seq"], stage=ev["stage"], kind=ev["kind"], payload=ev))
            db.commit()

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(0.8)
            await self.flush()

    async def flush(self) -> None:
        if not self.pending:
            return
        batch, self.pending = self.pending, []
        try:
            await asyncio.to_thread(self._persist, batch)
        except Exception as e:  # noqa: BLE001
            log.warning("persist run events failed (%s); retrying later", e)
            self.pending = batch + self.pending

    async def emit(self, run_id: str, stage: int, kind: str, tool: str | None = None, summary: str = "",
                   data: Any = None) -> dict:
        if self._flusher is None or self._flusher.done():
            self._flusher = asyncio.create_task(self._flush_loop())
        seq = self.seq.get(run_id, 0) + 1
        self.seq[run_id] = seq
        ev = {"run_id": run_id, "seq": seq, "stage": stage, "kind": kind, "summary": summary, "ts": time.time()}
        if tool:
            ev["tool"] = tool
        if data is not None:
            ev["data"] = data
        self.live.setdefault(run_id, []).append(ev)
        self.pending.append(ev)
        for q in list(self.subs.get(run_id, ())):
            q.put_nowait(ev)
        if kind in ("done", "error") and stage in (0, 8):
            await self.flush()
            self.live.pop(run_id, None)
        return ev

    def history(self, run_id: str, after: int = 0) -> list[dict]:
        if run_id in self.live:
            return [e for e in self.live[run_id] if e["seq"] > after]
        with session() as db:
            rows = db.exec(select(RunEvent).where(RunEvent.run_id == run_id, RunEvent.seq > after)
                           .order_by(RunEvent.seq)).all()
            return [{"ts": r.created_at.timestamp() if r.created_at else None, **r.payload} for r in rows]

    def emitter(self, run_id: str):
        async def _emit(stage: int, kind: str, tool: str | None = None, summary: str = "", data: Any = None):
            return await self.emit(run_id, stage, kind, tool=tool, summary=summary, data=data)
        return _emit


bus = RunBus()
