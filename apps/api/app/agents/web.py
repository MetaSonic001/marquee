"""Sponsor-activity research on the public web via Groq's built-in browser_search tool.
Findings are kept only when their source domain actually appears in the executed search output."""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import timedelta
from typing import Any
from urllib.parse import urlparse

from app.agents.llm import budget, client, model_chain, note_rate_limit, parse_json, prompt, usable
from app.config import get_settings
from app.db import QlooCache, now, session
from app.qloo.gateway import cache_key

log = logging.getLogger("marquee.web")
web_sem = asyncio.Semaphore(1)

CITE_RE = re.compile(r"【(\d+)†(.+?)†([^】]+)】")
URL_RE = re.compile(r"URL:\s*(https?://\S+)")


def _sources(executed: list[dict]) -> tuple[list[dict], set[str]]:
    sources: list[dict] = []
    urls: set[str] = set()
    for t in executed or []:
        out = t.get("output") or ""
        for u in URL_RE.findall(out):
            if "exa.ai/search" not in u:
                urls.add(u.rstrip(").,"))
        for _idx, title, domain in CITE_RE.findall(out.replace("\n", " ")):
            domain = domain.strip().lower()
            title = re.sub(r"\s+", " ", title).strip()
            if domain and not any(s["domain"] == domain and s["title"] == title for s in sources):
                sources.append({"title": title[:160], "domain": domain})
    return sources, urls


def _domain(u: str) -> str:
    try:
        return urlparse(u).netloc.lower().removeprefix("www.")
    except ValueError:
        return ""


def _link_for(domain: str, urls: set[str]) -> str:
    d = domain.removeprefix("www.")
    for u in urls:
        if _domain(u) == d:
            return u
    return f"https://{domain}"


def _cache_get(key: str, days: int) -> dict | None:
    with session() as db:
        row = db.get(QlooCache, key)
        if row and row.created_at and (now() - row.created_at) < timedelta(days=days):
            return row.envelope
    return None


def _cache_put(key: str, args: dict, value: dict) -> None:
    with session() as db:
        row = db.get(QlooCache, key)
        if row:
            row.envelope, row.created_at = value, now()
        else:
            row = QlooCache(key=key, tool="web_research", args=args, envelope=value)
        db.add(row)
        db.commit()


async def sponsor_activity(brand: str, event_type_label: str) -> dict[str, Any]:
    """Cached per brand for WEB_CACHE_DAYS: a browser_search call costs ~20K Groq tokens."""
    s = get_settings()
    args = {"brand": brand.lower().strip(), "event_type": event_type_label}
    key = cache_key("web_research", args)
    try:
        hit = await asyncio.to_thread(_cache_get, key, s.web_cache_days)
        if hit:
            return {**hit, "cached": True}
    except Exception:  # noqa: BLE001
        pass
    question = prompt("web_research").replace("{brand}", brand).replace("{event_type}", event_type_label)
    r = None
    for attempt, model in enumerate(model_chain(s.groq_search_model)[:2] * 2):
        if attempt == 2:
            await asyncio.sleep(25)
        if not usable(model) or not await budget.take(model, 7000, max_wait=40):
            continue
        try:
            async with web_sem:
                r = await asyncio.wait_for(client().chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": question}],
                    tools=[{"type": "browser_search"}],
                    tool_choice="required",
                    temperature=0.1,
                    max_completion_tokens=2000,
                ), 100)
            break
        except Exception as e:  # noqa: BLE001
            note_rate_limit(model, e)
            log.warning("web research failed for %s on %s: %s", brand, model, str(e)[:160])
    if r is None:
        return {"status": "unavailable", "summary": "Web research not run this time (API quota) — re-run to research",
                "findings": [], "citations": []}

    msg = r.choices[0].message.model_dump()
    executed = msg.get("executed_tools") or []
    sources, urls = _sources(executed)
    known_domains = {x["domain"].removeprefix("www.") for x in sources} | {_domain(u) for u in urls}
    try:
        data = parse_json(msg.get("content") or "")
    except ValueError:
        data = {}
    def known(dom: str) -> str | None:
        for k in known_domains:
            if k and (dom == k or dom.endswith("." + k) or k.endswith("." + dom)):
                return k
        return None

    findings = []
    for f in (data.get("findings") or [])[:6]:
        dom = (f.get("source_domain") or "").lower().removeprefix("https://").removeprefix("www.").split("/")[0].strip()
        match = known(dom) if dom else None
        if not match:
            continue  # drop anything we can't tie to the executed search
        dom = match
        findings.append({
            "event": str(f.get("event") or "")[:140],
            "year": str(f.get("year") or "")[:9],
            "kind": str(f.get("kind") or "")[:40],
            "source_title": next((x["title"] for x in sources if x["domain"].removeprefix("www.") == dom), dom),
            "source_domain": dom,
            "url": _link_for(dom, urls),
        })
    page = data.get("partnerships_page")
    if page and not any(page.rstrip("/") == u.rstrip("/") for u in urls):
        page = None  # only link pages the search actually opened
    count = len(findings)
    summary = (f"Sponsors {event_type_label}-type events: {count} found (2025–26)" if count
               else "No public sponsorship activity found")
    out = {"status": "ok", "summary": summary, "count": count, "findings": findings,
           "partnerships_page": page, "citations": [{"title": f["source_title"], "url": f["url"]} for f in findings],
           "searched": len(executed)}
    try:
        await asyncio.to_thread(_cache_put, key, args, out)
    except Exception:  # noqa: BLE001
        pass
    return out
