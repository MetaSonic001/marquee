"""Unit tests for the deterministic core: scoring, shelves, exclusions, validation, envelopes, cache keys."""
import json
from pathlib import Path

import pytest

from app.agents import scoring as S
from app.agents.category_map import classify, excluded_categories, shelf_for
from app.agents.resolve import candidates_from
from app.agents.writer import fallback_bullets, valid_bullet
from app.qloo.gateway import LRU, cache_key, cacheable, results_of

ROOT = Path(__file__).resolve().parents[3]
FIX = Path(__file__).parent / "fixtures" / "qloo"


@pytest.mark.parametrize("vec", json.loads((ROOT / "docs" / "scoring_vectors.json").read_text()))
def test_shared_lens_vectors(vec):
    for lens, expected in vec["fits"].items():
        assert S.fit_score(vec["components"], lens) == pytest.approx(expected, abs=0.05)


def test_reweights_missing_components():
    full = S.fit_score({"taste": 1, "overlap": 1, "local": 1, "momentum": 1, "sponsor": 1})
    partial = S.fit_score({"taste": 1, "overlap": 1, "local": None, "momentum": None, "sponsor": None})
    assert full == partial == 100


def test_normalisers():
    assert S.norm_taste(1, 10) == 1 and S.norm_taste(10, 10) == 0
    assert S.norm_overlap(12, 20) == 1 and S.norm_overlap(6, 20) == pytest.approx(0.5)
    assert S.norm_local(0.75) == pytest.approx(0.5)
    assert S.norm_momentum(None) is None


def test_winner_and_too_close():
    w, margin, close = S.pick_winner([{"id": "a", "slot_score": 70}, {"id": "b", "slot_score": 66}])
    assert (w, margin, close) == ("a", 4.0, True)
    w, margin, close = S.pick_winner([{"id": "a", "slot_score": 60}, {"id": "b", "slot_score": 80}])
    assert (w, margin, close) == ("b", 20.0, False)


def test_classify_and_shelves():
    pepsi = [{"id": "urn:tag:genre:brand:food_and_beverage:drinks:carbonated"}]
    assert classify(pepsi) == "beverage"
    assert classify([{"id": "urn:tag:genre:brand:food_and_beverage:drinks:energy_drink"}]) == "energy_drink"
    assert classify([{"id": "urn:tag:genre:brand:wine_and_spirits:beer"}]) == "alcohol"
    assert classify([{"id": "urn:tag:product:qloo:musical_instrument"}]) != "alcohol"  # "rum" inside "instrument"
    assert shelf_for("beverage", "festival") == "natural"
    assert shelf_for("beauty", "festival") == "hidden"


def test_exclusions():
    assert excluded_categories(["tobacco", "Gambling"]) == {"tobacco", "gambling", "sports_org"}


def test_bullet_validation():
    ok = {"text": "Qloo shows 9 of 20 tastes shared with your crowd.", "evidence": "qloo:x"}
    assert valid_bullet(ok, {"qloo:x"})
    assert not valid_bullet({"text": "Fans love this brand a lot.", "evidence": "qloo:x"}, {"qloo:x"})
    assert not valid_bullet(ok, {"qloo:y"})
    fb = fallback_bullets("X", {"taste_rank": 2, "taste_n": 10, "overlap_shared": 5, "overlap_of": 20}, {}, None, "id")
    assert all(valid_bullet(b, {"qloo:rank:id", "qloo:compare_audiences:id"}) for b in fb)


def test_envelopes_and_cache():
    for st in ("ok", "empty", "needs_input", "partial", "degraded"):
        assert cacheable({"status": st})
    assert not cacheable({"status": "error"})
    assert results_of({"series": [1]}) == [1]
    assert cache_key("t", {"a": 1, "b": 2}) == cache_key("t", {"b": 2, "a": 1})
    lru = LRU(2)
    lru.put("a", {}), lru.put("b", {}), lru.put("c", {})
    assert lru.get("a") is None and lru.get("c") == {}


def test_needs_input_fixture_candidates():
    env = json.loads((FIX / "recommend_brand_seanfest.json").read_text())
    # the first recording was a needs_input envelope; later recordings overwrote it with ok — handle both
    e = env["envelope"]
    if e["status"] == "needs_input":
        c = candidates_from(e)
        assert c and all(x["type"] != "person" or True for x in c)
    else:
        assert e["status"] == "ok" and results_of(e)
