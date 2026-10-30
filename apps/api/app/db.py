"""SQLModel tables. JSON columns hold Qloo-derived structures exactly as computed."""
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Column, Text
from sqlmodel import Field, Session, SQLModel, create_engine

from app.config import get_settings


def _id() -> str:
    return uuid4().hex[:12]


def now() -> datetime:
    return datetime.now(UTC)


def J(factory: Any = dict):
    return Field(default_factory=factory, sa_column=Column(JSON))


class Workspace(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    created_at: datetime = Field(default_factory=now)


class Event(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    workspace_id: str = Field(index=True)
    name: str
    type: str = "festival"
    city: str | None = None
    country: str | None = None
    dates: str | None = None
    attendance: int | None = None
    age_bands: list = J(list)
    exclude_categories: list = J(list)
    existing_sponsors: list = J(list)
    field_sources: dict = J(dict)
    is_sample: bool = False
    sample_order: int = 0
    tagline: str | None = None
    latest_run_id: str | None = None
    created_at: datetime = Field(default_factory=now)


class EventAsset(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    event_id: str | None = Field(default=None, index=True)
    kind: str
    filename: str | None = None
    text: str | None = Field(default=None, sa_column=Column(Text))
    extracted: dict = J(dict)


class CrowdSignal(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    event_id: str = Field(index=True)
    raw_text: str
    qloo_entity_id: str | None = None
    entity_type: str | None = None
    display_name: str | None = None
    image_url: str | None = None
    status: str = "resolved"  # resolved | needs_input | unmatched


class Run(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    event_id: str = Field(index=True)
    status: str = "running"  # running | done | error | interrupted
    stage: int = 0
    started_at: datetime = Field(default_factory=now)
    finished_at: datetime | None = None
    error: str | None = None


class RunEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    run_id: str = Field(index=True)
    seq: int
    stage: int
    kind: str
    payload: dict = J(dict)
    created_at: datetime = Field(default_factory=now)


class CrowdProfile(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    run_id: str = Field(index=True)
    event_id: str = Field(index=True)
    fingerprint: dict = J(dict)
    demographics: dict = J(dict)
    tags: list = J(list)
    summary: str | None = Field(default=None, sa_column=Column(Text))
    evidence: dict = J(dict)


class BrandMatch(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    run_id: str = Field(index=True)
    event_id: str = Field(index=True)
    qloo_entity_id: str
    name: str
    category: str = "Other"
    category_key: str = "other"
    logo_url: str | None = None
    description: str | None = Field(default=None, sa_column=Column(Text))
    shelf: str = "hidden"  # natural | hidden | local
    fit: float = 0
    components: dict = J(dict)
    metrics: dict = J(dict)
    why: list = J(list)
    overlap: dict = J(dict)
    local: dict = J(dict)
    trend: dict = J(dict)
    sponsor_activity: dict = J(dict)
    start_here: dict = J(dict)
    saved: bool = False
    hidden: bool = False
    is_existing: bool = False


class BrandCheck(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    event_id: str = Field(index=True)
    qloo_entity_id: str
    name: str
    category: str = "Other"
    category_key: str = "other"
    logo_url: str | None = None
    fit: float = 0
    components: dict = J(dict)
    metrics: dict = J(dict)
    why: list = J(list)
    overlap: dict = J(dict)
    local: dict = J(dict)
    trend: dict = J(dict)
    sponsor_activity: dict = J(dict)
    verdict: str = "Weak fit"
    verdict_reasons: list = J(list)
    created_at: datetime = Field(default_factory=now)


class SponsorSlot(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    event_id: str = Field(index=True)
    name: str
    category_key: str = "other"
    tier_label: str | None = None
    order: int = 0
    candidates: list = J(list)
    ranking: list = J(list)
    winner_id: str | None = None
    too_close: bool = False
    margin: float | None = None
    rationale: dict = J(dict)
    ranked_without_qloo_rank: bool = False
    ranked_at: datetime | None = None


class LlmOnlyComparison(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    event_id: str = Field(index=True)
    suggestions: list = J(list)
    model: str | None = None
    created_at: datetime = Field(default_factory=now)


class QlooCache(SQLModel, table=True):
    key: str = Field(primary_key=True)
    tool: str
    args: dict = J(dict)
    envelope: dict = J(dict)
    created_at: datetime = Field(default_factory=now)


class RateHit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: str = Field(index=True)
    kind: str
    created_at: datetime = Field(default_factory=now)


_engine = None


def engine():
    global _engine
    if _engine is None:
        url = get_settings().database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        kw: dict[str, Any] = {}
        if url.startswith("sqlite"):
            kw["connect_args"] = {"check_same_thread": False}
        else:
            kw.update(pool_pre_ping=True, pool_size=5, max_overflow=5, pool_recycle=300)
        _engine = create_engine(url, **kw)
    return _engine


def init_db() -> None:
    SQLModel.metadata.create_all(engine())


def session() -> Session:
    return Session(engine(), expire_on_commit=False)
