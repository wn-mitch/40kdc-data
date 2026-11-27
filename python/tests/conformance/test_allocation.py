"""Discrete allocation against the allocation conformance corpus.

Values compare within ±5e-4; the distribution's length is exact.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from wh40kdc.cruncher import allocate, allocate_attached

from ..conftest import load_corpus_json
from .test_cruncher import _CRUNCHER_DIR, TOLERANCE, build_engine_input


def _cases() -> list[dict[str, Any]]:
    return load_corpus_json("allocation", "cases.json")


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"][:50])
def test_allocation_case(dataset: Any, case: dict[str, Any]) -> None:
    cruncher_case = json.loads((_CRUNCHER_DIR / case["cruncher_case"]).read_text(encoding="utf-8"))
    defences = {"zeroing": case["zeroing"]} if "zeroing" in case else None
    # A case's `buffs` are appended to the cruncher case's own.
    if "buffs" in case:
        cruncher_case = {**cruncher_case, "buffs": [*cruncher_case["buffs"], *case["buffs"]]}
    actual = allocate(build_engine_input(dataset, cruncher_case), dataset, defences)
    expected = case["expected"]
    for field in ("damageDealt", "modelsDestroyed"):
        assert actual[field] == pytest.approx(expected[field], abs=TOLERANCE), field
    distribution = actual["modelsDestroyedDistribution"]
    assert len(distribution) == len(expected["modelsDestroyedDistribution"])
    assert distribution == pytest.approx(expected["modelsDestroyedDistribution"], abs=TOLERANCE)


def _attached_cases() -> list[dict[str, Any]]:
    return load_corpus_json("allocation", "attached.json")


def _attached_input(dataset: Any, line: dict[str, Any], group: dict[str, Any]) -> dict[str, Any]:
    """One attack line crunched against one group: the line's buffs, then the group's."""
    return build_engine_input(
        dataset,
        {
            "attacker": line["attacker"],
            "modelsFiring": line["modelsFiring"],
            "target": {
                "unitId": group["unitId"],
                "profileIndex": group["profileIndex"],
                "modelCount": group["modelCount"],
            },
            "context": line["context"],
            "buffs": [*line["buffs"], *group["buffs"]],
        },
    )


def _assert_distribution(actual: list[float], expected: list[float], what: str) -> None:
    assert len(actual) == len(expected), what
    assert actual == pytest.approx(expected, abs=TOLERANCE), what


@pytest.mark.parametrize("case", _attached_cases(), ids=lambda c: c["name"][:50])
def test_allocation_attached_case(dataset: Any, case: dict[str, Any]) -> None:
    groups = case["groups"]
    lines = [[_attached_input(dataset, line, group) for group in groups] for line in case["lines"]]
    actual = allocate_attached(
        lines,
        [{"character": group["character"]} for group in groups],
        dataset,
    )
    expected = case["expected"]
    for field in ("damageDealt", "modelsDestroyed"):
        assert actual[field] == pytest.approx(expected[field], abs=TOLERANCE), field
    for field in ("modelsDestroyedDistribution", "woundsDealtDistribution"):
        _assert_distribution(actual[field], expected[field], field)  # type: ignore[literal-required]
    assert len(actual["groups"]) == len(expected["groups"])
    for g, (group, want) in enumerate(zip(actual["groups"], expected["groups"], strict=True)):
        _assert_distribution(
            group["modelsDestroyedDistribution"], want["modelsDestroyedDistribution"], f"group {g}"
        )
