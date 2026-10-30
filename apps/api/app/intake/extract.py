"""Multimodal intake: PDF text + page renders, images, website text, free text -> event brief.
Memory-conscious: one PDF page rendered at a time, images downscaled and closed immediately."""
from __future__ import annotations

import base64
import io
import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from app.agents.llm import json_call, prompt, vision_json

log = logging.getLogger("marquee.intake")

MAX_PDF_PAGES = 6
PDF_DPI = 110
MAX_IMG_PX = 1600


def jpeg_b64(img: Image.Image, max_px: int = MAX_IMG_PX, quality: int = 80) -> str:
    img = img.convert("RGB")
    img.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def image_file_b64(path: Path) -> str:
    with Image.open(path) as im:
        return jpeg_b64(im)


def pdf_extract(path: Path, label: str) -> tuple[str, list[tuple[str, str]]]:
    """Returns (text, [(page_label, jpeg_b64)]) for up to MAX_PDF_PAGES visual pages."""
    import pymupdf

    text_parts: list[str] = []
    renders: list[tuple[str, str]] = []
    with pymupdf.open(path) as doc:
        for i, page in enumerate(doc):
            t = page.get_text("text") or ""
            if t.strip():
                text_parts.append(f"[{label} p.{i + 1}]\n{t.strip()[:4000]}")
            if i >= MAX_PDF_PAGES:
                continue
            images = page.get_images(full=False)
            mostly_text = len(t) > 1500 and not images
            if mostly_text:
                continue
            pix = page.get_pixmap(dpi=PDF_DPI)
            img = Image.open(io.BytesIO(pix.tobytes("jpeg")))
            del pix
            renders.append((f"{label} p.{i + 1}", jpeg_b64(img)))
            img.close()
    return "\n\n".join(text_parts)[:20000], renders


def url_extract(url: str) -> str:
    import trafilatura

    with httpx.Client(follow_redirects=True, timeout=15, headers={"User-Agent": "Mozilla/5.0 Marquee/1.0"}) as c:
        r = c.get(url)
        r.raise_for_status()
        html = r.text[:2_000_000]
    return (trafilatura.extract(html, include_comments=False, include_tables=True) or "")[:15000]


async def run_intake(pdfs: list[tuple[str, Path]], images: list[tuple[str, Path]], url: str | None,
                     text: str | None) -> AsyncIterator[dict[str, Any]]:
    """Yields progress events, finally {"kind": "brief", "data": {...}}."""
    corpus: list[str] = []
    visuals: list[tuple[str, str]] = []
    for name, path in pdfs:
        yield {"kind": "progress", "summary": f"Reading {name}"}
        try:
            t, renders = pdf_extract(path, name)
            corpus.append(t)
            visuals.extend(renders)
            yield {"kind": "progress", "summary": f"{name}: {len(t):,} characters, {len(renders)} visual pages"}
        except Exception as e:  # noqa: BLE001
            yield {"kind": "warning", "summary": f"Couldn't read {name}: {str(e)[:120]}"}
    for name, path in images:
        try:
            visuals.append((name, image_file_b64(path)))
            yield {"kind": "progress", "summary": f"Prepared {name}"}
        except Exception as e:  # noqa: BLE001
            yield {"kind": "warning", "summary": f"Couldn't open {name}: {str(e)[:120]}"}
    if url:
        yield {"kind": "progress", "summary": f"Fetching {url}"}
        try:
            import asyncio

            t = await asyncio.to_thread(url_extract, url)
            if t:
                corpus.append(f"[website]\n{t}")
                yield {"kind": "progress", "summary": f"Website: {len(t):,} characters"}
            else:
                yield {"kind": "warning", "summary": "The website returned no readable text — paste it as text instead"}
        except Exception:  # noqa: BLE001
            yield {"kind": "warning", "summary": "The website blocked us — paste its text instead"}
    if text and text.strip():
        corpus.append(f"[notes]\n{text.strip()[:8000]}")

    readings: list[dict] = []
    for i in range(0, len(visuals), 5):
        batch = visuals[i:i + 5]
        yield {"kind": "progress", "summary": "Looking at " + ", ".join(lbl for lbl, _ in batch)}
        try:
            labels = "\n".join(f"Image {j + 1} label: {lbl}" for j, (lbl, _) in enumerate(batch))
            out = await vision_json(prompt("vision"), f"Read these event images.\n{labels}", [b for _, b in batch])
            readings.extend(out.get("pages") or [])
        except Exception as e:  # noqa: BLE001
            log.warning("vision failed: %s", e)
            yield {"kind": "warning", "summary": "Vision model unavailable for some images"}
    if readings:
        corpus.append("[image readings]\n" + json.dumps(readings)[:8000])
    if not corpus:
        yield {"kind": "brief", "data": {}}
        return
    yield {"kind": "progress", "summary": "Merging everything into one brief"}
    brief = await json_call(prompt("intake_merge"), "\n\n".join(corpus)[:30000], max_tokens=2000)
    logos = set()
    for r in readings:
        for lg in r.get("sponsor_logos") or []:
            if isinstance(lg, str) and lg.strip():
                logos.add(lg.strip())
    for lg in brief.get("logos_seen") or []:
        if isinstance(lg, str) and lg.strip():
            logos.add(lg.strip())
    brief["logos_seen"] = sorted(logos)
    yield {"kind": "brief", "data": brief}
