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
    keyword_id, _, rating = keyword.lower().partition(" ")
    ref: dict[str, Any] = {"keyword_id": keyword_id.replace(" ", "-")}
    if rating:
        ref["parameters"] = {"value": int(rating)}
    return {
        "type": "weapon-ability-grant",
        "target": "this-unit",
        "modifier": {"keywords": [ref]},
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
                    "filter": {
                        "owner": "friendly",
                        "all_of": ["MOB"],
                    },
                    "count": {"min": 1, "max": 1},
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
            {
                "type": "stance-select",
                "mode": "re-selectable",
                "options": [
                    {
                        "id": "stable-lethal",
                        "name": "Lethal",
                        "effect": grant("lethal-hits"),
                    },
                    {
                        "id": "stable-sustained",
                        "name": "Sustained",
                        "effect": grant("sustained-hits 1"),
                    },
                ],
            },
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
                "type": "stance-selection-capacity",
                "modifier": {
                    "ability_id": "fix-granted",
                    "additional_selections": 1,
                    "allocation": "choose-one-option",
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
    granted = levers["fix-grant-rule>fix-granted#stable-lethal"]
    assert granted["group"] == "fix-grant-rule>fix-granted?stance"
    assert granted["enabled"] is False
    assert "requiresLever" not in granted
    assert groups["fix-grant-rule>fix-granted?stance"] == {
        "id": "fix-grant-rule>fix-granted?stance",
        "abilityId": "fix-granted",
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
    assert "fix-granted#stable-lethal" in ids
    assert not any(id_.startswith("fix-grant-rule>") for id_ in ids)


def test_selection_raising_stratagem_points_at_its_pool_and_drops_where_absent() -> None:
    levers, _ = by_id(MOB)
    more = levers["fix-more#cap"]
    assert more["buffs"] == []
    assert more["raisesCap"] == {
        "group": "fix-grant-rule>fix-granted?stance",
        "by": 1,
        "allocation": "choose-one-option",
    }
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


def test_rule_gated_on_a_stance_option_binds_to_that_options_lever() -> None:
    """A buffless option gets its own lever, so the rule gated on it still has one to require."""

    def gated_on(option_id: str, effect: Any) -> dict[str, Any]:
        return {
            "type": "conditional",
            "condition": {
                "type": "rule-active",
                "parameters": {"rule": {"ability_id": "fix-granted", "option_id": option_id}},
            },
            "effect": effect,
        }

    raw = army_raw()
    for record in raw["abilities"]:
        if record["ability_id"] == "fix-granted":
            record["effect"]["options"].append(
                {
                    "id": "stable-hold",
                    "name": "Hold",
                    "effect": {
                        "type": "move-modifier",
                        "target": "this-unit",
                        "modifier": {"applies_to_moves": ["normal"], "distance_bonus": 1},
                    },
                }
            )
    wound_plus = {
        "type": "roll-modifier",
        "target": "this-unit",
        "modifier": {"roll": "wound", "operation": "add", "value": 1},
    }
    raw["abilities"] += [
        ability(
            "fix-surge",
            "stratagem",
            gated_on("stable-hold", hit_plus("this-unit")),
            detachment_id="fix-det",
        ),
        ability(
            "fix-edge", "stratagem", gated_on("stable-lethal", wound_plus), detachment_id="fix-det"
        ),
    ]
    raw["detachments"][0]["stratagem_ids"] += ["fix-surge-s", "fix-edge-s"]
    raw["stratagems"] += [
        {
            "id": f"fix-{name}-s",
            "name": f"Fix {name.title()}",
            "category": "detachment",
            "detachment_id": "fix-det",
            "cp_cost": 1,
            "phases": ["fight"],
            "ability_id": f"fix-{name}",
            "game_version": VERSION,
        }
        for name in ("surge", "edge")
    ]
    army = Dataset(raw)
    levers, _ = by_id(MOB, army)
    surge = levers["fix-surge#stable-hold"]
    assert surge["requiresOption"] == "fix-grant-rule>fix-granted#stable-hold"
    assert surge["requiresLever"] == "detachment-stratagem:fix-surge"
    hold = levers["fix-grant-rule>fix-granted#stable-hold"]
    assert hold["label"] == "Fix Granted — Hold"
    assert hold["buffs"] == []
    assert hold["enabled"] is False
    assert hold["group"] == "fix-grant-rule>fix-granted?stance"
    assert levers["fix-edge#stable-lethal"]["requiresOption"] == (
        "fix-grant-rule>fix-granted#stable-lethal"
    )
    # The boss cannot pick the stance, so the rules gated on it offer it nothing.
    boss_levers, _ = by_id(BOSS, army)
    assert not any(id_.startswith(("fix-surge#", "fix-edge#")) for id_ in boss_levers)
    # A declared active rule is evaluated directly instead.
    declared = army.stackable_buffs_for(
        MOB,
        {
            "phase": "fight",
            "activeRules": [{"ability_id": "fix-granted", "option_id": "stable-hold"}],
        },
    )["buffs"]
    surge_strat = next(
        lever for lever in declared if lever["id"] == "detachment-stratagem:fix-surge"
    )
    assert len(surge_strat["buffs"]) == 1
    assert not any("requiresOption" in lever for lever in declared)


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


def test_model_level_keyword_recipient_reads_every_models_keywords() -> None:
    def reroll(all_of: list[str]) -> dict[str, Any]:
        return {
            "type": "re-roll",
            "target": {"owner": "friendly", "level": "model", "all_of": all_of},
            "modifier": {"roll": "hit", "subset": "ones"},
        }

    raw = army_raw()
    for record in raw["units"]:
        if record["id"] == "fix-boss":
            record["ability_ids"] = ["fix-orks-models", "fix-character-models"]
    raw["abilities"] += [
        ability("fix-orks-models", "unit", reroll(["ORKS"])),
        ability("fix-character-models", "unit", reroll(["CHARACTER"])),
    ]
    ds = Dataset(raw)

    def buffs_of(input_: dict[str, Any], ability_id: str) -> list[Any]:
        result = ds.stackable_buffs_for(input_, {"phase": "fight"})
        return [
            buff
            for lever in result["buffs"]
            if lever["source"].get("abilityId") == ability_id
            for buff in lever["buffs"]
        ]

    led = {**MOB, "attachedUnitIds": ["fix-boss"]}
    # Every model of the mob and its boss is ORKS; only the boss's models are CHARACTER.
    assert buffs_of(led, "fix-orks-models") != []
    assert buffs_of(led, "fix-character-models") == []
    assert buffs_of({"unitId": "fix-boss", "factionId": "orks"}, "fix-character-models") != []


def _slayer_wound_mod(dataset: Any, target_id: str) -> int:
    """The wound modifier Allarus Custodians' melee lever gives against ``target_id`` when the
    caller's crunch context names no attacker Toughness: the lever carries the unit's own."""
    from wh40kdc.cruncher import crunch

    allarus = dataset.units.get_in_faction("allarus-custodians", "adeptus-custodes")
    axe = dataset.weapons.get_in_faction("castellan-axe", "adeptus-custodes")
    melee = next(i for i, p in enumerate(axe.raw["profiles"]) if p.get("range") == "Melee")
    context = {"phase": "fight"}
    levers = dataset.stackable_buffs_for(
        {"unitId": allarus.id, "factionId": "adeptus-custodes"}, context
    )["buffs"]
    chosen = [
        buff
        for lever in levers
        if lever["enabled"] and "slayer-of-tyrants" in lever["id"]
        for buff in lever["buffs"]
    ]
    assert chosen
    target = dataset.units.get_any(target_id)
    out = crunch(
        {
            "attacker": {"weapon": axe.raw, "profileIndex": melee},
            "target": {"unit": target.raw, "profileIndex": 0},
            "modelsFiring": 1,
            "buffs": chosen,
            "context": context,
        },
        dataset,
    )
    return int(out["resolved"]["woundMod"]["value"])


def test_own_toughness_comparison_fires_only_against_a_higher_toughness(dataset: Any) -> None:
    allarus = dataset.units.get_in_faction("allarus-custodians", "adeptus-custodes")
    assert allarus.raw["profiles"][0]["T"] == 7
    assert _slayer_wound_mod(dataset, "land-raider") == 1
    assert _slayer_wound_mod(dataset, "allarus-custodians") == 0
    assert _slayer_wound_mod(dataset, "custodian-wardens") == 0


def test_combined_toughness_reads_the_bodyguard_not_the_tougher_leader(dataset: Any) -> None:
    from wh40kdc.data.lever_providers import combined_toughness

    ghazghkull = dataset.units.get_any("ghazghkull-thraka")
    meganobz = dataset.units.get_any("meganobz")
    assert combined_toughness([ghazghkull, meganobz]) == 6
    assert combined_toughness([ghazghkull]) == 10
    roles = {"ghazghkull-thraka": "bodyguard", "meganobz": "leader"}
    assert combined_toughness([ghazghkull, meganobz], roles) == 10
    assert combined_toughness([]) is None
