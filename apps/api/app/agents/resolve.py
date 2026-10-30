"""Resolve free text into confirmed Qloo entities. Ambiguity is surfaced to the user, never guessed."""
from __future__ import annotations

from app.qloo.gateway import gateway, results_of

SIGNAL_TYPES = {"artist", "tv_show", "movie", "podcast", "book", "videogame", "brand", "place", "person", "album"}


def _short_type(t: str | None) -> str | None:
    if not t:
        return None
    return t.split(":")[-1]


def candidates_from(env: dict) -> list[dict]:
    out: list[dict] = []
    seen: dict[str, dict] = {}
    for issue in (env.get("resolution") or {}).get("issues", []) or []:
        for c in issue.get("candidates", []) or []:
            t = _short_type(c.get("type"))
            if t not in SIGNAL_TYPES:
                continue
            cid = c.get("id")
            if cid in seen:
                continue  # same entity listed again under a secondary type (e.g. artist + person)
            item = {"id": cid, "name": c.get("name"), "type": t, "popularity": c.get("popularity"),
                    "description": c.get("description"), "release_year": c.get("release_year")}
            seen[cid] = item
            out.append(item)
    # an artist and a "person" with the same name are the same act for our purposes
    names_with_artist = {c["name"].lower() for c in out if c["type"] == "artist"}
    out = [c for c in out if not (c["type"] == "person" and c["name"].lower() in names_with_artist)]
    return out[:6]


async def resolve(text: str, entity_type: str | None = None) -> dict:
    text = text.strip()
    if not text:
        return {"status": "unmatched", "candidates": []}
    args = {"entity": text}
    if entity_type:
        args["type"] = entity_type
    env, _ = await gateway.call("qloo_describe", args)
    st = env.get("status")
    if st == "ok":
        r = results_of(env)
        r = r[0] if isinstance(r, list) and r else (r if isinstance(r, dict) else {})
        if r.get("entity_id"):
            props = r.get("properties") or {}
            t = entity_type or _short_type((env.get("interpretation") or {}).get("type")) or _short_type(r.get("subtype"))
            return {"status": "resolved", "candidates": [{
                "id": r["entity_id"], "name": r.get("name"), "type": t, "popularity": r.get("popularity"),
                "description": props.get("short_description"), "image": (props.get("image") or {}).get("url")}]}
    if st == "needs_input":
        cands = candidates_from(env)
        if entity_type:
            typed = [c for c in cands if c["type"] == entity_type]
            cands = typed or cands
        if len(cands) == 1:
            return {"status": "resolved", "candidates": cands}
        if cands:
            return {"status": "needs_input", "candidates": cands}
    if st == "error":
        return {"status": "error", "candidates": [], "message": (env.get("error") or {}).get("recovery")}
    return {"status": "unmatched", "candidates": []}
