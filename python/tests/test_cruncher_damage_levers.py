"""Cruncher damage levers: the gates the goldens do not project, and the DSL → engine path.

Mirrors ``tools/test/cruncher-damage-levers.test.ts``. Fabricated rules only; no GW rule prose.
The goldens in ``conformance/`` pin the contributions; these pin the applicability gates and the
end-to-end effect of a translated lever on the engine.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.cruncher import crunch, effect_to_buffs

SOURCE = {"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
SHOOTING = {"phase": "shooting"}


def _stages(
    dataset: Any, buffs: list[dict[str, Any]], context: dict[str, Any] = SHOOTING
) -> dict[str, float]:
    bolt_rifle = dataset.weapons.get_any("bolt-rifle").raw
    intercessors = dataset.units.get_any("intercessor-squad").raw
    out = crunch(
        {
            "attacker": {"weapon": bolt_rifle, "profileIndex": 0},
            "target": {"unit": intercessors, "profileIndex": 0},
            "modelsFiring": 5,
            "buffs": buffs,
            "context": context,
        },
        dataset,
    )
    return {stage["name"]: stage["expected"] for stage in out["stages"]}


def test_attacker_skill_penalties_gate_on_the_matching_phase() -> None:
    applied = effect_to_buffs(
        {
            "type": "sequence",
            "steps": [
                {
                    "type": "stat-modifier",
                    "target": "attacker",
                    "modifier": {"stat": "WS", "operation": "worsen", "value": 1},
                },
                {
                    "type": "stat-modifier",
                    "target": "attacker",
                    "modifier": {"stat": "BS", "operation": "worsen", "value": 1},
                },
            ],
        },
        SOURCE,
        SHOOTING,
        "target",
    )["applied"]
    assert [buff.get("applicableWhen") for buff in applied] == [
        {"phases": ["fight"]},
        {"phases": ["shooting"]},
    ]


def test_crit_threshold_and_reroll_gate_by_weapon_type_and_name() -> None:
    applied = effect_to_buffs(
        {
            "type": "sequence",
            "steps": [
                {
                    "type": "roll-result",
                    "target": "this-unit",
                    "modifier": {"roll": "wound", "critical_on": 5, "weapon_type": "melee"},
                },
                {
                    "type": "re-roll",
                    "target": "this-unit",
                    "modifier": {"roll": "hit", "subset": "ones", "weapon_name": "Fabricated Gun"},
                },
            ],
        },
        SOURCE,
        SHOOTING,
    )["applied"]
    assert [buff.get("applicableWhen") for buff in applied] == [
        {"phases": ["fight"]},
        {"weaponName": "fabricated gun"},
    ]


def test_phase_and_weapon_name_gates_both_survive() -> None:
    applied = effect_to_buffs(
        {
            "type": "stat-modifier",
            "target": "this-unit",
            "modifier": {
                "stat": "A",
                "operation": "improve",
                "value": 1,
                "weapon_type": "melee",
                "weapon_name": "Fabricated Blade",
            },
        },
        SOURCE,
        SHOOTING,
    )["applied"]
    assert [buff.get("applicableWhen") for buff in applied] == [
        {"phases": ["fight"], "weaponName": "fabricated blade"}
    ]


def test_crit_threshold_narrowed_by_weapon_keyword_gates_and_unreadable_one_is_refused() -> None:
    def crit(keyword: Any) -> dict[str, Any]:
        return effect_to_buffs(
            {
                "type": "roll-result",
                "target": "this-unit",
                "modifier": {"roll": "hit", "critical_on": 5, "weapon_keyword": keyword},
            },
            SOURCE,
            SHOOTING,
        )

    gated = crit("Pistol")
    assert gated["unsupported"] == []
    assert [buff.get("applicableWhen") for buff in gated["applied"]] == [
        {"weaponKeyword": "pistol"}
    ]
    unreadable = crit("")
    assert unreadable["applied"] == []
    assert [item["reason"] for item in unreadable["unsupported"]] == [
        'roll-result: narrows by "weapon_keyword" which the cruncher can\'t resolve here'
    ]


def test_skill_improvement_or_set_save_without_numeric_value_is_refused() -> None:
    skill = effect_to_buffs(
        {
            "type": "stat-modifier",
            "target": "this-unit",
            "modifier": {"stat": "BS", "operation": "improve", "value": None},
        },
        SOURCE,
        SHOOTING,
    )
    save = effect_to_buffs(
        {
            "type": "stat-modifier",
            "target": "this-unit",
            "modifier": {"stat": "Sv", "operation": "set", "value": None},
        },
        SOURCE,
        SHOOTING,
        "target",
    )
    assert skill["applied"] == []
    assert [item["reason"] for item in skill["unsupported"]] == [
        'stat-modifier BS: operation "improve" not supported'
    ]
    assert save["applied"] == []
    assert [item["reason"] for item in save["unsupported"]] == [
        "stat-modifier Sv: set has no numeric value"
    ]
    out_of_range = effect_to_buffs(
        {
            "type": "stat-modifier",
            "target": "this-unit",
            "modifier": {"stat": "Sv", "operation": "set", "value": 7},
        },
        SOURCE,
        SHOOTING,
        "target",
    )
    assert [item["reason"] for item in out_of_range["unsupported"]] == [
        'stat-modifier Sv: set value "7" is not a save characteristic'
    ]


def test_crit_hit_threshold_five_with_lethal_hits_raises_wounds(dataset: Any) -> None:
    lethal = {
        "source": {"kind": "manual", "label": "lethal"},
        "contribution": {"type": "extra-keyword", "keywordRef": {"keyword_id": "lethal-hits"}},
    }
    crit = effect_to_buffs(
        {
            "type": "roll-result",
            "target": "this-unit",
            "modifier": {"roll": "hit", "critical_on": 5},
        },
        SOURCE,
        SHOOTING,
    )["applied"]
    # Crits on a 6 auto-wound; the other hits (3+ to 5) wound on a 5+ against T5.
    assert _stages(dataset, [lethal])["wounds"] == pytest.approx(
        10 * (1 / 6) + 10 * (3 / 6) * (1 / 3), abs=1e-6
    )
    assert _stages(dataset, [lethal, *crit])["wounds"] == pytest.approx(
        10 * (2 / 6) + 10 * (2 / 6) * (1 / 3), abs=1e-6
    )


def test_weapon_named_attacks_lift_reaches_only_that_weapon(dataset: Any) -> None:
    def lift(name: str) -> list[dict[str, Any]]:
        return effect_to_buffs(
            {
                "type": "stat-modifier",
                "target": "this-unit",
                "modifier": {"stat": "A", "operation": "improve", "value": 1, "weapon_name": name},
            },
            SOURCE,
            SHOOTING,
        )["applied"]

    assert _stages(dataset, lift("Bolt Rifles"))["attacks"] == 15
    assert _stages(dataset, lift("Fabricated Gun"))["attacks"] == 10


def test_printed_grant_to_friendly_units_translates_its_body_for_the_holders() -> None:
    body = {"type": "re-roll", "target": "this-unit", "modifier": {"roll": "hit", "subset": "ones"}}

    def grant(target: Any) -> dict[str, Any]:
        return {
            "type": "ability-grant",
            "target": target,
            "modifier": {"ability": "fabricated-granted", "definition": body},
        }

    friendly = effect_to_buffs(
        grant({"owner": "friendly", "all_of": ["EXAMPLE"]}), SOURCE, SHOOTING
    )
    assert [b["contribution"] for b in friendly["applied"]] == [
        {"type": "reroll", "roll": "hit", "subset": "ones"}
    ]
    assert friendly["unsupported"] == []
    # Holders bound to an event are not resolved; enemy holders contribute nothing.
    bound = effect_to_buffs(grant("event-subject"), SOURCE, SHOOTING)
    assert bound["applied"] == []
    assert [item["reason"] for item in bound["unsupported"]] == [
        "ability-grant: the units holding the granted ability are not resolved"
    ]
    enemy = effect_to_buffs(grant({"owner": "enemy", "all_of": ["EXAMPLE"]}), SOURCE, SHOOTING)
    assert enemy["applied"] == [] and enemy["unsupported"] == []
