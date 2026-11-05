"""Describer wording for a condition on each unit an effect reaches (subject ``recipient``).

Pinned against the TS reference (``tools/test/translate-shapes.test.ts``). Hunts a recipient
condition read as "the unit" (this unit) and its effect as "all enemy units".
"""

from __future__ import annotations

from typing import Any

from wh40kdc.translate import describe_ability


def _render(effect: dict[str, Any]) -> str:
    return describe_ability({"effect": effect, "scope": {"duration": "permanent"}})


def _within(of: str) -> dict[str, Any]:
    return {
        "type": "matches",
        "parameters": {
            "subject": "recipient",
            "filter": {"within": {"of": of, "range": {"inches": 3}}},
        },
    }


def _oc(target: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "stat-modifier",
        "target": target,
        "modifier": {"stat": "OC", "operation": "worsen", "value": 1},
    }


def test_names_the_unit_with_the_effects_filter_and_refers_back_to_it_as_that_unit() -> None:
    e = {
        "type": "conditional",
        "condition": _within("this-unit"),
        "effect": _oc({"owner": "enemy"}),
    }
    assert _render(e) == (
        'While an enemy unit is within 3" of the unit, '
        "worsen that unit's Objective Control characteristic by 1."
    )


def test_says_model_for_a_model_level_filter_and_keeps_later_mentions_as_that_model() -> None:
    shocked = {
        "type": "matches",
        "parameters": {"subject": "recipient", "filter": {"state": "battle-shocked"}},
    }
    both = {"operator": "and", "operands": [_within("this-unit"), shocked]}
    e = {
        "type": "conditional",
        "condition": both,
        "effect": _oc({"owner": "enemy", "level": "model"}),
    }
    assert _render(e) == (
        'While an enemy model is within 3" of the unit, while that model is Battle-shocked, '
        "worsen that model's Objective Control characteristic by 1."
    )


def test_reads_the_same_inside_a_sequence() -> None:
    gated = {
        "type": "conditional",
        "condition": _within("this-unit"),
        "effect": _oc({"owner": "enemy", "all_of": ["VEHICLE"]}),
    }
    improve = {
        "type": "stat-modifier",
        "target": "this-unit",
        "modifier": {"stat": "OC", "operation": "improve", "value": 1},
    }
    assert (
        'While an enemy VEHICLE unit is within 3" of the unit, '
        "worsen that unit's Objective Control characteristic by 1."
    ) in _render({"type": "sequence", "steps": [gated, improve]})


def test_leaves_a_condition_on_the_abilitys_own_unit_as_it_was() -> None:
    own = {
        "type": "matches",
        "parameters": {
            "subject": "this-unit",
            "filter": {"within": {"of": "this-model", "range": {"inches": 3}}},
        },
    }
    e = {"type": "conditional", "condition": own, "effect": _oc({"owner": "enemy"})}
    assert _render(e) == (
        'While the unit is within 3" of this model, '
        "worsen all enemy units' Objective Control characteristic by 1."
    )
