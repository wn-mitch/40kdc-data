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
            "filter": {"owner": "friendly", "level": "unit", "all_of": keywords},
            "count": {"min": 1, "max": 1},
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
        "filter": {
            "owner": "enemy",
            "level": "unit",
            "none_of": ["MONSTER", "VEHICLE"],
            "visible": {"to": "this-unit"},
        },
        "count": {"min": 1, "max": 1},
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
                            "keywords": [{"keyword_id": "ignores-cover"}],
                            "weapons": {"type": "ranged"},
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
        "selector": {
            "filter": {"owner": "enemy", "level": "unit"},
            "count": {"min": 1, "max": 1},
        },
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


def test_friendly_filter_requires_matching_keyword_evidence() -> None:
    effect = {
        "type": "roll-modifier",
        "target": {"owner": "friendly", "all_of": ["BLOOD LEGIONS"]},
        "modifier": {"roll": "hit", "operation": "add", "value": 1},
    }
    assert effect_to_buffs(effect, PROVIDED, SHOOTING)["applied"] == []
    keyed = {"phase": "shooting", "attackerKeywords": ["blood legions"]}
    assert len(effect_to_buffs(effect, PROVIDED, keyed)["applied"]) == 1
    unknown = effect_to_buffs(effect, PROVIDED, {"phase": "shooting"})
    assert unknown["applied"] == []
    assert [item["reason"] for item in unknown["unsupported"]] == [
        "unit-filter target: identity, state or model membership is unresolved"
    ]


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
                "weapons": {"name": "fabricated claws"},
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


def test_dice_pool_option_lever_ids_remain_label_based() -> None:
    result = effect_to_buffs(
        {
            "type": "dice-pool-allocation",
            "pool": {"count": 2, "die": "D6"},
            "max_activations": 1,
            "options": [
                {
                    "id": "alpha",
                    "name": "Display Alpha",
                    "requirement": {"count": 1},
                    "effect": {
                        "type": "stat-modifier",
                        "target": "this-unit",
                        "modifier": {"stat": "S", "operation": "add", "value": 1},
                    },
                },
                {
                    "id": "beta",
                    "name": "Display Beta",
                    "requirement": {"count": 1},
                    "effect": {
                        "type": "stat-modifier",
                        "target": "this-unit",
                        "modifier": {"stat": "A", "operation": "add", "value": 1},
                    },
                },
            ],
        },
        OWN,
        FIGHT,
    )
    assert {lever["id"] for lever in result["activatable"]} == {
        "fabricated#Display Alpha",
        "fabricated#Display Beta",
    }


# Weapon-keyword gates.

RAPID_FIRE = effect_to_buffs(
    {
        "type": "weapon-ability-grant",
        "target": "this-unit",
        "modifier": {
            "keywords": [{"keyword_id": "rapid-fire", "parameters": {"value": 1}}],
            "weapons": {
                "type": "ranged",
                "keyword": {"keyword_id": "lethal-hits"},
            },
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
    assert RAPID_FIRE["applicableWhen"] == {
        "phases": ["shooting"],
        "weaponKeywords": [{"keyword_id": "lethal-hits"}],
    }
    assert _granted([RAPID_FIRE], ["lethal-hits"]) == ["rapid-fire"]
    assert _granted([RAPID_FIRE], ["heavy"]) == []
    assert _granted([RAPID_FIRE, LETHAL], ["heavy"]) == ["rapid-fire", "lethal-hits"]


def test_weapon_keyword_gate_rejects_without_weapon_metadata() -> None:
    assert len(resolve_buffs([RAPID_FIRE], {"phase": "shooting"})["extraKeywords"]) == 0


def _rated_keyword_gate(target_keyword: str, threshold: int) -> dict[str, Any]:
    return {
        "source": OWN,
        "applicableWhen": {
            "weaponKeywords": [
                {
                    "keyword_id": "anti",
                    "parameters": {"target_keyword": target_keyword, "threshold": threshold},
                }
            ]
        },
        "contribution": {
            "type": "extra-keyword",
            "keywordRef": {"keyword_id": f"rated-{target_keyword.lower()}-{threshold}"},
        },
    }


def test_weapon_keyword_gate_preserves_ratings_and_target_keyword() -> None:
    infantry = _rated_keyword_gate("INFANTRY", 3)
    vehicle = _rated_keyword_gate("VEHICLE", 3)
    buffs = [infantry, vehicle]
    context = {
        "phase": "shooting",
        "weaponKeywordRefs": [
            {"keyword_id": "anti", "parameters": {"target_keyword": "INFANTRY", "threshold": 3}}
        ],
    }
    assert [
        item["keywordRef"]["keyword_id"]
        for item in resolve_buffs(buffs, context)["extraKeywords"]
    ] == ["rated-infantry-3"]


def test_weapon_keyword_gate_rejects_same_id_wrong_or_unknown_rating() -> None:
    buff = _rated_keyword_gate("INFANTRY", 3)
    wrong = {
        "phase": "shooting",
        "weaponKeywordRefs": [
            {"keyword_id": "anti", "parameters": {"target_keyword": "INFANTRY", "threshold": 4}}
        ],
    }
    unknown = {"phase": "shooting", "weaponKeywordRefs": [{"keyword_id": "anti"}]}
    assert resolve_buffs([buff], wrong)["extraKeywords"] == []
    assert resolve_buffs([buff], unknown)["extraKeywords"] == []


def test_weapon_keyword_gate_conjoins_nested_weapon_scopes() -> None:
    buff = _rated_keyword_gate("INFANTRY", 3)
    buff["applicableWhen"]["weaponRequirements"] = [
        {"weaponKeywords": [{"keyword_id": "blast", "parameters": {"value": 1}}]}
    ]
    context = {
        "phase": "shooting",
        "weaponKeywordRefs": [
            {"keyword_id": "anti", "parameters": {"target_keyword": "INFANTRY", "threshold": 3}},
            {"keyword_id": "blast", "parameters": {"value": 1}},
        ],
    }
    assert len(resolve_buffs([buff], context)["extraKeywords"]) == 1
