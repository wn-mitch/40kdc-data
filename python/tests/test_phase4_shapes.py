"""Phase-4 DSL shapes: describer and cruncher parity with the TypeScript reference.

``fixtures/phase4_shapes.json`` records every describer / cruncher call made by
``tools/test/translate-phase4-shapes.test.ts`` plus extra cases covering each new shape
and its fallbacks, with the TS output of each call. Each record replays here and must
match byte-for-byte (describers) or structurally (cruncher translations).

Regenerate after a TS describer or cruncher change with
``python3 python/tests/fixtures/phase4_shapes_gen/make_recorder.py`` (see its docstring).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from wh40kdc.cruncher.from_dsl import effect_to_buffs
from wh40kdc.data.entities import usage_gated
from wh40kdc.translate import describe_ability, describe_condition
from wh40kdc.translate.trigger import describe_trigger

_RECORDS: list[dict[str, Any]] = json.loads(
    (Path(__file__).parent / "fixtures" / "phase4_shapes.json").read_text()
)


def _replay(fn: str, args: list[Any]) -> Any:
    if fn == "describeAbility":
        return describe_ability(args[0])
    if fn == "describeCondition":
        return describe_condition(args[0])
    if fn == "describeTrigger":
        return describe_trigger(args[0])
    if fn == "effectToBuffs":
        return effect_to_buffs(args[0], args[1], args[2], *args[3:])
    if fn == "usageGated":
        return usage_gated(*args)
    raise AssertionError(f"unknown recorded function {fn}")


def _json(v: Any) -> Any:
    """Normalize through JSON so tuples, ints-vs-floats and key order compare like TS."""
    return json.loads(json.dumps(v))


@pytest.mark.parametrize(
    "record",
    _RECORDS,
    ids=[f"{i}-{r['fn']}" for i, r in enumerate(_RECORDS)],
)
def test_matches_ts_reference(record: dict[str, Any]) -> None:
    out = _replay(record["fn"], record["args"])
    assert _json(out) == record["out"]


def test_fixture_covers_every_new_leaf_and_container() -> None:
    """The fixture must keep exercising each phase-4 shape; a regenerated fixture that
    dropped one would silently stop pinning it."""
    seen: set[str] = set()

    def walk(v: Any) -> None:
        if isinstance(v, dict):
            if isinstance(v.get("type"), str):
                seen.add(v["type"])
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk([r["args"] for r in _RECORDS])
    for shape in (
        "roll",
        "select-objective",
        "test-exemption",
        "datasheet-swap",
        "characteristic-resolution",
        "borrow-weapons",
        "select-weapon",
        "battle-size",
        "army-faction",
        "moved-over",
        "guided",
    ):
        assert shape in seen, shape
