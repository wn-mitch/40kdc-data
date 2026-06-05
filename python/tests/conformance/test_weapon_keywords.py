"""Weapon-keyword catalog against the weapon-keywords conformance corpus.

Pins the keyword id → catalog effect mapping (null effect = engine-dispatch
keyword) so all implementations read the same catalog semantics.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.cruncher import ENGINE_DISPATCH_KEYWORDS

from ..conftest import load_corpus_json


def _cases() -> list[dict[str, Any]]:
    return load_corpus_json("weapon-keywords", "cases.json")


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["keyword_id"])
def test_weapon_keyword_effect(dataset: Any, case: dict[str, Any]) -> None:
    view = dataset.weapon_keywords.get(case["keyword_id"])
    assert view is not None, f"keyword {case['keyword_id']} not in catalog"
    assert view.raw.get("effect") == case["expected_effect"]
    if case["expected_effect"] is None:
        # Null-effect keywords must be engine-dispatched.
        assert case["keyword_id"] in ENGINE_DISPATCH_KEYWORDS
