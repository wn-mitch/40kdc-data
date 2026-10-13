"""Levers a unit gets from selections, other units' abilities, caps and weapon-keyword gates.

Mirrors ``tools/test/cruncher-provided-levers.test.ts``. Fabricated rules only; no GW rule prose.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.cruncher import effect_to_buffs, resolve_buffs

OWN = {"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
PROVIDED = {
    "kind": "ability",
    "abilityId": "fabricated",
    "abilityKind": "support",
    "sourceUnitId": "fabricated-lord",
}
FIGHT = {"phase": "fight", "attackerKeywords": ["infantry", "destroyer cult"]}
SHOOTING = {"phase": "shooting", "attackerKeywords": ["infantry"]}

NOT_THIS_UNIT = {
    "operator": "not",
    "operands": [{"type": "same-unit", "parameters": {"as": "ability-unit"}}],
}
WITHIN_9 = {
    "type": "within",
    "parameters": {"subject": "selected-unit", "of": "this-model", "range": {"inches": 9}},
}


def friendly_selection(keywords: list[str]) -> dict[str, Any]:
    return {
        "type": "select-units",
        "selector": {
            "owner": "friendly",
            "count": 1,
            "keywords": keywords,
            "eligibility": {"operator": "and", "operands": [NOT_THIS_UNIT, WITHIN_9]},
        },
        "effect": {
            "type": "re-roll",
            "target": "selected-unit",
            "modifier": {"roll": "wound", "subset": "ones"},
        },
    }


def reasons(result: dict[str, Any]) -> list[str]:
    return [item["reason"] for item in result["unsupported"]]


# Unit selections as levers.


def test_friendly_selection_another_unit_provides_is_one_lever_requiring_the_selection() -> None:
    result = effect_to_buffs(friendly_selection(["DESTROYER CULT"]), PROVIDED, FIGHT)
    assert result["applied"] == []
    assert result["unsupported"] == []
    assert len(result["activatable"]) == 1
    lever = result["activatable"][0]
    assert lever["id"] == "fabricated#selected"
    assert [b["contribution"] for b in lever["buffs"]] == [
        {"type": "reroll", "roll": "wound", "subset": "ones"}
    ]
    selection = {k: v for k, v in friendly_selection(["DESTROYER CULT"]).items() if k != "effect"}
    assert lever["requires"] == [selection]


def test_unit_holding_the_ability_gets_nothing_when_selection_excludes_its_own_unit() -> None:
    result = effect_to_buffs(friendly_selection(["DESTROYER CULT"]), OWN, FIGHT)
    assert result == {"applied": [], "unsupported": [], "activatable": []}


def test_unit_without_selector_keywords_gets_nothing_and_unknown_keywords_refuse() -> None:
    assert effect_to_buffs(friendly_selection(["NOBZ"]), PROVIDED, FIGHT)["activatable"] == []
    unknown = effect_to_buffs(friendly_selection(["DESTROYER CULT"]), PROVIDED, {"phase": "fight"})
    assert unknown["activatable"] == []
    assert reasons(unknown) == [
        "select-units: the crunched unit's keywords are unavailable for the selector"
    ]


def test_enemy_selection_incoming_grant_is_the_attackers_own_behind_its_roll() -> None:
    selector = {
        "owner": "enemy",
        "count": 1,
        "excluded_keywords": ["MONSTER", "VEHICLE"],
        "visibility_required": True,
    }
    roll = {"type": "dice-gated", "dice": "D6", "threshold": 2, "comparison": "gte"}
    effect = {
        "type": "select-units",
        "selector": selector,
        "effect": {
            **roll,
            "on_success": {
                "type": "sequence",
                "steps": [
                    {
                        "type": "designate",
                        "target": "selected-unit",
                        "modifier": {"tag": "fabricated"},
                    },
                    {
                        "type": "weapon-ability-grant",
                        "target": "selected-unit",
                        "modifier": {
                            "abilities": ["Ignores Cover"],
                            "weapon_type": "ranged",
                            "incoming": True,
                        },
                    },
                ],
            },
            "on_fail": None,
        },
    }
    result = effect_to_buffs(effect, PROVIDED, SHOOTING)
    assert len(result["activatable"]) == 1
    lever = result["activatable"][0]
    assert lever["requires"] == [{"type": "select-units", "selector": selector}, roll]
    assert lever["buffs"] == [
        {
            "source": PROVIDED,
            "contribution": {
                "type": "extra-keyword",
                "keywordRef": {"keyword_id": "ignores-cover"},
            },
            "applicableWhen": {
                "phases": ["shooting"],
                "excludedTargetKeywords": ["MONSTER", "VEHICLE"],
            },
        }
    ]
    infantry = resolve_buffs(lever["buffs"], {"phase": "shooting", "targetKeywords": ["infantry"]})
    vehicle = resolve_buffs(lever["buffs"], {"phase": "shooting", "targetKeywords": ["vehicle"]})
    assert len(infantry["extraKeywords"]) == 1
    assert len(vehicle["extraKeywords"]) == 0
    # The enemy unit is never the attacked unit's own side: nothing under the target perspective.
    assert effect_to_buffs(effect, PROVIDED, SHOOTING, "target")["activatable"] == []


def test_enemy_selection_behind_a_roll_with_a_failure_branch_is_refused() -> None:
    effect = {
        "type": "select-units",
        "selector": {"owner": "enemy", "count": 1},
        "effect": {
            "type": "dice-gated",
            "dice": "D6",
            "threshold": 4,
            "comparison": "gte",
            "on_success": {
                "type": "stat-modifier",
                "target": "selected-unit",
                "modifier": {"stat": "T", "operation": "worsen", "value": 1},
            },
            "on_fail": {"type": "mortal-wounds", "target": "this-unit", "modifier": {"count": 1}},
        },
    }
    result = effect_to_buffs(effect, OWN, SHOOTING)
    assert result["activatable"] == []
    assert reasons(result) == [
        "select-units: a dice gate with a failure branch is not a single lever"
    ]


# Abilities another unit provides.


def test_provider_own_unit_effects_never_apply_to_the_crunched_unit() -> None:
    effect = {
        "type": "sequence",
        "steps": [
            {
                "type": "stat-modifier",
                "target": "this-unit",
                "modifier": {"stat": "A", "operation": "add", "value": 1},
            },
            {
                "type": "roll-modifier",
                "target": {"owner": "friendly", "all_of": ["INFANTRY"]},
                "modifier": {"roll": "hit", "operation": "add", "value": 1},
            },
        ],
    }
    own = effect_to_buffs(effect, OWN, SHOOTING)["applied"]
    provided = effect_to_buffs(effect, PROVIDED, SHOOTING)["applied"]
    assert [b["contribution"]["type"] for b in own] == ["attacks-mod", "hit-mod"]
    assert [b["contribution"]["type"] for b in provided] == ["hit-mod"]


def test_friendly_filter_applies_only_with_its_keywords_and_is_permissive_without() -> None:
    effect = {
        "type": "roll-modifier",
        "target": {"owner": "friendly", "all_of": ["BLOOD LEGIONS"]},
        "modifier": {"roll": "hit", "operation": "add", "value": 1},
    }
    assert effect_to_buffs(effect, PROVIDED, SHOOTING)["applied"] == []
    keyed = {"phase": "shooting", "attackerKeywords": ["blood legions"]}
    assert len(effect_to_buffs(effect, PROVIDED, keyed)["applied"]) == 1
    assert len(effect_to_buffs(effect, PROVIDED, {"phase": "shooting"})["applied"]) == 1


# Capped and cap-raising levers.


def test_capped_scaling_is_a_lever_at_its_cap_and_uncapped_is_refused() -> None:
    scaling = {"per": 1, "of": "models-embarked-in-bearer", "max_value": 22}
    capped = effect_to_buffs(
        {
            "type": "stat-modifier",
            "target": "this-unit",
            "modifier": {
                "stat": "A",
                "operation": "improve",
                "value": 2,
                "weapon_name": "fabricated claws",
            },
            "scaling": scaling,
        },
        OWN,
        FIGHT,
    )
    assert capped["applied"] == []
    assert len(capped["activatable"]) == 1
    assert capped["activatable"][0]["requires"] == [scaling]
    assert [
        (b["contribution"], b.get("applicableWhen")) for b in capped["activatable"][0]["buffs"]
    ] == [({"type": "attacks-mod", "value": 22}, {"weaponName": "fabricated claws"})]
    uncapped = {k: v for k, v in scaling.items() if k != "max_value"}
    refused = effect_to_buffs(
        {
            "type": "stat-modifier",
            "target": "this-unit",
            "modifier": {"stat": "A", "operation": "improve", "value": 2},
            "scaling": uncapped,
        },
        OWN,
        FIGHT,
    )
    assert refused["activatable"] == []
    assert reasons(refused) == [
        "stat-modifier: the value scales with models-embarked-in-bearer; "
        "not resolved by the buff engine"
    ]


def test_added_selection_to_own_ability_is_a_cap_raise_with_no_buffs() -> None:
    def modifier(aspect: str) -> dict[str, Any]:
        return {
            "type": "ability-modifier",
            "target": "this-unit",
            "modifier": {
                "ability": "fabricated-augments",
                "aspect": aspect,
                "operation": "add",
                "value": 1,
            },
        }

    result = effect_to_buffs(modifier("selections"), OWN, SHOOTING)
    assert result["unsupported"] == []
    assert result["activatable"] == [
        {
            "id": "fabricated#cap",
            "label": "One more fabricated-augments selection",
            "buffs": [],
            "capRaise": {"ability": "fabricated-augments", "by": 1},
        }
    ]
    assert effect_to_buffs(modifier("uses"), OWN, SHOOTING)["activatable"] == []


# Weapon-keyword gates.

RAPID_FIRE = effect_to_buffs(
    {
        "type": "weapon-ability-grant",
        "target": "this-unit",
        "modifier": {
            "abilities": ["Rapid Fire 1"],
            "weapon_type": "ranged",
            "weapon_keyword": "Lethal Hits",
        },
    },
    OWN,
    SHOOTING,
)["applied"][0]
LETHAL = {
    "source": OWN,
    "contribution": {"type": "extra-keyword", "keywordRef": {"keyword_id": "lethal-hits"}},
}


def _granted(buffs: list[dict[str, Any]], printed: list[str]) -> list[str]:
    resolved = resolve_buffs(buffs, {"phase": "shooting", "weaponKeywords": printed})
    return [k["keywordRef"]["keyword_id"] for k in resolved["extraKeywords"]]


def test_weapon_keyword_gate_reads_printed_or_granted_keywords_and_no_other() -> None:
    assert RAPID_FIRE["applicableWhen"] == {"phases": ["shooting"], "weaponKeyword": "lethal-hits"}
    assert _granted([RAPID_FIRE], ["lethal-hits"]) == ["rapid-fire"]
    assert _granted([RAPID_FIRE], ["heavy"]) == []
    assert _granted([RAPID_FIRE, LETHAL], ["heavy"]) == ["rapid-fire", "lethal-hits"]


def test_weapon_keyword_gate_is_permissive_without_the_weapons_keywords() -> None:
    assert len(resolve_buffs([RAPID_FIRE], {"phase": "shooting"})["extraKeywords"]) == 1
