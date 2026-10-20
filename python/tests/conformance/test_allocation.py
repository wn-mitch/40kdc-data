"""Discrete allocation against the allocation conformance corpus.

Values compare within ±5e-4; the distribution's length is exact.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from wh40kdc.cruncher import allocate

from ..conftest import load_corpus_json
from .test_cruncher import _CRUNCHER_DIR, TOLERANCE, build_engine_input


def _cases() -> list[dict[str, Any]]:
    return load_corpus_json("allocation", "cases.json")


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"][:50])
def test_allocation_case(dataset: Any, case: dict[str, Any]) -> None:
    cruncher_case = json.loads((_CRUNCHER_DIR / case["cruncher_case"]).read_text(encoding="utf-8"))
    actual = allocate(build_engine_input(dataset, cruncher_case), dataset)
    expected = case["expected"]
    for field in ("damageDealt", "modelsDestroyed"):
        assert actual[field] == pytest.approx(expected[field], abs=TOLERANCE), field
    distribution = actual["modelsDestroyedDistribution"]
    assert len(distribution) == len(expected["modelsDestroyedDistribution"])
    assert distribution == pytest.approx(expected["modelsDestroyedDistribution"], abs=TOLERANCE)
