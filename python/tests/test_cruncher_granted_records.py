"""Unit tests for granted-record resolution (mirrors
``tools/test/cruncher-granted-records.test.ts``)."""

from __future__ import annotations

from typing import Any

from wh40kdc.cruncher import effect_to_buffs, resolve_granted_records

_SOURCE = {"kind": "ability", "abilityId": "fabricated-banner", "abilityKind": "unit"}
_CONTEXT = {"phase": "shooting", "attackerStationary": False}
_ARMY_RULE: dict[str, Any] = {
    "effect": {
        "type": "conditional",
        "condition": {"type": "army-faction", "parameters": {"faction": "example"}},
        "effect": {
            "type": "roll-modifier",
            "target": "this-unit",
            "modifier": {"roll": "hit", "operation": "add", "value": 1},
        },
    },
    "trigger": {"event": "selected", "filter": {"to": "shoot"}},
    "usage": {"frequency": "once-per-turn", "per": "unit"},
}
_RECORDS = {"fabricated-army-rule": _ARMY_RULE}


def _grant(target: Any, ability: str, **extra: Any) -> dict[str, Any]:
    return {"type": "ability-grant", "target": target, "modifier": {"ability": ability, **extra}}


_AURA = {
    "type": "aura",
    "target": "friendly-within-aura",
    "modifier": {
        "range": {"inches": 6},
        "eligible": {"owner": "friendly", "all_of": ["EXAMPLE"]},
        "effect": _grant("recipient", "fabricated-army-rule"),
    },
}


def test_prints_a_granted_record_as_an_ability_part() -> None:
    resolved = resolve_granted_records(_AURA, _RECORDS.get)
    assert resolved["modifier"]["effect"]["modifier"] == {
        "ability": "fabricated-army-rule",
        "definition": {
            "type": "ability-part",
            "effect": _ARMY_RULE["effect"],
            "trigger": _ARMY_RULE["trigger"],
            "usage": _ARMY_RULE["usage"],
        },
    }
    assert resolved["modifier"]["range"] is _AURA["modifier"]["range"]


def test_leaves_printed_grants_bundles_core_abilities_and_itself_alone() -> None:
    def lookup(ability: str) -> dict[str, Any] | None:
        return None if ability == "stealth" else _ARMY_RULE

    printed = _grant(
        "this-unit",
        "fabricated-army-rule",
        definition={"type": "ability-part", "effect": {"type": "sequence", "steps": []}},
    )
    for node in (
        printed,
        _grant("this-unit", "x", rules_bundle=True),
        _grant("this-unit", "stealth"),
    ):
        assert resolve_granted_records(node, lookup) is node
    own = _grant("this-unit", "fabricated-banner")
    assert resolve_granted_records(own, lookup, {"fabricated-banner"}) is own


def test_declared_army_turns_the_granted_rule_into_the_holders_lever() -> None:
    raw = effect_to_buffs(_AURA, _SOURCE, _CONTEXT)
    assert [u["reason"] for u in raw["unsupported"]] == [
        'effect type "ability-grant" is not modelled by the buff layer'
    ]
    resolved = resolve_granted_records(_AURA, _RECORDS.get)
    declared = effect_to_buffs(resolved, _SOURCE, {**_CONTEXT, "armyFaction": "example"})
    assert declared["unsupported"] == []
    levers = [[b["contribution"] for b in a["buffs"]] for a in declared["activatable"]]
    assert levers == [[{"type": "hit-mod", "value": 1}]]
