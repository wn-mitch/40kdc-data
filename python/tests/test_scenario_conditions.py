"""Scenario-state condition evaluators and the attack-comparison gate.

Each test pins a boundary the conformance corpus does not reach directly: owner flips across
sides, "wholly" regions, empty objective totals, operands the engine cannot supply, and the
three-valued fall-through when the context omits a fact.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.cruncher import effect_to_buffs
from wh40kdc.cruncher.buffs import resolve_buffs
from wh40kdc.cruncher.scenario_conditions import (
    attachment_from_members,
    attack_comparison,
    attack_comparison_holds,
    evaluate_controls,
    evaluate_in_region,
    evaluate_rule_active,
    keyword_matches_predicate,
)

_SOURCE = {"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
_HIT = {
    "type": "roll-modifier",
    "target": "this-unit",
    "modifier": {"roll": "hit", "operation": "add", "value": 1},
}


def _conditional(condition: dict[str, Any]) -> dict[str, Any]:
    return {"type": "conditional", "condition": condition, "effect": _HIT}


def test_attack_comparison_rejects_operands_the_engine_cannot_supply() -> None:
    s = {"of": "attacker", "stat": "S"}
    assert attack_comparison(
        {"left": s, "comparison": "gt", "right": {"of": "defender", "stat": "T"}}
    )
    # Attacker S cannot be reduced; attacker T has no minimum; a constant cannot lead.
    assert (
        attack_comparison({"left": {**s, "reduce": "max"}, "comparison": "gt", "right": s}) is None
    )
    attacker_t_min = {"of": "attacker", "stat": "T", "reduce": "min"}
    assert attack_comparison({"left": attacker_t_min, "comparison": "gt", "right": s}) is None
    assert attack_comparison({"left": {"value": 4}, "comparison": "gt", "right": s}) is None
    assert attack_comparison({"left": s, "comparison": "ne", "right": {"value": 4}}) is None
    assert attack_comparison({"left": s, "comparison": "gt", "right": {"value": 4}, "x": 1}) is None


@pytest.mark.parametrize(
    ("comparison", "strength", "expected"),
    [("gt", 5, True), ("gt", 4, False), ("gte", 4, True), ("lt", 4, False), ("eq", 4, True)],
)
def test_attack_comparison_boundaries(comparison: str, strength: int, expected: bool) -> None:
    gate = {
        "left": {"of": "attacker", "stat": "S"},
        "comparison": comparison,
        "right": {"of": "defender", "stat": "T"},
    }
    assert (
        attack_comparison_holds(gate, {"attackStrength": strength, "targetToughness": 4})
        is expected
    )


def test_attack_comparison_reads_reduced_toughness_and_fails_when_missing() -> None:
    gate = {
        "left": {"of": "attacker", "stat": "S"},
        "comparison": "gte",
        "right": {"of": "defender", "stat": "T", "reduce": "max"},
    }
    ctx = {"attackStrength": 5, "targetToughness": 3, "targetToughnessMax": 6}
    assert attack_comparison_holds(gate, ctx) is False
    assert attack_comparison_holds(gate, {**ctx, "targetToughnessMax": 5}) is True
    assert attack_comparison_holds(gate, {"targetToughnessMax": 5}) is False


def test_attack_compare_mixed_with_unit_condition_becomes_a_gate() -> None:
    compare = {
        "type": "attack-compare",
        "parameters": {
            "left": {"of": "attacker", "stat": "S"},
            "comparison": "lt",
            "right": {"of": "defender", "stat": "T"},
        },
    }
    shooting = {"type": "phase-is", "parameters": {"phase": "shooting"}}
    condition = {
        "operator": "and",
        "operands": [{"operator": "and", "operands": [shooting]}, compare],
    }
    result = effect_to_buffs(_conditional(condition), _SOURCE, {"phase": "shooting"}, "attacker")
    assert [b["applicableWhen"] for b in result["applied"]] == [
        {"attackComparisons": [compare["parameters"]]}
    ]
    # The unit-side operand is false: the effect is dropped, not reported unsupported.
    result = effect_to_buffs(_conditional(condition), _SOURCE, {"phase": "fight"}, "attacker")
    assert result["applied"] == [] and result["unsupported"] == []
    buff = effect_to_buffs(_conditional(compare), _SOURCE, {}, "attacker")["applied"][0]
    assert (
        resolve_buffs([buff], {"attackStrength": 3, "targetToughness": 4})["hitMod"]["value"] == 1
    )
    assert (
        resolve_buffs([buff], {"attackStrength": 4, "targetToughness": 4})["hitMod"]["value"] == 0
    )


def test_rule_active_needs_the_exact_option() -> None:
    ctx = {"activeRules": ["oath", {"ability_id": "doctrine", "option_id": "assault"}]}
    assert evaluate_rule_active({"rule": "doctrine"}, ctx) is True
    assert evaluate_rule_active({"rule": {"ability_id": "doctrine", "option_id": "assault"}}, ctx)
    assert (
        evaluate_rule_active({"rule": {"ability_id": "doctrine", "option_id": "tactical"}}, ctx)
        is False
    )
    # A bare string entry does not establish any one option of that rule.
    assert evaluate_rule_active({"rule": {"ability_id": "oath", "option_id": "x"}}, ctx) is False
    assert evaluate_rule_active({"rule": "oath"}, {}) == "unknown"


def test_in_region_reads_territory_from_the_ability_side_and_needs_wholly() -> None:
    ctx = {"targetRegions": [{"territory": "attacker"}]}
    params = {"region": {"territory": "your-territory"}}
    assert evaluate_in_region(params, ctx, "target", "attacker") is True
    assert evaluate_in_region(params, ctx, "target", "target") is False
    assert evaluate_in_region({**params, "wholly": True}, ctx, "target", "attacker") is False
    wholly = {"targetRegions": [{"territory": "attacker", "wholly": True}]}
    assert evaluate_in_region({**params, "models": "every"}, wholly, "target", "attacker") is True
    designated = {"region": {"terrain_area": {"designated": "ruin"}}}
    assert evaluate_in_region(designated, {"targetRegions": []}, "target", "target") is False
    area = {"targetRegions": [{"terrainArea": True}]}
    assert evaluate_in_region(designated, area, "target", "target") == "unknown"
    marked = {"targetRegions": [{"terrainArea": True, "designations": ["RUIN"]}]}
    assert evaluate_in_region(designated, marked, "target", "target") is True
    assert evaluate_in_region(params, {}, "target", "attacker") == "unknown"


def test_controls_clauses() -> None:
    ctx = {"objectivesControlled": {"attacker": 2, "target": 3, "total": 5}}
    assert evaluate_controls({}, ctx, "attacker") is True
    assert evaluate_controls({"by": "enemy", "count": {"min": 3}}, ctx, "attacker") is True
    assert evaluate_controls({"count": {"max": 1}}, ctx, "attacker") is False
    more = {"compare": {"owner": "enemy", "comparison": "gt"}}
    assert evaluate_controls(more, ctx, "attacker") is False
    assert evaluate_controls(more, ctx, "target") is True
    half = {"proportion": {"fraction": 0.5, "comparison": "gte"}}
    assert evaluate_controls(half, ctx, "target") is True
    assert evaluate_controls(half, ctx, "attacker") is False
    empty = {"objectivesControlled": {"attacker": 0, "target": 0, "total": 0}}
    assert evaluate_controls(half, empty, "attacker") == "unknown"
    assert evaluate_controls({"objective": {"role": "home"}}, ctx, "attacker") == "unknown"


def test_attachment_members_role_and_with_filter() -> None:
    members = [
        {"unitId": "captain", "role": "leader", "keywords": ["CHARACTER"]},
        {"unitId": "squad", "role": "bodyguard", "keywords": ["INFANTRY", "BATTLELINE"]},
    ]
    assert attachment_from_members("leading", None, members, "captain") is True
    assert attachment_from_members("leading", None, members, "squad") is False
    assert attachment_from_members("led", None, members, "squad") is True
    battleline = {"all_of": ["battleline"]}
    assert attachment_from_members("leading", battleline, members, "captain") is True
    assert attachment_from_members("leading", {"all_of": ["VEHICLE"]}, members, "captain") is False
    assert attachment_from_members("leading", {"owner": "enemy"}, members, "captain") is False
    assert attachment_from_members("attached", None, members, "absent") is False
    assert attachment_from_members("attached", None, None, "captain") == "unknown"


def test_attachment_condition_with_filter_falls_back_to_unknown_without_members() -> None:
    condition = {"type": "attachment", "parameters": {"role": "leading", "with": {"all_of": ["X"]}}}
    ctx = {"attackerAttached": True, "attackerAttachmentRole": "leader"}
    result = effect_to_buffs(_conditional(condition), _SOURCE, ctx, "attacker")
    assert result["applied"] == [] and len(result["unsupported"]) == 1
    members = [
        {"unitId": "me", "role": "leader", "keywords": []},
        {"unitId": "them", "role": "bodyguard", "keywords": ["X"]},
    ]
    ctx = {**ctx, "attackerUnitId": "me", "attackerMembers": members}
    result = effect_to_buffs(_conditional(condition), _SOURCE, ctx, "attacker")
    assert [b["contribution"] for b in result["applied"]] == [{"type": "hit-mod", "value": 1}]


def test_within_neighbour_flips_owner_for_the_other_side() -> None:
    near_enemy = {
        "type": "matches",
        "parameters": {
            "subject": "defender",
            "filter": {
                "within": {"of": {"owner": "enemy", "all_of": ["MONSTER"]}, "range": {"inches": 6}}
            },
        },
    }
    # The defender's neighbour is its own friendly MONSTER: an enemy of the attacker's ability.
    ctx = {
        "targetNeighbours": [{"keywords": ["MONSTER"], "owner": "friendly", "distanceInches": 6}]
    }
    result = effect_to_buffs(_conditional(near_enemy), _SOURCE, ctx, "attacker")
    assert len(result["applied"]) == 1
    far = {
        "targetNeighbours": [{"keywords": ["MONSTER"], "owner": "friendly", "distanceInches": 7}]
    }
    assert effect_to_buffs(_conditional(near_enemy), _SOURCE, far, "attacker")["applied"] == []
    assert (
        len(effect_to_buffs(_conditional(near_enemy), _SOURCE, {}, "attacker")["unsupported"]) == 1
    )


def test_keyword_predicate_treats_empty_any_of_as_false() -> None:
    assert keyword_matches_predicate({"any_of": []}, ["INFANTRY"]) is False
    assert keyword_matches_predicate({"not_all_of": []}, ["INFANTRY"]) is False
    assert keyword_matches_predicate({"all_of": ["infantry"], "none_of": ["FLY"]}, ["INFANTRY"])
