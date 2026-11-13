"""An alternate wargear slot that lists an empty choice.

Leaving the alternate untaken keeps the standard loadout, so a model carrying
nothing is still not a legal loadout.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.data.mfm_loadout import check_mfm_loadout

GUN = [{"id": "gun", "count": 1}]
SWORD = [{"id": "sword", "count": 1}]


def _slot(alternate: bool, choices: list[Any]) -> dict[str, Any]:
    return {
        "model": "Trooper",
        "picks": 1,
        "repeats": False,
        "alternate": alternate,
        "choices": choices,
    }


RULES: dict[str, Any] = {
    "stock": [{"model": "Trooper", "models": 1, "items": GUN}],
    "templates": [{"model": "Trooper", "items": GUN}],
    "slots": [
        _slot(alternate=False, choices=[GUN]),
        _slot(alternate=True, choices=[[], SWORD]),
    ],
    "limits": [],
    "uniform": [],
    "options": [],
}


def _codes(counts: dict[str, int]) -> list[str]:
    return [v["code"] for v in check_mfm_loadout(RULES, {"Trooper": 1}, counts)]


def test_refuses_a_model_the_empty_alternate_leaves_unarmed() -> None:
    assert _codes({}) == ["no-assignment"]


def test_allows_the_standard_loadout_or_the_alternate() -> None:
    assert _codes({"gun": 1}) == []
    assert _codes({"sword": 1}) == []
