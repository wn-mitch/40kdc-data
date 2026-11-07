"""Game-mode views on the Dataset: listings filter, id lookups never do.

Pins the cross-port contract with real combat-patrol records from the embedded
data (Adeptus Mechanicus's Purge Corps Deltic-9 box), so a listing that leaks a
hidden record, or a lookup that drops one, fails here.
"""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc._spec import SPEC_VERSION
from wh40kdc.abilities_resolver import _printed_keyword
from wh40kdc.data import GAME_MODE_VIEWS, Dataset
from wh40kdc.data.bundle import raw_data
from wh40kdc.runner import create_runner_state, dispatch

FACTION = "adeptus-mechanicus"
CP_UNIT = "manipulus-skand"
CP_UNITS = {
    "manipulus-skand",
    "purge-corps-pteraxii-sterylizors",
    "purge-corps-serberys-sulphurhounds",
    "purge-corps-skitarii-vanguard",
}
CP_DETACHMENT = "purge-corps-deltic-9"
CP_ENHANCEMENT = "empowered-mechanisms-purge-corps-deltic-9-adeptus-mechanicus"
CP_KEYWORD = "Purge Corps Deltic-9"


@pytest.fixture(scope="module")
def cp(dataset: Any) -> Dataset:
    view: Dataset = dataset.for_game_mode("combat-patrol")
    return view


def test_embedded_is_matched_play(dataset: Any) -> None:
    assert dataset.game_mode == "matched-play"
    assert Dataset(raw_data()).game_mode == "matched-play"


def test_default_unit_listings_hide_combat_patrol(dataset: Any) -> None:
    listed = {u.id for u in dataset.units.by_faction(FACTION)}
    assert listed and not (listed & CP_UNITS)
    assert CP_UNIT not in {u.id for u in dataset.units}
    assert CP_UNIT not in {u.id for u in dataset.units.all}
    # The exact-id first step of find skips hidden records too.
    assert dataset.units.find(CP_UNIT) is None
    assert dataset.units.find("Manipulus Skand") is None
    assert dataset.units.find_all("Manipulus Skand") == []


def test_default_unit_lookups_still_resolve(dataset: Any) -> None:
    unit = dataset.units.get_any(CP_UNIT)
    assert unit is not None and unit.id == CP_UNIT
    in_faction = dataset.units.get_in_faction(CP_UNIT, FACTION)
    assert in_faction is not None and in_faction.id == CP_UNIT
    assert dataset.units.has(CP_UNIT)
    # The per-unit composition lookup is unfiltered; the listing is not. (The Purge
    # Corps compositions carry no game_modes, so use a tagged combat-patrol row.)
    sholgor = dataset.units.get_in_faction("sholgor-the-putrid", "death-guard")
    assert sholgor is not None
    assert dataset.unit_composition_of(sholgor.raw) is not None
    assert "sholgor-the-putrid" not in {c["unit_id"] for c in dataset.unit_compositions}


def test_combat_patrol_view_lists_it(cp: Dataset) -> None:
    assert {u.id for u in cp.units.by_faction(FACTION)} == CP_UNITS
    found = cp.units.find("Manipulus Skand")
    assert found is not None and found.id == CP_UNIT
    assert len(cp.units) == cp.units.size == len(cp.units.all)
    assert "sholgor-the-putrid" in {c["unit_id"] for c in cp.unit_compositions}


def test_detachment_listings_and_lookups(dataset: Any, cp: Dataset) -> None:
    assert CP_DETACHMENT not in {d["id"] for d in dataset.detachments.by_faction(FACTION)}
    assert dataset.detachments.find("Purge Corps Deltic-9") is None
    assert dataset.detachments.get_any(CP_DETACHMENT)["id"] == CP_DETACHMENT
    assert dataset.detachments.get_in_faction(CP_DETACHMENT, FACTION)["id"] == CP_DETACHMENT
    assert [d["id"] for d in cp.detachments.by_faction(FACTION)] == [CP_DETACHMENT]
    assert cp.detachments.find("Purge Corps Deltic-9")["id"] == CP_DETACHMENT


def test_enhancement_listings_and_lookups(dataset: Any, cp: Dataset) -> None:
    assert dataset.enhancements.find("Empowered Mechanisms") is None
    assert CP_ENHANCEMENT not in {e["id"] for e in dataset.enhancements}
    assert dataset.enhancements.get(CP_ENHANCEMENT)["id"] == CP_ENHANCEMENT
    assert cp.enhancements.find("Empowered Mechanisms")["id"] == CP_ENHANCEMENT


def test_all_is_the_union_of_every_mode(dataset: Any) -> None:
    every = dataset.for_game_mode("all")
    assert every.game_mode == "all"
    modes = [m for m in GAME_MODE_VIEWS if m != "all"]
    for name in ("units", "weapons", "detachments", "enhancements", "stratagems"):
        union: set[str] = set()
        for mode in modes:
            coll = getattr(dataset.for_game_mode(mode), name)
            union |= {_key(x) for x in coll}
        assert {_key(x) for x in getattr(every, name)} == union, name
    assert len(every.unit_compositions) == sum(
        len(dataset.for_game_mode(m).unit_compositions) for m in modes
    )
    assert CP_UNITS <= {u.id for u in every.units.by_faction(FACTION)}


def _key(record: Any) -> str:
    raw = record.raw if hasattr(record, "raw") else record
    return f"{raw.get('faction_id', '')}::{raw['id']}"


def test_unknown_mode_raises(dataset: Any) -> None:
    with pytest.raises(ValueError, match="Unknown game mode"):
        dataset.for_game_mode("narrative")
    with pytest.raises(ValueError, match="Unknown game mode"):
        Dataset(raw_data(), "narrative")


def test_views_share_indexes_and_link_back(dataset: Any, cp: Dataset) -> None:
    assert dataset.for_game_mode("combat-patrol") is cp
    assert cp.for_game_mode("matched-play") is dataset
    assert cp.units._by_id is dataset.units._by_id
    # A faction reached from a view lists that view's units.
    faction = cp.factions.get(FACTION)
    assert faction is not None
    assert {u.id for u in faction.units} == CP_UNITS
    default_faction = dataset.factions.get(FACTION)
    assert CP_UNIT not in {u.id for u in default_faction.units}
    # A unit looked up in the default view links back into the default view.
    unit = dataset.units.get_any(CP_UNIT)
    assert CP_UNIT not in {u.id for u in unit.faction.units}


def test_reverse_listings_filter(dataset: Any, cp: Dataset) -> None:
    assert dataset.units_with_keyword(CP_KEYWORD) == []
    assert {u.id for u in cp.units_with_keyword(CP_KEYWORD)} == CP_UNITS


def test_printed_keyword_sees_every_mode(dataset: Any) -> None:
    # Printed only on combat-patrol datasheets, yet printed all the same.
    assert _printed_keyword(dataset)(CP_KEYWORD)


def _linked(state: Any, query: str, input_: dict[str, Any]) -> Any:
    return dispatch(state, {"op": "linked_query", "args": {"query": query, "input": input_}})


def test_runner_game_mode_queries() -> None:
    state = create_runner_state()
    init = {"spec_version": SPEC_VERSION, "locale": "C", "tz": "UTC", "seed": 0}
    assert dispatch(state, {"op": "init", "args": init})["ok"]
    default = _linked(state, "units_of_faction", {"factionId": FACTION})["value"]
    assert not set(default) & CP_UNITS
    cp = _linked(state, "units_of_faction", {"factionId": FACTION, "gameMode": "combat-patrol"})
    assert set(cp["value"]) == CP_UNITS
    every = _linked(state, "units_of_faction", {"factionId": FACTION, "gameMode": "all"})
    assert set(every["value"]) == set(default) | CP_UNITS
    assert _linked(state, "get_unit", {"unitId": CP_UNIT})["value"] == CP_UNIT
    assert _linked(state, "find_unit", {"query": "Manipulus Skand"})["value"] is None
    assert _linked(state, "get_detachment", {"detachmentId": CP_DETACHMENT})["value"] == (
        CP_DETACHMENT
    )
    assert _linked(
        state, "detachments_of_faction", {"factionId": FACTION, "gameMode": "combat-patrol"}
    )["value"] == [CP_DETACHMENT]
    assert _linked(state, "find_detachment", {"query": "Purge Corps Deltic-9"})["value"] is None
    assert _linked(state, "find_enhancement", {"query": "Empowered Mechanisms"})["value"] is None
    assert (
        _linked(
            state,
            "find_enhancement",
            {"query": "Empowered Mechanisms", "gameMode": "combat-patrol"},
        )["value"]
        == CP_ENHANCEMENT
    )
    bad = _linked(state, "units_of_faction", {"factionId": FACTION, "gameMode": "narrative"})
    assert bad["ok"] is False and bad["error_kind"] == "INVALID_INPUT"
