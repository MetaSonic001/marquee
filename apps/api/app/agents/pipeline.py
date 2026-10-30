"""The Marquee agent pipeline: 8 explicit stages with a bounded agentic tool loop in stage 4.
Every Qloo call goes through the gateway (cache, retries) and is streamed as SSE events."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlmodel import select

from app.agents import metrics as M
from app.agents.category_map import (
    CATEGORY_LABELS,
    CATEGORY_SEED_TAGS,
    DEFAULT_SLOTS,
    EVENT_TYPE_LABELS,
    NATURAL_CATEGORIES,
    classify,
    excluded_categories,
    shelf_for,
)
from app.agents.llm import RULES, budget, client, estimate_tokens, note_rate_limit, prompt, usable
from app.agents.resolve import resolve
from app.agents.scoring import components_from_metrics, fit_score
from app.agents.slots import SLOT_ACCEPTS, demographic_from, rank_slot
from app.agents.web import sponsor_activity
from app.agents.writer import crowd_summary, write_brand_bullets
from app.config import get_settings
from app.db import BrandMatch, CrowdProfile, CrowdSignal, Event, Run, SponsorSlot, now, session
from app.memlog import rss_mb
from app.qloo.gateway import gateway, results_of
from app.runbus import bus

log = logging.getLogger("marquee.pipeline")

STAGES = [
    "Understanding your event",
    "Matching your lineup in Qloo",
    "Reading your crowd's taste",
    "Discovering brands",
    "Measuring audience overlap",
    "Checking local strength and momentum",
    "Researching sponsor activity on the web",
    "Building your shortlist",
]
FINGERPRINT_DOMAINS = [("artist", "Music"), ("tv_show", "TV"), ("movie", "Film"), ("podcast", "Podcasts"),
                       ("book", "Books"), ("videogame", "Games")]
MEASURE_NATURAL, MEASURE_HIDDEN = 6, 7
AGENT_MAX_TOOL_CALLS, AGENT_BUDGET_S = 8, 25
TAG_SKIP = ("wikipedia", "keyword", "external", "instrument", "theme:qloo:love", "language", "country", "origin")


def _items(env: dict, limit: int = 10) -> list[dict]:
    r = results_of(env)
    out = []
    for x in (r if isinstance(r, list) else [])[:limit]:
        if not isinstance(x, dict) or not x.get("entity_id"):
            continue
        p = x.get("properties") or {}
        out.append({"id": x["entity_id"], "name": x.get("name"), "affinity": x.get("affinity"),
                    "popularity": x.get("popularity"), "image": (p.get("image") or {}).get("url"),
                    "description": p.get("short_description"), "geocode": p.get("geocode"),
                    "address": p.get("address")})
    return out


class Pipeline:
    def __init__(self, run_id: str, event_id: str):
        self.run_id = run_id
        self.event_id = event_id
        self.emit = bus.emitter(run_id)
        self.t0 = time.monotonic()

    async def stage(self, n: int) -> None:
        await self.emit(n, "stage_start", summary=STAGES[n - 1])
        with session() as db:
            r = db.get(Run, self.run_id)
            if r:
                r.stage = n
                db.add(r)
                db.commit()

    async def done(self, n: int, summary: str, data: Any = None) -> None:
        log.info("stage %s done rss=%.0fMB", n, rss_mb())
        await self.emit(n, "stage_done", summary=summary, data=data)

    # ------------------------------------------------------------------
    async def run(self) -> None:
        try:
            await self._run()
            with session() as db:
                r = db.get(Run, self.run_id)
                assert r
                r.status, r.finished_at = "done", now()
                db.add(r)
                ev = db.get(Event, self.event_id)
                if ev:
                    ev.latest_run_id = self.run_id
                    db.add(ev)
                db.commit()
            await self.emit(8, "done", summary=f"Shortlist ready in {time.monotonic() - self.t0:.0f}s")
        except Exception as e:  # noqa: BLE001
            log.exception("run failed")
            with session() as db:
                r = db.get(Run, self.run_id)
                if r:
                    r.status, r.error, r.finished_at = "error", str(e)[:400], now()
                    db.add(r)
                    db.commit()
            await self.emit(0, "error", summary=str(e)[:300])

    async def _run(self) -> None:
        s = get_settings()
        with session() as db:
            event = db.get(Event, self.event_id)
            assert event
            signals = db.exec(select(CrowdSignal).where(CrowdSignal.event_id == self.event_id)).all()
        etype_label = EVENT_TYPE_LABELS.get(event.type, "event")
        brief = {"name": event.name, "type": etype_label, "city": event.city, "country": event.country,
                 "attendance": event.attendance, "dates": event.dates}

        # 1 ─ understand
        await self.stage(1)
        bits = [f"A {etype_label}"]
        if event.city:
            bits.append(f"in {event.city}")
        if event.attendance:
            bits.append(f"for about {event.attendance:,} people")
        await self.emit(1, "insight", summary=" ".join(bits) + f", with {len(signals)} crowd signals.")
        await self.done(1, " ".join(bits) + ".")

        # 2 ─ match lineup
        await self.stage(2)
        crowd: list[dict] = []
        for sig in signals:
            if sig.status == "resolved" and sig.qloo_entity_id:
                crowd.append({"id": sig.qloo_entity_id, "name": sig.display_name or sig.raw_text, "type": sig.entity_type})
                await self.emit(2, "insight", summary=f"{sig.display_name or sig.raw_text} ✓ confirmed {sig.entity_type or ''}")
                continue
            if sig.status in {"needs_input", "unmatched"}:
                await self.emit(2, "insight", summary=f"Skipping “{sig.raw_text}” (not confirmed)")
                continue
            await self.emit(2, "tool_call", tool="qloo_describe", summary=f"Resolving “{sig.raw_text}”")
            res = await resolve(sig.raw_text)
            await self.emit(2, "tool_result", tool="qloo_describe", summary=res["status"])
            if res["status"] == "resolved":
                c = res["candidates"][0]
                crowd.append({"id": c["id"], "name": c["name"], "type": c.get("type")})
                with session() as db:
                    row = db.get(CrowdSignal, sig.id)
                    if row:
                        row.qloo_entity_id, row.display_name, row.entity_type, row.status = c["id"], c["name"], c.get("type"), "resolved"
                        db.add(row)
                        db.commit()
        if not crowd:
            raise RuntimeError("No crowd signals could be confirmed in Qloo. Add a performer, team or show.")
        crowd_ids = [c["id"] for c in crowd][:10]
        sig_entities = await gateway.entities(crowd_ids)
        await self.done(2, f"{len(crowd)} of {len(signals)} signals confirmed in Qloo",
                        {"signals": [{"name": c["name"], "type": c.get("type")} for c in crowd]})

        # 3 ─ crowd taste
        await self.stage(3)
        fingerprint: dict[str, list] = {}

        async def domain(t: str, label: str) -> None:
            env = await M.qcall("qloo_recommend", {"target_type": t, "signals": crowd_ids, "limit": 8, "explain": False},
                                self.emit, 3, f"What this crowd loves: {label.lower()}")
            items = _items(env, 8)
            if items:
                fingerprint[label] = items
                await self.emit(3, "partial", summary=f"{label}: {', '.join(i['name'] for i in items[:3])}…",
                                data={"fingerprint_domain": label, "items": [{"name": i["name"], "affinity": i["affinity"]} for i in items]})

        brand_env_task = M.qcall("qloo_recommend", {"target_type": "brand", "signals": crowd_ids, "limit": 20},
                                 self.emit, 3, "Brands this crowd over-indexes on")
        place_task = (M.qcall("qloo_recommend", {"target_type": "place", "signals": crowd_ids, "filter_location": event.city,
                                                 "limit": 10, "explain": False}, self.emit, 3, f"Places in {event.city} this crowd loves")
                      if event.city else None)
        demo_tasks = [M.qcall("qloo_audience_demographics", {"entity": cid, "entity_type": "artist"
                                                              if (c.get("type") in (None, "artist")) else c["type"]},
                              self.emit, 3, f"Audience skew for {c['name']}") for cid, c in zip(crowd_ids[:3], crowd[:3], strict=False)]
        res = await asyncio.gather(*(domain(t, lab) for t, lab in FINGERPRINT_DOMAINS), brand_env_task,
                                   *( [place_task] if place_task else []), *demo_tasks, return_exceptions=True)
        brand_env = res[len(FINGERPRINT_DOMAINS)] if not isinstance(res[len(FINGERPRINT_DOMAINS)], Exception) else {}
        idx = len(FINGERPRINT_DOMAINS) + 1
        place_env = None
        if place_task:
            place_env = res[idx] if not isinstance(res[idx], Exception) else None
            idx += 1
        demo_envs = [r for r in res[idx:] if isinstance(r, dict)]
        brand_items = _items(brand_env, 20)
        if brand_items:
            fingerprint["Brands"] = brand_items[:8]
        places = _items(place_env, 10) if place_env else []
        # local heroes must be sponsor-able businesses: drop institutions and anything in an excluded category
        bad = ["school", "college prep", "academy", "church", "hospital", "airport", "university", "cemetery",
               "museum of", "city hall"]
        if "tobacco" in (event.exclude_categories or []):
            bad += ["hookah", "smoke shop", "cigar", "vape", "tobacco"]
        if "gambling" in (event.exclude_categories or []):
            bad += ["casino", "sportsbook", "betting"]
        if "alcohol" in (event.exclude_categories or []):
            bad += ["brewery", "winery", "liquor", "distillery"]
        places = [p for p in places if not any(b in f"{p['name']} {p.get('description') or ''}".lower() for b in bad)]
        places = [p for p in places if not event.city or ((p.get("geocode") or {}).get("city") or "").lower()
                  in event.city.lower() or event.city.lower().split(",")[0] in json.dumps(p.get("geocode") or {}).lower()]
        if places:
            fingerprint["Places"] = places[:8]

        demographics = self._demographics(demo_envs)
        tags = self._crowd_tags(sig_entities)
        summary_task = asyncio.create_task(crowd_summary(
            {k: v for k, v in fingerprint.items()}, tags, demographics, brief))
        top_line = ", ".join(f"{i['name']}" for i in (fingerprint.get("Music") or [])[:3])
        await self.done(3, f"Fingerprint across {len(fingerprint)} domains" + (f" — also loves {top_line}" if top_line else ""),
                        {"domains": list(fingerprint)})

        # 4 ─ discover
        await self.stage(4)
        excl = excluded_categories(event.exclude_categories)
        existing = {x.lower().strip() for x in (event.existing_sponsors or [])}
        pool: dict[str, dict] = {}

        async def add(items: list[dict], source: str) -> None:
            for it in items:
                if it["id"] not in pool:
                    pool[it["id"]] = {**it, "source": source}
                    if len(pool) <= 36:
                        await self.emit(4, "partial", summary=f"Found {it['name']}",
                                        data={"brand": {"id": it["id"], "name": it["name"], "image": it.get("image")}})

        await add(brand_items, "crowd signals")
        natural = [c for c in NATURAL_CATEGORIES.get(event.type, NATURAL_CATEGORIES["other"])
                   if c in CATEGORY_SEED_TAGS and c not in excl]

        async def seed(cat: str) -> None:
            env = await M.qcall("qloo_recommend", {"target_type": "brand", "signals": crowd_ids,
                                                   "include_tags": [CATEGORY_SEED_TAGS[cat]], "limit": 6},
                                self.emit, 4, f"Exploring {CATEGORY_LABELS[cat].lower()}")
            await add(_items(env, 6), f"{CATEGORY_LABELS[cat]} explore")

        await asyncio.gather(*(seed(c) for c in natural), return_exceptions=True)
        try:
            await self._agent_discover(brief, crowd, fingerprint, pool, add, excl)
        except Exception as e:  # noqa: BLE001
            log.warning("agent discovery failed: %s", e)
            await self.emit(4, "insight", summary="Agent exploration skipped; using direct Qloo recommendations")

        ents = {e["entity_id"]: e for e in await gateway.entities(list(pool))}
        cands: list[dict] = []
        dropped = 0
        for bid, it in pool.items():
            e = ents.get(bid, {})
            cat = classify(e.get("tags"), it.get("description") or e.get("short_description"))
            is_existing = it["name"].lower().strip() in existing
            if cat in excl:
                dropped += 1
                continue
            cands.append({**it, "category_key": cat, "category": CATEGORY_LABELS.get(cat, "Other"),
                          "is_existing": is_existing, "image": it.get("image") or e.get("image"),
                          "description": it.get("description") or e.get("short_description")})
        if not cands:
            raise RuntimeError("Qloo returned no brands for this crowd after exclusions.")
        demo = demographic_from(event.age_bands)
        ranks = await M.taste_ranks([c["id"] for c in cands][:40], crowd_ids, demo, self.emit, 4)
        for c in cands:
            c["taste"] = ranks.get(c["id"])
        cands = [c for c in cands if c.get("taste")]
        cands.sort(key=lambda c: c["taste"]["rank"])
        nat = [c for c in cands if shelf_for(c["category_key"], event.type) == "natural" and not c["is_existing"]]
        hid = [c for c in cands if shelf_for(c["category_key"], event.type) == "hidden" and not c["is_existing"]]

        def diverse(items: list[dict], n: int, per_cat: int) -> list[dict]:
            # keep the shortlist varied: at most `per_cat` brands from any one category, best taste first
            out, seen = [], {}
            for c in items:
                if seen.get(c["category_key"], 0) < per_cat:
                    out.append(c)
                    seen[c["category_key"]] = seen.get(c["category_key"], 0) + 1
                if len(out) == n:
                    break
            return out

        chosen = diverse(nat, MEASURE_NATURAL, 2) + diverse(hid, MEASURE_HIDDEN, 3)
        if len(chosen) < MEASURE_NATURAL + MEASURE_HIDDEN:
            rest = [c for c in cands if c not in chosen and not c["is_existing"]]
            chosen += rest[:MEASURE_NATURAL + MEASURE_HIDDEN - len(chosen)]
        chosen += [c for c in cands if c["is_existing"]][:3]
        await self.done(4, f"{len(cands)} candidate brands from Qloo" + (f" ({dropped} excluded)" if dropped else "")
                        + f"; measuring the top {len(chosen)}", {"candidates": len(cands)})

        # 5 ─ overlap (web research starts in parallel)
        await self.stage(5)
        web_targets = [c for c in chosen if not c["is_existing"]][: s.web_research_brands]
        web_results: dict[str, dict] = {}

        async def web_one(c: dict) -> None:
            await self.emit(7, "tool_call", tool="web_search", summary=f"Searching sponsorships: {c['name']}")
            r = await sponsor_activity(c["name"], etype_label)
            web_results[c["id"]] = r
            await self.emit(7, "tool_result", tool="web_search", summary=f"{c['name']}: {r['summary']}",
                            data={"brand": c["name"], "count": r.get("count", 0)})

        web_task = asyncio.gather(*(web_one(c) for c in web_targets), return_exceptions=True)
        fan_type = "artist" if sum(1 for c in crowd if (c.get("type") or "artist") == "artist") * 2 >= len(crowd) else "person"
        ov_list = await asyncio.gather(*(M.overlap(c["id"], c["name"], crowd_ids, self.emit, 5, fan_type) for c in chosen),
                                       return_exceptions=True)
        for c, ov in zip(chosen, ov_list, strict=True):
            c["overlap"] = ov if isinstance(ov, dict) else {"available": False}
        best = max(chosen, key=lambda c: c["overlap"].get("shared_count") or 0)
        await self.done(5, f"Biggest overlap: {best['name']} fans share {best['overlap'].get('shared_count', 0)} "
                           f"of your crowd's top {best['overlap'].get('of', 20)} tastes")

        # 6 ─ local + momentum
        await self.stage(6)
        loc_list = await asyncio.gather(*(M.local_strength(c["id"], c["name"], event.city, event.country, self.emit, 6)
                                          for c in chosen), return_exceptions=True)
        trends = await M.momentum([c["id"] for c in chosen], "brand", self.emit, 6)
        for c, loc in zip(chosen, loc_list, strict=True):
            c["local"] = loc if isinstance(loc, dict) else {"available": False}
            c["trend"] = trends.get(c["id"], {"available": False})
        rising = max(chosen, key=lambda c: c["trend"].get("rel_change") or -9)
        msg = f"{sum(1 for c in chosen if c['local'].get('available'))} brands measured in {event.city or 'the event city'}"
        if rising["trend"].get("available"):
            msg += f"; fastest riser: {rising['name']} ({rising['trend']['rel_change'] * 100:+.0f}%)"
        await self.done(6, msg)

        # 7 ─ web
        await self.stage(7)
        await web_task
        found = sum(1 for r in web_results.values() if r.get("count"))
        await self.done(7, f"{found} of {len(web_targets)} brands show public sponsorship activity (cited)")

        # 8 ─ build
        await self.stage(8)
        brands: list[dict] = []
        for c in chosen:
            sp = web_results.get(c["id"])
            m = M.metrics_from(c["taste"], c["overlap"], c["local"], c["trend"],
                               sp.get("count") if sp and sp.get("status") == "ok" else None)
            comps = components_from_metrics(m)
            brands.append({
                "qloo_entity_id": c["id"], "name": c["name"], "category": c["category"], "category_key": c["category_key"],
                "logo_url": c.get("image"), "description": c.get("description"),
                "shelf": shelf_for(c["category_key"], event.type), "metrics": m, "components": comps,
                "fit": fit_score(comps), "overlap": c["overlap"], "local": c["local"], "trend": c["trend"],
                "sponsor_activity": sp or {"status": "not_researched", "summary": "Not researched in this run"},
                "is_existing": c["is_existing"], "why": [], "start_here": {},
            })
        await self.emit(8, "tool_call", tool="writer", summary="Writing evidence-backed reasons")
        await write_brand_bullets([b for b in brands], brief)
        for b in brands:
            sp = b["sponsor_activity"]
            if sp.get("partnerships_page"):
                b["start_here"]["partnerships_page"] = sp["partnerships_page"]
        # local heroes (places in the event city)
        local_rows = []
        for i, p in enumerate(places[:6]):
            m = {"taste_rank": i + 1, "taste_n": len(places[:6]), "taste_affinity": p.get("affinity"),
                 "taste_top_pct": None, "local_city": event.city}
            comps = components_from_metrics(m)
            # places are ranked on their own shelf; their fit is Qloo's affinity for the crowd, not a rank percentile
            comps["taste"] = round(float(p.get("affinity") or 0), 4)
            local_rows.append({
                "qloo_entity_id": p["id"], "name": p["name"], "category": "Local place", "category_key": "local_place",
                "logo_url": p.get("image"), "description": p.get("description"), "shelf": "local", "metrics": m,
                "components": comps, "fit": fit_score(comps), "overlap": {}, "local": {"address": p.get("address"),
                                                                                         "geocode": p.get("geocode")},
                "trend": {}, "sponsor_activity": {"status": "not_researched", "summary": "Local business — not researched"},
                "is_existing": False, "start_here": {"activation": "Ticket-holder perk",
                                                     "reason": "Marquee suggests a local perk partnership."},
                "why": [{**x, "source": "Qloo · recommend"} for x in
                        [{"text": f"Qloo ranks {p['name']} #{i + 1} of {len(places[:6])} {event.city} places for your crowd"
                                  + (f" (affinity {p['affinity']:.2f})." if p.get("affinity") else "."),
                          "evidence": f"qloo:recommend:place:{p['id']}"}]],
            })
        summary, cited = await summary_task
        with session() as db:
            db.add(CrowdProfile(run_id=self.run_id, event_id=self.event_id, fingerprint=fingerprint,
                                demographics=demographics, tags=tags, summary=summary,
                                evidence={"cited_ids": cited, "signals": crowd}))
            for b in brands + local_rows:
                db.add(BrandMatch(run_id=self.run_id, event_id=self.event_id, **b))
            db.commit()
        await self._default_slots(event, brands)
        top = sorted([b for b in brands if not b["is_existing"]], key=lambda b: b["fit"], reverse=True)[:3]
        await self.done(8, "Now showing: " + " · ".join(b["name"] for b in top))

    # ------------------------------------------------------------------
    def _demographics(self, envs: list[dict]) -> dict:
        ages: dict[str, list[float]] = {}
        gender: dict[str, list[float]] = {}
        for env in envs:
            for r in results_of(env) if isinstance(results_of(env), list) else []:
                q = (r or {}).get("query") or {}
                for k, v in (q.get("age") or {}).items():
                    ages.setdefault(k, []).append(float(v))
                for k, v in (q.get("gender") or {}).items():
                    gender.setdefault(k, []).append(float(v))
        if not ages:
            return {}
        return {"age": {k: round(sum(v) / len(v), 3) for k, v in ages.items()},
                "gender": {k: round(sum(v) / len(v), 3) for k, v in gender.items()},
                "note": "Relative skew vs. Qloo's baseline (positive = over-represented). Averaged across signals.",
                "n_signals": len(envs)}

    def _crowd_tags(self, ents: list[dict]) -> list[dict]:
        counts: dict[str, dict] = {}
        for e in ents:
            for t in e.get("tags") or []:
                tid = t.get("id") or ""
                if not tid or any(s in tid for s in TAG_SKIP):
                    continue
                c = counts.setdefault(tid, {"id": tid, "name": t.get("name"), "count": 0, "kind": tid.split(":")[2]
                                            if tid.count(":") >= 2 else "tag"})
                c["count"] += 1
        return sorted(counts.values(), key=lambda c: c["count"], reverse=True)[:16]

    async def _agent_discover(self, brief: dict, crowd: list[dict], fingerprint: dict, pool: dict, add, excl: set) -> None:
        s = get_settings()
        other_affinities = {d: [{"id": i["id"], "name": i["name"]} for i in items[:4]]
                            for d, items in fingerprint.items() if d not in ("Brands", "Music")}
        if not other_affinities:
            return
        tools = [
            {"type": "function", "function": {
                "name": "qloo_recommend", "description": "Qloo recommendations of brands for a taste profile.",
                "parameters": {"type": "object", "required": ["signals"], "properties": {
                    "signals": {"type": "array", "items": {"type": "string"}, "description": "Qloo entity ids (1-10)"},
                    "include_tags": {"type": "array", "items": {"type": "string"}, "description": "optional Qloo tag URNs"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10}}}}},
            {"type": "function", "function": {
                "name": "submit_candidates", "description": "Submit the final brand list (Qloo entity ids seen in results).",
                "parameters": {"type": "object", "required": ["brands"], "properties": {
                    "brands": {"type": "array", "items": {"type": "object", "properties": {
                        "id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["id"]}}}}}},
        ]
        ctx = {"event": brief, "crowd_signals": crowd, "crowd_other_affinities": other_affinities,
               "already_found": [{"id": k, "name": v["name"]} for k, v in list(pool.items())[:30]],
               "excluded_categories": sorted(excl)}
        messages: list[dict] = [{"role": "system", "content": prompt("discover") + "\n\n" + RULES.replace("Reply with JSON only.", "")},
                                {"role": "user", "content": json.dumps(ctx)}]
        calls = 0
        t_end = time.monotonic() + AGENT_BUDGET_S
        await self.emit(4, "insight", summary="Agent exploring the crowd's other tastes for hidden gems")
        while calls < AGENT_MAX_TOOL_CALLS and time.monotonic() < t_end:
            if not usable(s.groq_agent_model):
                break
            if not await budget.take(s.groq_agent_model, estimate_tokens(json.dumps(messages)) + 800,
                                     max_wait=max(1, t_end - time.monotonic())):
                break
            try:
                r = await asyncio.wait_for(client().chat.completions.create(
                    model=s.groq_agent_model, messages=messages, tools=tools, tool_choice="auto",
                    temperature=0.2, max_completion_tokens=1500), max(5, t_end - time.monotonic()))
            except Exception as e:  # noqa: BLE001
                note_rate_limit(s.groq_agent_model, e)
                raise
            msg = r.choices[0].message
            if not msg.tool_calls:
                break
            messages.append({"role": "assistant", "content": msg.content or "",
                             "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
            stop = False
            for tc in msg.tool_calls:
                calls += 1
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                if tc.function.name == "submit_candidates":
                    stop = True
                    content = "ok"
                elif tc.function.name == "qloo_recommend":
                    q = {"target_type": "brand", "signals": [x for x in args.get("signals", []) if isinstance(x, str)][:10]
                         or [c["id"] for c in crowd][:10], "limit": min(10, int(args.get("limit") or 8))}
                    if args.get("include_tags"):
                        q["include_tags"] = args["include_tags"][:3]
                    names = [c["name"] for d in fingerprint.values() for c in d if c["id"] in q["signals"]]
                    env = await M.qcall("qloo_recommend", q, self.emit, 4,
                                        "Brands for fans of " + (", ".join(names[:2]) or "the crowd"))
                    items = _items(env, 10)
                    await add(items, "agent: " + (", ".join(names[:2]) or "crowd"))
                    content = json.dumps({"status": env.get("status"),
                                          "results": [{"entity_id": i["id"], "name": i["name"],
                                                       "affinity": round(i["affinity"] or 0, 3)} for i in items]})
                else:
                    content = json.dumps({"error": "unknown tool"})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": content})
            if stop:
                break
        await self.emit(4, "insight", summary=f"Agent made {calls} tool calls; {len(pool)} brands in the pool")

    async def _default_slots(self, event: Event, brands: list[dict]) -> None:
        with session() as db:
            existing = {s.name: s for s in db.exec(select(SponsorSlot).where(SponsorSlot.event_id == event.id)).all()}
            created: list[str] = []
            for order, (name, key) in enumerate(DEFAULT_SLOTS.get(event.type, DEFAULT_SLOTS["other"])):
                accepts = SLOT_ACCEPTS.get(key, {key})
                disc = [{"qloo_entity_id": b["qloo_entity_id"], "name": b["name"], "source": "discovered",
                         "logo_url": b["logo_url"], "category_key": b["category_key"]}
                        for b in sorted(brands, key=lambda b: b["fit"], reverse=True)
                        if b["category_key"] in accepts and not b["is_existing"]][:6]
                slot = existing.get(name)
                if slot:
                    users = [c for c in slot.candidates if c.get("source") == "user"]
                    ids = {c["qloo_entity_id"] for c in users}
                    slot.candidates = (users + [d for d in disc if d["qloo_entity_id"] not in ids])[:8]
                else:
                    slot = SponsorSlot(event_id=event.id, name=name, category_key=key, order=order,
                                       tier_label="Official", candidates=disc)
                db.add(slot)
                db.commit()
                db.refresh(slot)
                if len(slot.candidates) >= 2:
                    created.append(slot.id)
        for sid in created:
            try:
                await rank_slot(sid, self.emit, 8)
            except Exception as e:  # noqa: BLE001
                log.warning("slot rank failed: %s", e)


async def start_run(event_id: str) -> str:
    with session() as db:
        r = Run(event_id=event_id)
        db.add(r)
        db.commit()
        rid = r.id
    p = Pipeline(rid, event_id)
    task = asyncio.create_task(p.run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return rid


_tasks: set[asyncio.Task] = set()
