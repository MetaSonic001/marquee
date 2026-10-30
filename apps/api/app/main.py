import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select

from app.config import get_settings
from app.db import Run, init_db, now, session
from app.qloo.gateway import gateway
from app.routes.api import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)


def mark_interrupted() -> None:
    with session() as db:
        # only runs that can't still be alive in another process (e.g. the seed script)
        cutoff = now() - timedelta(minutes=15)
        for r in db.exec(select(Run).where(Run.status == "running", Run.started_at < cutoff)).all():
            r.status, r.error, r.finished_at = "interrupted", "Server restarted during the run", now()
            db.add(r)
        db.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    mark_interrupted()
    # the MCP session starts in the background; calls start it lazily if it isn't ready yet
    task = asyncio.create_task(gateway.start())
    yield
    task.cancel()
    await gateway.stop()


app = FastAPI(title="Marquee API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_origin_regex=r"https://marquee[a-z0-9-]*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.include_router(router)
