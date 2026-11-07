"""Ability DSL to cruncher-buff translation contracts."""

from __future__ import annotations

from typing import Any

from wh40kdc.cruncher import effect_to_buffs


def _named_region(
    keywords: list[str],
    operator: str = "or",
    default_effect: dict[str, Any] | None = None,
) -> dict[str, Any]:
    keyword_filter = (
        {"all_of": keywords} if operator == "and" else {"any_of": keywords}
    )
    return {
        "type": "named-region-state",
        "target": {"owner": "friendly"},
        "modifier": {
            "region_ref": {"region_id": "fabricated-region"},
            "producer": {
                "region_ref": {"region_id": "fabricated-region"},
                "mode": "complete",
                "parent_ref": None,
                "baseline": [],
                "phase_extensions": [],
                "additive_extensions": [],
            },
            "consumer": {
                "state_ref": {"region_id": "fabricated-region"},
                "beneficiary_filter": keyword_filter,
                "membership": {"unit_scope": "whole-unit", "relation": "wholly-within"},
                "qualified_condition": {
                    "type": "matches",
                    "parameters": {"subject": "this-unit", "filter": keyword_filter},
                },
                "default_branch": {
                    "effect": default_effect
                    or {
                        "type": "re-roll",
                        "target": "attacker",
                        "modifier": {"roll": "hit", "subset": "ones"},
                    }
                },
                "qualified_branch": {
                    "effect": {
                        "type": "re-roll",
                        "target": "attacker",
                        "modifier": {"roll": "hit", "result_scope": "any-result"},
                    }
                },
            },
            "branch_precedence": "qualified-replaces-default",
        },
    }


def _source() -> dict[str, Any]:
    return {"kind": "ability", "abilityId": "named-region-test", "abilityKind": "unit"}


def test_named_region_matching_or_applies_default_and_reports_qualified() -> None:
    result = effect_to_buffs(
        _named_region(["CRYPTEK", "CANOPTEK"]),
        _source(),
        {"phase": "shooting", "attackerKeywords": ["canoptek"]},
    )
    assert [buff["contribution"] for buff in result["applied"]] == [
        {"type": "reroll", "roll": "hit", "subset": "ones"}
    ]
    assert "qualified replacement" in result["unsupported"][0]["reason"]


def test_named_region_nonmatching_gate_applies_neither_branch() -> None:
    result = effect_to_buffs(
        _named_region(["CRYPTEK", "CANOPTEK"]),
        _source(),
        {"phase": "shooting", "attackerKeywords": ["WARRIOR"]},
    )
    assert result["applied"] == []
    assert result["unsupported"] == []


def test_named_region_qualified_branch_is_explicitly_unsupported() -> None:
    result = effect_to_buffs(
        _named_region(["CRYPTEK"]),
        _source(),
        {"phase": "shooting", "attackerKeywords": ["CRYPTEK"]},
    )
    assert any("qualified replacement" in item["reason"] for item in result["unsupported"])


def test_named_region_reroll_gates_on_the_weapon_keyword_it_names() -> None:
    result = effect_to_buffs(
        _named_region(
            ["THOUSAND SONS"],
            "and",
            {
                "type": "re-roll",
                "target": "attacker",
                "modifier": {
                    "roll": "wound",
                    "subset": "ones",
                    "weapons": {"keyword": {"keyword_id": "psychic"}},
                },
            },
        ),
        _source(),
        {"phase": "shooting", "attackerKeywords": ["thousand sons"]},
    )
    assert len(result["unsupported"]) == 1
    assert "qualified replacement" in result["unsupported"][0]["reason"]
    gates = [
        (buff.get("applicableWhen") or {}).get("weaponKeywords")
        for buff in result["applied"]
    ]
    assert gates == [[{"keyword_id": "psychic"}]]


def test_count_capped_reroll_is_not_applied_as_unlimited() -> None:
    one = effect_to_buffs(
        {
            "type": "re-roll",
            "target": "this-unit",
            "modifier": {"roll": "hit", "result_scope": "any-result", "count": 1},
        },
        _source(),
        {"phase": "shooting"},
    )
    assert [buff["contribution"] for buff in one["applied"]] == [
        {"type": "reroll-one", "roll": "hit"}
    ]
    assert one["unsupported"] == []
    two = {
        "type": "re-roll",
        "target": "this-unit",
        "modifier": {"roll": "hit", "result_scope": "any-result", "count": 2},
    }
    refused = effect_to_buffs(two, _source(), {"phase": "shooting"})
    assert refused["applied"] == []
    assert refused["unsupported"] == [
        {
            "reason": (
                "re-roll: a count-capped permission other than one die of any result "
                "is not modelled by the expected-value engine"
            ),
            "effectFragment": two,
            "scope": "unresolved",
        }
    ]
    # A roll off the damage path stays outside it, whatever its count.
    charge = effect_to_buffs(
        {
            "type": "re-roll",
            "target": "this-unit",
            "modifier": {"roll": "charge", "result_scope": "any-result", "count": 1},
        },
        _source(),
        {"phase": "shooting"},
    )
    assert charge["applied"] == []
    assert "outside the damage path" in charge["unsupported"][0]["reason"]


def test_leader_model_ability_grant_requires_resolved_beneficiary() -> None:
    effect = {
        "type": "leader-model-ability-grant",
        "grant": {"effect": {"type": "feel-no-pain", "modifier": {"threshold": 4}}},
    }
    result = effect_to_buffs(
        effect,
        _source(),
        {"phase": "shooting"},
        "target",
    )
    assert result["applied"] == []
    assert result["unsupported"] == [
        {
            "reason": 'effect type "leader-model-ability-grant" is not modelled by the buff layer',
            "effectFragment": effect,
            "scope": "unresolved",
        }
    ]


def test_persistent_designation_requires_retained_selection_state() -> None:
    effect = {
        "type": "persistent-designation",
        "consumer": {
            "effect": {
                "type": "re-roll",
                "target": "this-model",
                "modifier": {"roll": "hit", "subset": "all-failures"},
            }
        },
    }
    result = effect_to_buffs(effect, _source(), {"phase": "shooting"})
    assert result["applied"] == []
    assert result["unsupported"] == [
        {
            "reason": 'effect type "persistent-designation" is not modelled by the buff layer',
            "effectFragment": effect,
            "scope": "unresolved",
        }
    ]


def test_rules_bundle_walks_every_effect_step() -> None:
    result = effect_to_buffs(
        {
            "type": "rules-bundle",
            "steps": [
                {
                    "type": "re-roll",
                    "target": "this-unit",
                    "modifier": {"roll": "hit", "subset": "ones"},
                },
                {
                    "type": "re-roll",
                    "target": "this-unit",
                    "modifier": {"roll": "wound", "subset": "ones"},
                },
            ],
        },
        _source(),
        {"phase": "shooting"},
    )
    assert len(result["applied"]) == 2
    assert result["unsupported"] == []
