"""describe_scoring_card against the scoring-translation corpus.

Exact ASCII string equality — clause order and phrasing are the contract.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.translate import describe_scoring_card

from ..conftest import load_corpus_json


def _cases() -> list[dict[str, Any]]:
    return load_corpus_json("scoring-translation", "cases.json")


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["cardId"])
def test_scoring_translation(dataset: Any, case: dict[str, Any]) -> None:
    card = dataset.mission_cards.get(case["cardId"])
    assert card is not None, f"unknown card {case['cardId']}"
    assert describe_scoring_card(card) == case["expected"]["awards"]
