"""Declared answers for undecided leaf conditions (``conditionFacts``) and the needs that name them.

Mirrors ``tools/test/condition-facts.test.ts`` plus the activation-diagnostic case of
``tools/test/cruncher-provided-levers.test.ts``.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from wh40kdc.cruncher import (
    canonical_json,
    condition_fact_key,
    condition_needs,
    effect_to_buffs,
)
from wh40kdc.cruncher.from_dsl import moment_gate

# Executioner: +1 to hit with ranged attacks against a unit that is not below Half-strength.
EXECUTIONER = "executioner-adeptus-astartes"


@pytest.fixture(scope="module")
def executioner(dataset: Any) -> Any:
    ability = dataset.abilities.get_in_faction(EXECUTIONER, "adeptus-astartes")
    assert ability is not None
    return ability


def _source(ability: Any) -> dict[str, Any]:
    return {"kind": "ability", "abilityId": ability.id, "abilityKind": "unit"}


def _needs(executioner: Any) -> list[dict[str, Any]]:
    unset = executioner.describe_buffs(_source(executioner), {"phase": "shooting"}, "attacker")
    assert unset["applied"] == []
    return [need for item in unset["unsupported"] for need in item.get("needs") or []]


def test_canonical_json_sorts_keys_at_every_depth() -> None:
    a = canonical_json({"b": 1, "a": {"d": [1, "x"], "c": None}})
    assert a == canonical_json({"a": {"c": None, "d": [1, "x"]}, "b": 1})
    assert a == '{"a":{"c":null,"d":[1,"x"]},"b":1}'


def test_canonical_json_matches_js_text() -> None:
    assert canonical_json({"name": "Nurgle’s Gift"}) == '{"name":"Nurgle’s Gift"}'
    # Integral floats print without ".0"; exponents and small numbers as JS prints them.
    assert canonical_json([1.0, 2.5, 1e21, 1e-7, 0.000001, -0.0]) == "[1,2.5,1e+21,1e-7,0.000001,0]"
    # Keys sort by UTF-16 code unit: an astral key (surrogate 0xD83D) precedes U+FFFF.
    assert canonical_json({"￿": 1, "\U0001f600": 2}) == '{"\U0001f600":2,"￿":1}'
    assert canonical_json("\x01\ud800") == '"\\u0001\\ud800"'


def test_reports_only_the_undecided_leaf(executioner: Any) -> None:
    needs = _needs(executioner)
    assert len(needs) == 1
    assert needs[0]["condition"]["type"] == "strength"
    assert needs[0]["key"] == condition_fact_key(needs[0]["condition"], "attacker")


def test_decides_the_leaf_from_a_declared_answer(executioner: Any) -> None:
    key = _needs(executioner)[0]["key"]

    def declared(answer: bool) -> dict[str, Any]:
        ctx = {"phase": "shooting", "conditionFacts": {key: answer}}
        return executioner.describe_buffs(_source(executioner), ctx, "attacker")

    below, not_below = declared(True), declared(False)
    assert below["unsupported"] == []
    assert not_below["unsupported"] == []
    # Exactly one answer applies the +1: the leaf sits under a "not".
    assert len(below["applied"]) + len(not_below["applied"]) == 1


def test_context_facts_win_over_a_declared_answer(executioner: Any) -> None:
    key = _needs(executioner)[0]["key"]
    ctx = {"phase": "shooting", "targetStrength": "full", "conditionFacts": {key: True}}
    assert len(executioner.describe_buffs(_source(executioner), ctx, "attacker")["applied"]) == 1


def test_ignores_an_answer_declared_from_the_other_perspective(executioner: Any) -> None:
    need = _needs(executioner)[0]
    other = condition_fact_key(need["condition"], "target")
    assert other != need["key"]
    ctx = {"phase": "shooting", "conditionFacts": {other: True}}
    assert executioner.describe_buffs(_source(executioner), ctx, "attacker")["applied"] == []


def test_skips_an_operand_that_already_decides_an_and() -> None:
    leaf = {"type": "unit-state", "parameters": {"states": ["engaged"], "subject": "target"}}
    decided = condition_needs(
        {"operator": "and", "operands": [{"type": "x"}, leaf]},
        "attacker",
        lambda node: False if node.get("operator") or node.get("type") == "x" else "unknown",
    )
    assert decided == []
    opened = condition_needs(
        {"operator": "and", "operands": [{"type": "x"}, leaf, leaf]},
        "attacker",
        lambda node: True if node.get("type") == "x" else "unknown",
    )
    assert [need["condition"] for need in opened] == [leaf]


def test_stackable_buffs_for_returns_needs_tagged_with_the_ability(
    dataset: Any, executioner: Any
) -> None:
    key = _needs(executioner)[0]["key"]
    unit = next(
        u
        for u in dataset.units.all
        if any(
            (ref if isinstance(ref, str) else ref.get("id")) == executioner.id
            for ref in u.raw.get("ability_ids") or []
        )
    )
    result = dataset.stackable_buffs_for(
        {"unitId": unit.id, "factionId": unit.raw["faction_id"]}, {"phase": "shooting"}
    )
    assert any(n["abilityId"] == executioner.id and n["key"] == key for n in result["needs"])


def test_defensive_needs_for_returns_the_defending_units_leaves(dataset: Any) -> None:
    found = None
    for unit in dataset.units.all[:400]:
        inp = {"unitId": unit.id, "factionId": unit.raw["faction_id"]}
        needs = dataset.defensive_needs_for(inp, {"phase": "shooting"})
        if needs:
            found = (inp, needs[0])
            break
    assert found is not None
    inp, need = found
    assert need["perspective"] == "target"
    answered = dataset.defensive_needs_for(
        inp, {"phase": "shooting", "conditionFacts": {need["key"]: True}}
    )
    assert not any(
        n["key"] == need["key"] and n["abilityId"] == need["abilityId"] for n in answered
    )


def test_activation_diagnostic_names_the_leaf_not_the_moment_gate() -> None:
    own = {"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
    condition = {"type": "attachment", "parameters": {"subject": "this-model", "role": "leading"}}
    trigger = {"event": "battle-started", "condition": condition}
    effect = {
        "type": "stat-modifier",
        "target": "this-unit",
        "modifier": {"stat": "S", "operation": "add", "value": 1},
    }
    part = {
        "type": "ability-part",
        "name": "Example activation",
        "trigger": trigger,
        "effect": effect,
    }
    # No phase or battle state is known: the activation gate must report itself unevaluable.
    result = effect_to_buffs(
        {"type": "choice", "options": [moment_gate(trigger, effect, part)]}, own, {}
    )
    assert result["unsupported"] == [
        {
            "reason": "activation condition cannot be evaluated against current context",
            "effectFragment": part,
            "needs": [
                {
                    "key": condition_fact_key(condition, "attacker"),
                    "condition": condition,
                    "perspective": "attacker",
                }
            ],
        }
    ]
    assert "timing-is" not in json.dumps(result["unsupported"])
