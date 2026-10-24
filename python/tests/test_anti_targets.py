"""Structured Anti keyword references match target alternatives and ratings."""

from wh40kdc.cruncher.buffs import _keyword_ref_matches
from wh40kdc.cruncher.engine import _anti_target_matches


def test_structured_anti_target_matches_slash_and_negation() -> None:
    slash = {
        "keyword_id": "anti",
        "parameters": {"target_keyword": "Monster/Vehicle", "threshold": 4},
    }
    negated = {
        "keyword_id": "anti",
        "parameters": {"target_keyword": "Non-Vehicle", "threshold": 4},
    }
    assert _keyword_ref_matches(slash, slash)
    assert _keyword_ref_matches(negated, negated)
    target = slash["parameters"]["target_keyword"]
    negated_target = negated["parameters"]["target_keyword"]
    assert _anti_target_matches(target, ["vehicle", "walker"])
    assert not _anti_target_matches(target, ["infantry", "chaos"])
    assert not _anti_target_matches(negated_target, ["vehicle", "walker"])
    assert _anti_target_matches(negated_target, ["infantry", "chaos"])


def test_structured_anti_target_rejects_empty_alternative() -> None:
    ref = {
        "keyword_id": "anti",
        "parameters": {"target_keyword": "Monster/", "threshold": 4},
    }
    assert not _anti_target_matches(ref["parameters"]["target_keyword"], ["infantry"])


def test_structured_anti_target_threshold_and_rating_are_exact() -> None:
    expected = {
        "keyword_id": "anti",
        "parameters": {"target_keyword": "INFANTRY", "threshold": 4},
    }
    assert _keyword_ref_matches(
        {"keyword_id": "anti", "parameters": {"target_keyword": "infantry", "threshold": 4}},
        expected,
    )
    assert not _keyword_ref_matches(
        {"keyword_id": "anti", "parameters": {"target_keyword": "infantry", "threshold": 3}},
        expected,
    )
    assert not _keyword_ref_matches(
        {"keyword_id": "anti", "parameters": {"target_keyword": "infantry"}},
        expected,
    )
