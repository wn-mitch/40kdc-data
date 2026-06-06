"""In-process and subprocess tests for the NDJSON conformance runner."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

import pytest

from wh40kdc._spec import SPEC_VERSION
from wh40kdc._version import __version__
from wh40kdc.runner import create_runner_state, dispatch, process_request

INIT = {
    "op": "init",
    "args": {"spec_version": SPEC_VERSION, "locale": "C", "tz": "UTC", "seed": 0},
}


def _initialized() -> Any:
    state = create_runner_state()
    assert dispatch(state, INIT)["ok"]
    return state


def test_init_handshake() -> None:
    state = create_runner_state()
    resp = dispatch(state, INIT)
    assert resp == {
        "ok": True,
        "value": {"impl": "py", "spec_version": SPEC_VERSION, "impl_version": __version__},
    }
    # init twice fails
    assert dispatch(state, INIT)["error_kind"] == "INVALID_INPUT"


def test_ops_require_init() -> None:
    state = create_runner_state()
    resp = dispatch(state, {"op": "normalize", "args": {"input": "x"}})
    assert resp["error_kind"] == "INVALID_INPUT"


def test_spec_version_mismatch_rejected() -> None:
    state = create_runner_state()
    resp = dispatch(
        state,
        {"op": "init", "args": {"spec_version": -1, "locale": "C", "tz": "UTC", "seed": 0}},
    )
    assert resp["error_kind"] == "INVALID_INPUT"


def test_unknown_op() -> None:
    state = _initialized()
    assert dispatch(state, {"op": "frobnicate"})["error_kind"] == "UNKNOWN_OP"


def test_normalize_op() -> None:
    state = _initialized()
    resp = dispatch(state, {"op": "normalize", "args": {"input": "Khârn the Betrayer"}})
    assert resp == {"ok": True, "value": "kharn the betrayer"}


def test_linked_query_unknown_entity() -> None:
    state = _initialized()
    resp = dispatch(
        state,
        {"op": "linked_query", "args": {"query": "abilities_of", "input": {"unitId": "nope"}}},
    )
    assert resp["error_kind"] == "UNKNOWN_ENTITY"


def test_translate_effect_op() -> None:
    state = _initialized()
    resp = dispatch(
        state,
        {
            "op": "translate_effect",
            "args": {
                "effect": {
                    "type": "feel-no-pain",
                    "target": "unit",
                    "modifier": {"threshold": 5},
                },
                "scope": {"range": "unit", "duration": "phase"},
            },
        },
    )
    assert resp["ok"]
    assert resp["value"]["text"] == "the unit has Feel No Pain 5+\nScope: unit. Duration: phase."


def test_export_unknown_format() -> None:
    state = _initialized()
    resp = dispatch(state, {"op": "export", "args": {"format": "nope", "roster": {}}})
    assert resp["error_kind"] == "INVALID_INPUT"


def test_shutdown_returns_null() -> None:
    state = _initialized()
    assert dispatch(state, {"op": "shutdown"}) == {"ok": True, "value": None}


def test_process_request_invalid_json() -> None:
    state = _initialized()
    out = process_request(state, "{nope")
    assert out is not None
    assert json.loads(out)["error_kind"] == "INVALID_INPUT"
    assert process_request(state, "   ") is None


@pytest.mark.parametrize("bad_line", ['"just a string"', "[1,2]", '{"op": 5}'])
def test_process_request_requires_string_op(bad_line: str) -> None:
    state = _initialized()
    out = process_request(state, bad_line)
    assert out is not None
    assert json.loads(out)["error_kind"] == "INVALID_INPUT"


def test_subprocess_round_trip() -> None:
    """End-to-end: `python -m wh40kdc.runner` speaks the NDJSON protocol."""
    requests = [
        INIT,
        {"op": "normalize", "args": {"input": "T'au"}},
        {"op": "wtc_result", "args": {"a": 100, "b": 49}},
        {"op": "shutdown"},
    ]
    stdin = "".join(json.dumps(r) + "\n" for r in requests)
    proc = subprocess.run(
        [sys.executable, "-m", "wh40kdc.runner"],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )
    lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    assert len(lines) == 4
    assert lines[0]["value"]["impl"] == "py"
    assert lines[1] == {"ok": True, "value": "tau"}
    assert lines[2] == {"ok": True, "value": {"a": 20, "b": 0}}  # diff 51 → top band
    assert lines[3] == {"ok": True, "value": None}
