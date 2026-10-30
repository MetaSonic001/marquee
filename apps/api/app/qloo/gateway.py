"""Qloo gateway: one long-lived `qloo mcp` stdio session, a two-level cache, bounded retries,
and a `qloo exec` subprocess fallback. The API key only travels via the process environment."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import tempfile
from collections import OrderedDict
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.config import get_settings
from app.db import QlooCache, session

log = logging.getLogger("marquee.qloo")

RETRYABLE_STATUSES = {"error"}
MAX_RETRIES = 2
TOOL_TO_WORKFLOW = {
    "qloo_recommend": "recommend",
    "qloo_rank": "rank",
    "qloo_describe": "describe",
    "qloo_where_popular": "where_popular",
    "qloo_compare_audiences": "compare_audiences",
    "qloo_entity_tags": "entity_tags",
    "qloo_audience_demographics": "audience_demographics",
    "qloo_trends": "trends",
    "qloo_find_tags": "find_tags",
}


def cache_key(tool: str, args: dict) -> str:
    norm = json.dumps({"tool": tool, "args": args}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(norm.encode()).hexdigest()


def qloo_env() -> dict[str, str]:
    s = get_settings()
    env = dict(os.environ)
    if s.qloo_api_key:
        env["QLOO_API_KEY"] = s.qloo_api_key
    if s.qloo_base_url:
        env["QLOO_BASE_URL"] = s.qloo_base_url
        env["QLOO_TRUSTED_BASE_URL"] = s.qloo_base_url
    env.setdefault("NO_COLOR", "1")
    return env


class LRU:
    def __init__(self, size: int = 200):
        self.size = size
        self.data: OrderedDict[str, dict] = OrderedDict()

    def get(self, k: str) -> dict | None:
        if k in self.data:
            self.data.move_to_end(k)
            return self.data[k]
        return None

    def put(self, k: str, v: dict) -> None:
        self.data[k] = v
        self.data.move_to_end(k)
        while len(self.data) > self.size:
            self.data.popitem(last=False)


def cacheable(env: dict) -> bool:
    return env.get("status") in {"ok", "empty", "partial", "degraded", "needs_input"}


def results_of(env: dict) -> Any:
    """Normalise the envelope's payload: list results, dict results, or trend series."""
    if "series" in env and not env.get("results"):
        return env["series"]
    return env.get("results") or []


class QlooGateway:
    def __init__(self) -> None:
        self.session: ClientSession | None = None
        self.ready = False
        self.capabilities: dict | None = None
        self._runner: asyncio.Task | None = None
        self._stop: asyncio.Event | None = None
        self._ready_evt: asyncio.Event | None = None
        self._start_lock = asyncio.Lock()
        self.sem = asyncio.Semaphore(4)  # MCP calls share one Node process; network-bound
        self.proc_sem = asyncio.Semaphore(2)  # each `qloo api` subprocess is a new Node process (~60MB)
        self.mem = LRU(200)
        self.last_error: str | None = None
        self.calls = 0

    # ---------- session lifecycle ----------
    async def _run_session(self) -> None:
        s = get_settings()
        params = StdioServerParameters(command=s.qloo_executable, args=["mcp"], env=qloo_env())
        try:
            async with stdio_client(params) as (r, w):
                async with ClientSession(r, w) as sess:
                    await sess.initialize()
                    caps = await sess.call_tool("qloo_capabilities", {})
                    self.capabilities = caps.structured_content or {}
                    self.session = sess
                    self.ready = True
                    self.last_error = None
                    assert self._ready_evt and self._stop
                    self._ready_evt.set()
                    await self._stop.wait()
        except Exception as e:  # noqa: BLE001
            self.last_error = f"{type(e).__name__}: {e}"[:300]
            log.warning("qloo mcp session ended: %s", self.last_error)
        finally:
            self.session = None
            self.ready = False
            if self._ready_evt:
                self._ready_evt.set()

    async def start(self, timeout: float = 45) -> bool:
        async with self._start_lock:
            if self.ready and self.session:
                return True
            self._stop = asyncio.Event()
            self._ready_evt = asyncio.Event()
            self._runner = asyncio.create_task(self._run_session())
            try:
                await asyncio.wait_for(self._ready_evt.wait(), timeout)
            except TimeoutError:
                self.last_error = "qloo mcp start timed out"
            return self.ready

    async def stop(self) -> None:
        if self._stop:
            self._stop.set()
        if self._runner:
            try:
                await asyncio.wait_for(self._runner, 5)
            except Exception:  # noqa: BLE001
                self._runner.cancel()

    async def restart(self) -> bool:
        await self.stop()
        return await self.start()

    # ---------- cache ----------
    def _db_get(self, key: str) -> dict | None:
        try:
            with session() as db:
                row = db.get(QlooCache, key)
                return row.envelope if row else None
        except Exception as e:  # noqa: BLE001
            log.warning("cache read failed: %s", e)
            return None

    def _db_put(self, key: str, tool: str, args: dict, env: dict) -> None:
        try:
            with session() as db:
                row = db.get(QlooCache, key)
                if row:
                    row.envelope = env
                else:
                    db.add(QlooCache(key=key, tool=tool, args=args, envelope=env))
                db.commit()
        except Exception as e:  # noqa: BLE001
            log.warning("cache write failed: %s", e)

    # ---------- calls ----------
    async def _call_mcp(self, tool: str, args: dict) -> dict:
        if not (self.ready and self.session):
            if not await self.start():
                raise RuntimeError(self.last_error or "qloo mcp unavailable")
        assert self.session
        res = await asyncio.wait_for(self.session.call_tool(tool, args), 90)
        if res.structured_content:
            return dict(res.structured_content)
        text = res.content[0].text if res.content else "{}"
        return json.loads(text)

    async def _call_exec(self, tool: str, args: dict) -> dict:
        workflow = TOOL_TO_WORKFLOW[tool]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(args, f)
            path = f.name
        try:
            proc = await asyncio.create_subprocess_exec(
                get_settings().qloo_executable, "exec", workflow, "--input-file", path,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=qloo_env(),
            )
            out, _ = await asyncio.wait_for(proc.communicate(), 90)
            return json.loads(out.decode() or "{}")
        finally:
            os.unlink(path)

    async def call(self, tool: str, args: dict, use_cache: bool = True) -> tuple[dict, bool]:
        """Returns (envelope, cache_hit)."""
        key = cache_key(tool, args)
        if use_cache:
            hit = self.mem.get(key)
            if hit is None:
                hit = await asyncio.to_thread(self._db_get, key)
                if hit is not None:
                    self.mem.put(key, hit)
            if hit is not None:
                return hit, True

        env: dict = {}
        async with self.sem:
            for attempt in range(MAX_RETRIES + 1):
                try:
                    self.calls += 1
                    env = await self._call_mcp(tool, args)
                except Exception as e:  # noqa: BLE001
                    log.warning("mcp call %s failed (%s); trying exec fallback", tool, e)
                    try:
                        await self.restart()
                    except Exception:  # noqa: BLE001
                        pass
                    try:
                        env = await self._call_exec(tool, args)
                    except Exception as e2:  # noqa: BLE001
                        env = {"status": "error", "summary": "Qloo call failed", "results": [],
                               "error": {"code": "GATEWAY", "retryable": attempt < MAX_RETRIES,
                                         "recovery": str(e2)[:200]}}
                err = env.get("error") or {}
                if env.get("status") == "error" and err.get("retryable") and attempt < MAX_RETRIES:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                break

        if cacheable(env):
            self.mem.put(key, env)
            await asyncio.to_thread(self._db_put, key, tool, args, env)
        return env, False

    async def entities(self, ids: list[str]) -> list[dict]:
        """Batch entity lookup via `qloo api entity` (returns Qloo tags for categorisation)."""
        ids = [i for i in dict.fromkeys(ids) if i]
        out: list[dict] = []
        todo: list[str] = []
        for i in ids:
            key = cache_key("api_entity", {"id": i})
            hit = self.mem.get(key) or await asyncio.to_thread(self._db_get, key)
            if hit is not None:
                out.append(hit)
            else:
                todo.append(i)
        async def fetch(chunk: list[str]) -> None:
            try:
                async with self.proc_sem:
                    proc = await asyncio.create_subprocess_exec(
                        get_settings().qloo_executable, "api", "entity", "--id", ",".join(chunk), "--json",
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=qloo_env(),
                    )
                    raw, _ = await asyncio.wait_for(proc.communicate(), 60)
                data = json.loads(raw.decode() or "[]")
                if isinstance(data, dict):
                    data = data.get("results") or data.get("entities") or []
                for e in data:
                    slim = {
                        "entity_id": e.get("entity_id"),
                        "name": e.get("name"),
                        "tags": [{"id": t.get("tag_id"), "name": t.get("name")} for t in e.get("tags", [])][:40],
                        "image": ((e.get("properties") or {}).get("image") or {}).get("url"),
                        "short_description": (e.get("properties") or {}).get("short_description"),
                    }
                    out.append(slim)
                    key = cache_key("api_entity", {"id": slim["entity_id"]})
                    self.mem.put(key, slim)
                    await asyncio.to_thread(self._db_put, key, "api_entity", {"id": slim["entity_id"]}, slim)
            except Exception as e:  # noqa: BLE001
                log.warning("entity lookup failed: %s", e)

        await asyncio.gather(*(fetch(todo[i:i + 12]) for i in range(0, len(todo), 12)))
        return out


gateway = QlooGateway()
