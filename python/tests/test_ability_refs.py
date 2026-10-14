"""Unit ``ability_ids`` entries (id | {id, value?, wargear?}) and rated rules."""

from __future__ import annotations

from typing import Any

from wh40kdc.data.ability_refs import (
    ability_ids_of,
    printed_wargear_ids,
    unit_ability_ids,
    with_rating,
)
from wh40kdc.data.loadout import _options_with_printed_unit_abilities

_FNP = {"type": "feel-no-pain", "target": "this-unit", "modifier": {"threshold": {"rating": True}}}


def test_reads_both_entry_forms_and_skips_junk() -> None:
    refs = ["a", {"id": "feel-no-pain", "value": 5}, {"id": "s-aeldari", "wargear": "s"}, 7, None]
    assert ability_ids_of(refs) == ["a", "feel-no-pain", "s-aeldari"]
    assert unit_ability_ids(None) == []
    assert printed_wargear_ids(refs) == ["s"]


def test_with_rating_substitutes_only_bare_rating_refs_and_keeps_identity() -> None:
    assert with_rating(_FNP, 5) == {**_FNP, "modifier": {"threshold": 5}}
    assert _FNP["modifier"]["threshold"] == {"rating": True}, "the input is not mutated"
    assert with_rating(_FNP, None) is _FNP
    untouched = {"type": "x", "modifier": {"rating": True, "other": 1}, "list": [1, {"a": 2}]}
    assert with_rating(untouched, 4) is untouched
    nested = {"type": "sequence", "steps": [{"count": {"rating": True}}, {"n": 1}]}
    out = with_rating(nested, "D3")
    assert out["steps"][0] == {"count": "D3"}
    assert out["steps"][1] is nested["steps"][1]


def test_unit_rating_reaches_the_cruncher_through_the_resolver(dataset: Any) -> None:
    unit = dataset.units.get_in_faction("arco-flagellants", "adepta-sororitas")
    assert unit.rating_of("feel-no-pain") == 5
    buffs = dataset.defensive_buffs_for(
        {"unitId": "arco-flagellants", "factionId": "adepta-sororitas"}, {"phase": "shooting"}
    )
    fnp = [b["contribution"] for b in buffs if b["contribution"]["type"] == "feel-no-pain"]
    assert fnp == [{"type": "feel-no-pain", "threshold": 5}]


def test_printed_wargear_link_comes_from_the_wargear_field_not_the_ability_id() -> None:
    # The ability id no longer equals the wargear id; only the {id, wargear} link adds the
    # stock option, and a bare ability id equal to a wargear id adds nothing.
    unit = {
        "id": "u",
        "ability_ids": [{"id": "medikit-adepta-sororitas", "wargear": "medikit"}, "banner"],
    }
    added = _options_with_printed_unit_abilities(unit, [], {"medikit": 1, "banner": 1})
    assert [o["replacement"] for o in added] == [["medikit"]]
    assert added[0]["id"] == "u-printed-ability-medikit"
