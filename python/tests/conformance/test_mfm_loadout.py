"""MFM loadouts against the mfm_loadout corpus.

Driven through the runner's ``default_mfm_loadout``, ``check_mfm_loadout``,
``mfm_unit``, ``mfm_assignment`` and ``check_mfm_unit`` ops and compared
exactly. Ties out with the TS reference and the Rust/Go ports via
``conformance/mfm_loadout/*.json``.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.runner import create_runner_state, dispatch

from ..conftest import load_corpus_json

_FILES = [
    ("defaults.json", "default_mfm_loadout"),
    ("checks.json", "check_mfm_loadout"),
    ("units.json", "mfm_unit"),
    ("assignments.json", "mfm_assignment"),
    ("unit-checks.json", "check_mfm_unit"),
]


@pytest.fixture(scope="module")
def runner_state(dataset: Any) -> Any:
    state = create_runner_state()
    state._dataset = dataset
    state.initialized = True
    return state


@pytest.mark.parametrize(("filename", "op"), _FILES)
def test_mfm_loadout_corpus(runner_state: Any, filename: str, op: str) -> None:
    cases: list[dict[str, Any]] = load_corpus_json("mfm_loadout", filename)
    assert cases, f"no mfm_loadout/{filename} cases"
    for case in cases:
        resp = dispatch(runner_state, {"op": op, "args": case["args"]})
        assert resp["ok"], f"{case['name']}: {op} errored: {resp}"
        assert resp["value"] == case["expected"], case["name"]


def test_check_rejects_a_non_integer_count(runner_state: Any) -> None:
    args = {"unitId": "deff-dread", "factionId": "orks", "models": {}, "counts": {"x": 1.5}}
    resp = dispatch(runner_state, {"op": "check_mfm_loadout", "args": args})
    assert resp["error_kind"] == "INVALID_INPUT"


@pytest.mark.parametrize("op", ["mfm_unit", "mfm_assignment", "check_mfm_unit"])
def test_unit_ops_reject_a_non_integer_model_count(runner_state: Any, op: str) -> None:
    args = {"unitId": "deff-dread", "factionId": "orks", "modelCount": 1.5, "counts": {}}
    resp = dispatch(runner_state, {"op": op, "args": args})
    assert resp["error_kind"] == "INVALID_INPUT"


def test_unit_ops_answer_a_search_too_large_with_internal_error(
    runner_state: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from wh40kdc.data import mfm_loadout_search

    monkeypatch.setattr(mfm_loadout_search, "MAX_SEARCH_BUNDLES", 0)
    for op in ("mfm_unit", "mfm_assignment"):
        args = {"unitId": "arco-flagellants", "factionId": "adepta-sororitas", "modelCount": 3}
        resp = dispatch(runner_state, {"op": op, "args": {**args, "counts": {}}})
        assert resp["error_kind"] == "INTERNAL_ERROR", op
        assert "more than" in resp["error_payload"]["detail"], op


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        ("Gun#2", (2, 4)),
        ("Gun#1", (1, 1)),
        ("Gun#3", None),
        ("Gun#02", (9, 9)),
        ("Gun# 2", None),
        ("Gun#2.0", None),
        ("Gun#0", None),
        ("Gun", (3, 5)),
        ("#1", None),
    ],
)
def test_row_range_reads_only_a_decimal_ordinal(row: str, expected: Any) -> None:
    from wh40kdc.data.mfm_loadout_unit import _row_range

    tier = [
        {"name": "Gun", "min": 1, "max": 1},
        {"name": "Gun", "min": 2, "max": 4},
        {"name": "Gun#02", "min": 9, "max": 9},
    ]
    # A suffix that is not a decimal ordinal is part of a plain name matched exactly.
    assert _row_range(tier, row) == expected


@pytest.mark.parametrize("composition", [None, {}, {"models": {}}])
def test_unit_ops_reject_a_composition_without_models(runner_state: Any, composition: Any) -> None:
    for op in ("mfm_unit", "mfm_assignment", "check_mfm_unit"):
        args = {"composition": composition, "modelCount": 1, "counts": {}}
        resp = dispatch(runner_state, {"op": op, "args": args})
        assert resp["error_kind"] == "INVALID_INPUT", op


def test_inline_composition_without_a_loadout_answers_null(runner_state: Any) -> None:
    args = {"composition": {"models": []}, "modelCount": 1, "counts": {}}
    for op in ("mfm_unit", "mfm_assignment", "check_mfm_unit"):
        resp = dispatch(runner_state, {"op": op, "args": args})
        assert resp == {"ok": True, "value": None}, op
