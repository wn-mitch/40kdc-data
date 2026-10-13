"""``Dataset.stackable_buffs_for``: costs and cross-unit providers.

Mirrors ``tools/test/stackable-levers.test.ts``. A fabricated army (no GW rule prose): a mob, a
boss who can join it or stand apart, an epic hero, one detachment with a granting rule, two
Stratagems and an Enhancement.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.data import Dataset, empty_raw_data

VERSION = {"edition": "11th", "dataslate": "test"}
PROFILE = {"M": 6, "T": 5, "W": 1, "Sv": 5, "Ld": 7, "OC": 2}


def unit(id_: str, keywords: list[str], ability_ids: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": id_,
        "name": id_,
        "faction_id": "orks",
        "profiles": [{"name": id_, **PROFILE}],
        "keywords": keywords,
        "faction_keywords": ["Orks"],
        "model_count": {"min": 1, "max": 10},
        "ability_ids": ability_ids or [],
        "game_version": VERSION,
    }


def ability(id_: str, type_: str, effect: Any, **extra: Any) -> dict[str, Any]:
    return {
        "ability_id": id_,
        "name": extra.pop("name", id_),
        "authored_by": "40kdc-community",
        "faction_id": "orks",
        "game_version": VERSION,
        "ability_type": type_,
        "behavior": "passive",
        "effect": effect,
        "scope": {"duration": "permanent"},
        **extra,
    }


def hit_plus(target: Any) -> dict[str, Any]:
    return {
        "type": "roll-modifier",
        "target": target,
        "modifier": {"roll": "hit", "operation": "add", "value": 1},
    }


def grant(keyword: str) -> dict[str, Any]:
    return {
        "type": "weapon-ability-grant",
        "target": "this-unit",
        "modifier": {"abilities": [keyword]},
    }


def army_raw() -> Any:
    raw = empty_raw_data()
    raw["units"] = [
        unit("fix-mob", ["Infantry", "Mob"]),
        unit("fix-boss", ["Infantry", "Character"], ["fix-pick-a-mob", "fix-nob-aura"]),
        unit("fix-hero", ["Infantry", "Character", "Epic Hero"]),
    ]
    raw["abilities"] = [
        # The boss picks another MOB unit within 9": re-roll wound rolls of 1.
        ability(
            "fix-pick-a-mob",
            "unit",
            {
                "type": "select-units",
                "selector": {
                    "owner": "friendly",
                    "count": 1,
                    "keywords": ["MOB"],
                    "eligibility": {
                        "operator": "and",
                        "operands": [
                            {
                                "operator": "not",
                                "operands": [
                                    {"type": "same-unit", "parameters": {"as": "ability-unit"}}
                                ],
                            },
                            {
                                "type": "within",
                                "parameters": {
                                    "subject": "selected-unit",
                                    "of": "this-model",
                                    "range": {"inches": 9},
                                },
                            },
                        ],
                    },
                },
                "effect": {
                    "type": "re-roll",
                    "target": "selected-unit",
                    "modifier": {"roll": "wound", "subset": "ones"},
                },
            },
        ),
        # +1 hit for friendly NOBZ only, +1 attack for the boss's own unit only.
        ability(
            "fix-nob-aura",
            "unit",
            {
                "type": "sequence",
                "steps": [
                    hit_plus({"owner": "friendly", "all_of": ["NOBZ"]}),
                    {
                        "type": "stat-modifier",
                        "target": "this-unit",
                        "modifier": {"stat": "A", "operation": "add", "value": 1},
                    },
                ],
            },
        ),
        # The detachment grants friendly MOB units a record holding a one-of-two choice.
        ability(
            "fix-grant-rule",
            "detachment",
            {
                "type": "ability-grant",
                "target": {"owner": "friendly", "all_of": ["MOB"]},
                "modifier": {"ability": "fix-granted"},
            },
            detachment_id="fix-det",
        ),
        ability(
            "fix-granted",
            "unit",
            {"type": "choice", "options": [grant("Lethal Hits"), grant("Sustained Hits 1")]},
            name="Fix Granted",
        ),
        # A Stratagem whose only content is a choice, and one adding a selection to the record.
        ability(
            "fix-strat",
            "stratagem",
            {
                "type": "choice",
                "options": [
                    hit_plus("this-unit"),
                    {
                        "type": "roll-modifier",
                        "target": "this-unit",
                        "modifier": {"roll": "wound", "operation": "add", "value": 1},
                    },
                ],
            },
            detachment_id="fix-det",
        ),
        ability(
            "fix-more",
            "stratagem",
            {
                "type": "ability-modifier",
                "target": "this-unit",
                "modifier": {
                    "ability": "fix-granted",
                    "aspect": "selections",
                    "operation": "add",
                    "value": 1,
                },
            },
            detachment_id="fix-det",
        ),
        ability(
            "fix-banner",
            "enhancement",
            {
                "type": "re-roll",
                "target": "this-unit",
                "modifier": {"roll": "hit", "subset": "ones"},
            },
            detachment_id="fix-det",
        ),
    ]
    raw["detachments"] = [
        {
            "id": "fix-det",
            "name": "Fix Detachment",
            "faction_id": "orks",
            "stratagem_ids": ["fix-strat-s", "fix-more-s"],
            "game_version": VERSION,
        }
    ]
    raw["stratagems"] = [
        {
            "id": "fix-strat-s",
            "name": "Fix Strat",
            "category": "detachment",
            "detachment_id": "fix-det",
            "cp_cost": 2,
            "phases": ["fight"],
            "ability_id": "fix-strat",
            "game_version": VERSION,
        },
        {
            "id": "fix-more-s",
            "name": "Fix More",
            "category": "detachment",
            "detachment_id": "fix-det",
            "cp_cost": 1,
            "phases": ["fight"],
            "ability_id": "fix-more",
            "game_version": VERSION,
        },
    ]
    raw["enhancements"] = [
        {
            "id": "fix-banner-e",
            "name": "Fix Banner",
            "detachment_id": "fix-det",
            "cost": 20,
            "keyword_restrictions": ["Orks"],
            "ability_id": "fix-banner",
            "is_unique": True,
            "game_version": VERSION,
        }
    ]
    return raw


DS = Dataset(army_raw())
MOB = {"unitId": "fix-mob", "factionId": "orks", "detachmentId": "fix-det"}
BOSS = {"unitId": "fix-boss", "factionId": "orks", "detachmentId": "fix-det"}


def by_id(
    input_: dict[str, Any], ds: Dataset = DS
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    result = ds.stackable_buffs_for(input_, {"phase": "fight"})
    levers = {lever["id"]: lever for lever in result["buffs"]}
    groups = {group["id"]: group for group in result["groups"]}
    return levers, groups


def test_stratagem_is_one_cp_lever_its_choices_depend_on_even_when_it_applies_nothing() -> None:
    levers, _ = by_id(MOB)
    strat = levers["detachment-stratagem:fix-strat"]
    assert strat["buffs"] == []
    assert strat["enabled"] is False
    assert strat["cost"] == {"cp": 2}
    for id_ in ("fix-strat?0", "fix-strat?1"):
        assert levers[id_]["requiresLever"] == "detachment-stratagem:fix-strat"
        assert levers[id_]["group"] == "fix-strat?choice"
        assert "cost" not in levers[id_]


def test_granted_record_becomes_its_own_choice_levers_on_the_unit_the_grant_reaches() -> None:
    levers, groups = by_id(MOB)
    granted = levers["fix-grant-rule>fix-granted?0"]
    assert granted["group"] == "fix-grant-rule>fix-granted?choice"
    assert granted["enabled"] is False
    assert "requiresLever" not in granted
    assert groups["fix-grant-rule>fix-granted?choice"] == {
        "id": "fix-grant-rule>fix-granted?choice",
        "label": "Fix Granted",
        "maxActivations": 1,
    }
    # The boss is not a MOB: the grant does not reach it.
    boss_levers, _ = by_id(BOSS)
    assert not any(id_.startswith("fix-grant-rule>") for id_ in boss_levers)


def test_record_is_not_granted_again_to_a_unit_that_already_holds_it() -> None:
    raw = army_raw()
    raw["units"] = [unit("fix-mob", ["Infantry", "Mob"], ["fix-granted"])]
    ids = [
        lever["id"] for lever in Dataset(raw).stackable_buffs_for(MOB, {"phase": "fight"})["buffs"]
    ]
    assert "fix-granted?0" in ids
    assert not any(id_.startswith("fix-grant-rule>") for id_ in ids)


def test_selection_raising_stratagem_points_at_its_pool_and_drops_where_absent() -> None:
    levers, _ = by_id(MOB)
    more = levers["fix-more#cap"]
    assert more["buffs"] == []
    assert more["raisesCap"] == {"group": "fix-grant-rule>fix-granted?choice", "by": 1}
    assert more["requiresLever"] == "detachment-stratagem:fix-more"
    boss_levers, _ = by_id(BOSS)
    assert "fix-more#cap" not in boss_levers


def test_another_units_selection_is_opt_in_names_that_unit_and_skips_its_own_buffs() -> None:
    levers, _ = by_id({**MOB, "supportingUnitIds": ["fix-boss"]})
    picked = levers["fix-pick-a-mob#selected"]
    assert picked["enabled"] is False
    assert picked["source"]["kind"] == "ability"
    assert picked["source"]["abilityKind"] == "support"
    assert picked["source"]["sourceUnitId"] == "fix-boss"
    assert len(picked["requires"]) == 1
    assert "support:fix-nob-aura" not in levers


def test_boss_selection_stays_off_the_mob_it_leads() -> None:
    levers, _ = by_id({**MOB, "attachedUnitIds": ["fix-boss"]})
    assert "fix-pick-a-mob#selected" not in levers


def test_enhancement_for_a_character_at_its_points_one_per_bearer_none_to_epic_hero() -> None:
    levers, groups = by_id({**MOB, "attachedUnitIds": ["fix-boss"]})
    banner = levers["enhancement:fix-banner-e@fix-boss"]
    assert banner["cost"] == {"points": 20}
    assert banner["group"] == "enhancement@fix-boss"
    assert banner["enabled"] is False
    assert banner["source"] == {
        "kind": "ability",
        "abilityId": "fix-banner",
        "abilityKind": "attached",
        "sourceUnitId": "fix-boss",
    }
    assert groups["enhancement@fix-boss"]["maxActivations"] == 1
    mob_levers, _ = by_id(MOB)
    assert not any(id_.startswith("enhancement:") for id_ in mob_levers)
    hero_levers, _ = by_id({**MOB, "attachedUnitIds": ["fix-hero"]})
    assert not any(id_.startswith("enhancement:") for id_ in hero_levers)
