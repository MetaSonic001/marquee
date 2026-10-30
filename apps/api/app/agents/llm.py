"""Thin Groq wrappers. Prompts live in app/agents/prompts/*.md. Never log full prompts.

Groq's free tier allows ~8K tokens/minute and ~200K tokens/day *per model*, so work is spread
across models and every call falls back to the next model on a rate-limit error."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from groq import AsyncGroq, RateLimitError

from app.config import get_settings

log = logging.getLogger("marquee.llm")
PROMPTS = Path(__file__).parent / "prompts"
vision_sem = asyncio.Semaphore(2)
llm_sem = asyncio.Semaphore(2)


@lru_cache
def client() -> AsyncGroq:
    return AsyncGroq(api_key=get_settings().groq_api_key, max_retries=1, timeout=90)


@lru_cache
def prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


RULES = prompt("rules")


def model_chain(primary: str) -> list[str]:
    s = get_settings()
    chain = [primary, s.groq_agent_model, s.groq_writer_model, s.groq_search_model]
    return list(dict.fromkeys(m for m in chain if m))


def parse_json(text: str) -> Any:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
    if start >= 0:
        end = max(text.rfind("}"), text.rfind("]"))
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    raise ValueError("model did not return JSON")


class TokenBudget:
    """Rolling 60s token budget per model, kept under Groq's ~8K tokens/minute so calls queue
    instead of failing with 429."""

    def __init__(self, per_minute: int = 7000):
        self.per_minute = per_minute
        self.spent: dict[str, list[tuple[float, int]]] = {}
        self.lock = asyncio.Lock()

    async def take(self, model: str, tokens: int, max_wait: float = 45) -> bool:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + max_wait
        while True:
            async with self.lock:
                t = loop.time()
                window = [(ts, n) for ts, n in self.spent.get(model, []) if t - ts < 60]
                used = sum(n for _, n in window)
                if used + tokens <= self.per_minute or not window:
                    window.append((t, tokens))
                    self.spent[model] = window
                    return True
                wait = 60 - (t - window[0][0]) + 0.2
            if loop.time() + wait > deadline:
                return False  # caller tries another model rather than stalling the run
            await asyncio.sleep(min(wait, 10))


budget = TokenBudget()
_exhausted: dict[str, float] = {}  # model -> monotonic time until which its daily quota is spent


def usable(model: str) -> bool:
    import time

    return _exhausted.get(model, 0) < time.monotonic()


def note_rate_limit(model: str, err: Exception) -> None:
    """A tokens-per-day 429 means the model is out for a while: skip it instead of waiting."""
    import time

    if "per day" in str(err) or "TPD" in str(err):
        _exhausted[model] = time.monotonic() + 1800
_cache: dict[str, Any] = {}


def estimate_tokens(*texts: str) -> int:
    return sum(len(t) for t in texts) // 3 + 50


async def json_call(system: str, user: str, model: str | None = None, temperature: float = 0.2,
                    max_tokens: int = 3000) -> Any:
    s = get_settings()
    import hashlib

    key = hashlib.sha256((system + "\x00" + user).encode()).hexdigest()
    if key in _cache:  # identical prompt (e.g. a re-run on cached Qloo data) costs nothing
        return _cache[key]
    need = estimate_tokens(system, RULES, user) + max_tokens // 2
    result = await _json_call(system, user, model or s.groq_writer_model, temperature, max_tokens, need)
    if len(_cache) > 300:
        _cache.clear()
    _cache[key] = result
    return result


async def _json_call(system: str, user: str, model: str, temperature: float, max_tokens: int, need: int) -> Any:
    s = get_settings()
    last: Exception | None = None
    # per-minute token limits: cycle the model chain, then wait for the window and try again (3 rounds)
    chain = [m for m in model_chain(model) if m != s.groq_search_model] or model_chain(model)
    rounds = [m for _ in range(2) for m in chain]
    for i, m in enumerate(rounds):
        if not usable(m):
            continue
        if i and i % len(chain) == 0:
            await asyncio.sleep(15)
        if not await budget.take(m, need, max_wait=25):
            continue
        try:
            async with llm_sem:
                r = await client().chat.completions.create(
                    model=m,
                    messages=[{"role": "system", "content": system + "\n\n" + RULES},
                              {"role": "user", "content": user}],
                    response_format={"type": "json_object"},
                    temperature=temperature,
                    max_completion_tokens=max_tokens,
                )
            return parse_json(r.choices[0].message.content or "")
        except RateLimitError as e:
            last = e
            note_rate_limit(m, e)
            log.warning("rate limited on %s; trying next model", m)
        except Exception as e:  # noqa: BLE001
            last = e
            log.warning("json_call failed on %s: %s", m, str(e)[:200])
    raise RuntimeError(f"LLM call failed: {str(last)[:200]}")


async def vision_json(system: str, text: str, images_b64: list[str]) -> Any:
    """images_b64: JPEG base64 strings (<=5 per call, already downscaled)."""
    s = get_settings()
    content: list[dict] = [{"type": "text", "text": text}]
    for b in images_b64[:5]:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}})
    await budget.take(s.groq_vision_model, 1200 * len(images_b64[:5]) + 1500)
    async with vision_sem:
        r = await client().chat.completions.create(
            model=s.groq_vision_model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_completion_tokens=2500,
        )
    return parse_json(r.choices[0].message.content or "")
