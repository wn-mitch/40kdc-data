"""Named ability grants: a printed definition applies to its holders, and a friendly filter naming
the ability being resolved in ``has_ability`` selects its holder. Mirrors
``tools/test/cruncher-named-grants.test.ts``."""

from __future__ import annotations

from typing import Any

from wh40kdc.cruncher import effect_to_buffs

_LETHAL = {"type": "extra-keyword", "keywordRef": {"keyword_id": "lethal-hits"}}


def _grant(target: Any, printed: bool) -> dict[str, Any]:
    modifier: dict[str, Any] = {
        "ability": {"ability_id": "fabricated-named", "definition_id": "fabricated-part"}
    }
    if printed:
        modifier["definition"] = {
            "type": "ability-part",
            "name": "Fabricated Part",
            "effect": {
                "type": "weapon-ability-grant",
                "target": "this-unit",
                "modifier": {"keywords": [{"keyword_id": "lethal-hits"}]},
            },
        }
    return {"type": "ability-grant", "target": target, "modifier": modifier}


def _buffs(effect: dict[str, Any], kind: str = "detachment") -> Any:
    source = {"kind": "ability", "abilityId": "fabricated-named", "abilityKind": kind}
    context = {"phase": "shooting", "attackerKeywords": ["kill team"]}
    return effect_to_buffs(effect, source, context, "attacker")  # type: ignore[arg-type]


def test_a_named_grant_translates_the_definition_it_prints() -> None:
    out = _buffs(_grant("this-unit", True))
    assert [buff["contribution"] for buff in out["applied"]] == [_LETHAL]
    assert out["unsupported"] == []
    bare = _buffs(_grant("this-unit", False))
    assert bare["applied"] == []
    assert [entry["reason"] for entry in bare["unsupported"]] == [
        "ability-grant: named ability ownership is not resolved by the buff engine"
    ]


def test_a_friendly_filter_selects_the_holder_of_the_ability_being_resolved() -> None:
    def holders(has: str) -> dict[str, Any]:
        return {"owner": "friendly", "all_of": ["KILL TEAM"], "has_ability": [has]}

    assert len(_buffs(_grant(holders("fabricated-named"), True))["applied"]) == 1
    assert _buffs(_grant(holders("fabricated-other"), True))["applied"] == []
    assert _buffs(_grant(holders("fabricated-named"), True), "support")["applied"] == []
