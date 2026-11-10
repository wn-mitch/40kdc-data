"""Default units and wargear legality against the mfm_loadout corpus.

Driven through the runner's ``default_mfm_loadout`` and ``check_mfm_loadout``
ops and compared exactly. Ties out with the TS reference and the Rust/Go ports
via ``conformance/mfm_loadout/{defaults,checks}.json``.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.runner import create_runner_state, dispatch

from ..conftest import load_corpus_json

_FILES = [("defaults.json", "default_mfm_loadout"), ("checks.json", "check_mfm_loadout")]


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
