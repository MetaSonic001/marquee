"""Per-brand Qloo measurements: audience overlap, local strength, momentum, taste rank."""
from __future__ import annotations

import asyncio
import math
from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from typing import Any

from app.agents.geo import nearest_city
from app.qloo.gateway import gateway, results_of

Emit = Callable[..., Awaitable[None]]


async def _noop(*_a: Any, **_k: Any) -> None:
    return None


async def qcall(tool: str, args: dict, emit: Emit = _noop, stage: int = 0, label: str = "") -> dict:
    await emit(stage, "tool_call", tool=tool, summary=label or f"Calling {tool}")
    env, hit = await gateway.call(tool, args)
    rc = env.get("result_count")
    if rc is None:
        r = results_of(env)
        rc = len(r) if isinstance(r, list) else (1 if r else 0)
    await emit(stage, "tool_result", tool=tool, summary=f"{env.get('status')} · {rc} results" + (" · cached" if hit else ""),
               data={"status": env.get("status"), "cached": hit})
    return env


def rank_affinities(env: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    r = results_of(env)
    if isinstance(r, list):
        for i, x in enumerate(r):
            if x.get("entity_id"):
                out[x["entity_id"]] = float(x.get("affinity") if x.get("affinity") is not None else 1 - i / 100)
    return out


async def taste_ranks(candidate_ids: list[str], crowd_ids: list[str], demographic: str | None = None,
                      emit: Emit = _noop, stage: int = 0) -> dict[str, dict]:
    """qloo_rank in batches of <=10 against the same crowd profile; returns id -> {affinity, rank, n}."""
    aff: dict[str, float] = {}
    batches = [candidate_ids[i:i + 10] for i in range(0, len(candidate_ids), 10)]

    async def one(batch: list[str]) -> None:
        args: dict[str, Any] = {"options": batch, "option_type": "brand", "signals": crowd_ids[:10]}
        if demographic:
            args["demographic"] = demographic
        env = await qcall("qloo_rank", args, emit, stage, f"Ranking {len(batch)} brands for this crowd")
        aff.update(rank_affinities(env))

    await asyncio.gather(*(one(b) for b in batches))
    ordered = sorted(aff.items(), key=lambda kv: kv[1], reverse=True)
    n = len(ordered)
    return {cid: {"affinity": a, "rank": i + 1, "n": n} for i, (cid, a) in enumerate(ordered)}


# identity-type tags (language, gender, ethnicity, nationality…) are not tastes: never used as "shared tastes"
SENSITIVE_TAG_PARTS = ("language", "gender", "ethnic", "nationality", "country", "race", "religio", "sexual",
                       "demographic", "age:", "citizenship")
SENSITIVE_TAG_NAMES = {"male", "female", "english", "american", "african-american", "african american", "black",
                       "white", "latino", "latina", "hispanic", "asian", "christian", "jewish", "muslim", "lgbt", "gay"}


def _sensitive(tid: str, name: str) -> bool:
    return any(p in tid.lower() for p in SENSITIVE_TAG_PARTS) or name.strip().lower() in SENSITIVE_TAG_NAMES


def _tag_counts(items: list[dict]) -> dict[str, dict]:
    out = {}
    for t in items or []:
        tid = t.get("tag_id") or t.get("id")
        if not tid or _sensitive(tid, t.get("name") or ""):
            continue
        try:
            c = int((t.get("query") or {}).get("count") or 0)
        except (TypeError, ValueError):
            c = 0
        out[tid] = {"tag_id": tid, "name": (t.get("name") or "").replace(" - ", "-"), "count": c,
                    "subtype": t.get("subtype")}
    return out


async def overlap(brand_id: str, brand_name: str, crowd_ids: list[str], emit: Emit = _noop,
                  stage: int = 5, fan_type: str = "artist") -> dict:
    """Brand fans' favourite artists/people (qloo_recommend, same entity type as the crowd's signals) compared
    with the crowd (qloo_compare_audiences). Shared = Qloo tags characterising both groups, of the crowd's top 20."""
    rec = await qcall("qloo_recommend", {"target_type": fan_type, "signals": [brand_id], "limit": 10, "explain": False},
                      emit, stage, f"Who {brand_name} fans love" if fan_type != "artist" else f"What {brand_name} fans listen to")
    fans = [x for x in (results_of(rec) or []) if isinstance(x, dict) and x.get("entity_id")]
    if rec.get("status") not in {"ok", "partial", "degraded"} or not fans:
        return {"available": False, "reason": f"Qloo returned {rec.get('status')} for {brand_name} fans' music"}
    cmp = await qcall("qloo_compare_audiences", {"group_a": crowd_ids[:10], "group_b": [f["entity_id"] for f in fans[:10]],
                                                 "limit": 20}, emit, stage, f"Comparing your crowd with {brand_name} fans")
    res = results_of(cmp)
    if not isinstance(res, dict) or cmp.get("status") not in {"ok", "partial", "degraded"}:
        return {"available": False, "reason": f"compare_audiences returned {cmp.get('status')}"}
    a = _tag_counts(res.get("a", []))
    b = _tag_counts(res.get("b", []))
    shared_ids = [t for t in a if t in b]
    shared = [{"tag_id": t, "name": a[t]["name"], "crowd": a[t]["count"], "brand": b[t]["count"]} for t in shared_ids]
    of = max(1, min(20, len(a)))
    return {
        "available": True,
        "shared_count": len(shared),
        "of": of,
        "ratio": round(len(shared) / of, 3),
        "shared": shared,
        "crowd_top": list(a.values())[:20],
        "brand_top": list(b.values())[:20],
        "brand_fan_artists": [{"id": f["entity_id"], "name": f.get("name"), "affinity": f.get("affinity")}
                              for f in fans[:10]],
        "evidence": f"qloo:compare_audiences:{brand_id}",
    }


async def local_strength(brand_id: str, brand_name: str, city: str | None, country: str | None,
                         emit: Emit = _noop, stage: int = 6) -> dict:
    out: dict[str, Any] = {"available": False, "city": city}
    tasks = []
    if city:
        within = f"{city}, {country}" if country and country.lower() not in city.lower() else city
        tasks.append(qcall("qloo_where_popular", {"entity": brand_id, "entity_type": "brand", "within": within, "limit": 5},
                           emit, stage, f"{brand_name} in {city}"))
    if country:
        tasks.append(qcall("qloo_where_popular", {"entity": brand_id, "entity_type": "brand", "within": country,
                                                  "limit": 20}, emit, stage, f"{brand_name} across {country}"))
    envs = await asyncio.gather(*tasks) if tasks else []
    city_env = envs[0] if city and envs else None
    nat_env = envs[-1] if country and envs else None
    if city_env and city_env.get("status") in {"ok", "partial", "degraded"}:
        pts = [x.get("query", {}) for x in results_of(city_env) if isinstance(x, dict)]
        ranks = [float(p.get("affinity_rank")) for p in pts if p.get("affinity_rank") is not None]
        if ranks:
            mean = sum(ranks) / len(ranks)
            out.update(available=True, city_affinity_rank=round(mean, 4), city_areas=len(ranks),
                       top_pct=round(max(0.1, (1 - mean) * 100), 1))
    if nat_env and nat_env.get("status") in {"ok", "partial", "degraded"}:
        hot: dict[str, dict] = {}
        for x in results_of(nat_env):
            if not isinstance(x, dict):
                continue
            loc = x.get("location") or {}
            q = x.get("query") or {}
            lat, lon = loc.get("latitude"), loc.get("longitude")
            if lat is None or lon is None:
                continue
            name, dist = nearest_city(lat, lon)
            label = name if dist < 120 else f"{lat:.1f}, {lon:.1f}"
            prev = hot.get(label)
            val = float(q.get("affinity_rank") or 0)
            if not prev or val > prev["affinity_rank"]:
                hot[label] = {"area": label, "affinity_rank": round(val, 4), "lat": lat, "lon": lon}
        out["national_hotspots"] = sorted(hot.values(), key=lambda h: h["affinity_rank"], reverse=True)[:10]
    out["evidence"] = f"qloo:where_popular:{brand_id}"
    return out


async def momentum(entity_ids: list[str], entity_type: str = "brand", emit: Emit = _noop,
                   stage: int = 6) -> dict[str, dict]:
    end = date.today()
    start = end - timedelta(days=365)
    out: dict[str, dict] = {}

    async def batch(ids: list[str]) -> None:
        env = await qcall("qloo_trends", {"entities": ids, "entity_type": entity_type, "start_date": start.isoformat(),
                                          "end_date": end.isoformat()}, emit, stage, f"12-month trend for {len(ids)} brands")
        for s in results_of(env) if isinstance(results_of(env), list) else []:
            ent = s.get("entity") or {}
            eid = ent.get("entityId") or ent.get("input")
            pts = sorted([p for p in s.get("points", []) if p.get("population_percentile") is not None],
                         key=lambda p: p["date"])
            if not eid or len(pts) < 4:
                continue
            vals = [float(p["population_percentile"]) for p in pts]
            k = max(1, min(4, len(vals) // 4))
            first, last = sum(vals[:k]) / k, sum(vals[-k:]) / k
            rel = (last - first) / first if first > 0 else None
            flat = max(vals) - min(vals) < 1e-6
            step = max(1, math.ceil(len(pts) / 26))
            out[eid] = {
                # a perfectly flat series carries no momentum signal: shown as "Flat", left out of the Fit
                "available": rel is not None and not flat,
                "flat": flat,
                "level": round(last, 4),
                "points": len(pts),
                "from": pts[0]["date"], "to": pts[-1]["date"],
                "rel_change": round(rel, 4) if rel is not None else None,
                "first": round(first, 4), "last": round(last, 4),
                "series": [{"d": p["date"], "v": round(float(p["population_percentile"]), 4)} for p in pts[::step]],
                "evidence": f"qloo:trends:{eid}",
            }

    await asyncio.gather(*(batch(entity_ids[i:i + 5]) for i in range(0, len(entity_ids), 5)))
    return out


def metrics_from(taste: dict | None, ov: dict | None, loc: dict | None, tr: dict | None,
                 sponsor_findings: int | None) -> dict:
    taste = taste or {}
    ov = ov or {}
    loc = loc or {}
    tr = tr or {}
    return {
        "taste_rank": taste.get("rank"), "taste_n": taste.get("n"), "taste_affinity": taste.get("affinity"),
        "taste_top_pct": round(100 * taste["rank"] / taste["n"], 0) if taste.get("rank") and taste.get("n") else None,
        "overlap_shared": ov.get("shared_count") if ov.get("available") else None,
        "overlap_of": ov.get("of") if ov.get("available") else None,
        "overlap_pct": round(100 * ov["ratio"]) if ov.get("available") else None,
        "local_affinity_rank": loc.get("city_affinity_rank") if loc.get("available") else None,
        "local_top_pct": loc.get("top_pct") if loc.get("available") else None,
        "local_city": loc.get("city"),
        "momentum_rel": tr.get("rel_change") if tr.get("available") else None,
        "momentum_pct": round(100 * tr["rel_change"], 1) if tr.get("available") and tr.get("rel_change") is not None else None,
        "momentum_flat": bool(tr.get("flat")),
        "popularity_pctl": round(100 * tr["level"]) if tr.get("level") is not None else None,
        "sponsor_findings": sponsor_findings,
    }
