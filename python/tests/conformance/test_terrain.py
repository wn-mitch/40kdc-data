"""Terrain resolver + keystone measurements against their conformance corpora.

Vertices and distances compare within ±5e-4; piece/measurement emission order
and id/name/piece_type/floor fields are exact.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.terrain import BOARD_INCHES, keystone_measurements, resolve_layout

from ..conftest import load_corpus_json

TOLERANCE = 5e-4


def _resolver_cases() -> list[dict[str, Any]]:
    return load_corpus_json("terrain-resolver", "cases.json")


def _keystone_cases() -> list[dict[str, Any]]:
    return load_corpus_json("terrain-keystones", "cases.json")


@pytest.mark.parametrize("case", _resolver_cases(), ids=lambda c: c["name"])
def test_terrain_resolver(case: dict[str, Any]) -> None:
    pieces = resolve_layout(case["layout"], case["templates"])
    expected = case["expected"]["pieces"]
    assert len(pieces) == len(expected)
    for actual, exp in zip(pieces, expected, strict=True):
        for field in ("id", "name", "piece_type", "floor"):
            assert actual[field] == exp[field], f"{case['name']} {field}"
        assert len(actual["vertices"]) == len(exp["vertices"])
        for av, ev in zip(actual["vertices"], exp["vertices"], strict=True):
            assert av["x"] == pytest.approx(ev["x"], abs=TOLERANCE)
            assert av["y"] == pytest.approx(ev["y"], abs=TOLERANCE)


@pytest.mark.parametrize("case", _keystone_cases(), ids=lambda c: c["name"])
def test_terrain_keystones(case: dict[str, Any]) -> None:
    board = case.get("board") or BOARD_INCHES
    measurements = keystone_measurements(case["layout"], case["templates"], board)
    expected = case["expected"]["measurements"]
    assert len(measurements) == len(expected)
    for actual, exp in zip(measurements, expected, strict=True):
        for field in ("piece_index", "piece_id", "edge", "ref"):
            assert actual[field] == exp[field], f"{case['name']} {field}"
        assert actual["distance"] == pytest.approx(exp["distance"], abs=TOLERANCE)
