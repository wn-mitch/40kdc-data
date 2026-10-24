"""Unit tests for the discrete allocation stage (mirrors
``tools/test/cruncher-allocation.test.ts``)."""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.cruncher import AttackModel, allocate_model
from wh40kdc.cruncher.damage_roll import quantity_distribution


def _model(**overrides: Any) -> AttackModel:
    """An attack model that always hits, wounds and goes unsaved unless overridden."""
    base: dict[str, Any] = {
        "modelsFiring": 1,
        "attacksStat": 1,
        "attacksBonus": 0,
        "rapidFireStat": None,
        "torrent": False,
        "hit": {"pass": 1, "crit": 0},
        "sustainedStat": None,
        "lethal": False,
        "wound": {"pass": 1, "crit": 0},
        "devastating": False,
        "unsaved": 1,
        "damage": [{"value": 1, "probability": 1}],
        "woundLost": 1,
        "mortalWoundLost": 1,
        "wounds": 1,
        "modelCount": 1,
    }
    base.update(overrides)
    return base  # type: ignore[return-value]


def test_loses_overkill_and_carries_a_wound_to_the_next_attack() -> None:
    # Two D2 attacks into one 3-wound model: 2, then 1 more kills it and 1 is lost.
    out = allocate_model(
        _model(attacksStat=2, damage=[{"value": 2, "probability": 1}], wounds=3, modelCount=2)
    )
    assert out["damageDealt"] == pytest.approx(3, abs=1e-12)
    assert out["modelsDestroyed"] == pytest.approx(1, abs=1e-12)
    assert out["modelsDestroyedDistribution"] == [0, 1, 0]


def test_caps_at_the_unit_and_matches_the_expected_value_when_nothing_is_lost() -> None:
    open_ = _model(
        attacksStat="2D6",
        hit={"pass": 2 / 3, "crit": 1 / 6},
        wound={"pass": 1 / 2, "crit": 1 / 6},
        unsaved=2 / 3,
        wounds=1,
        modelCount=40,
    )
    # E[attacks] * P(hit) * P(wound) * P(unsaved), with no model ever close to running out.
    expected = 7 * (2 / 3) * (1 / 2) * (2 / 3)
    assert allocate_model(open_)["damageDealt"] == pytest.approx(expected, abs=1e-9)
    capped = allocate_model({**open_, "modelCount": 1})
    assert capped["damageDealt"] <= 1
    assert sum(capped["modelsDestroyedDistribution"]) == pytest.approx(1, abs=1e-12)


def test_devastating_wounds_land_after_normal_damage_with_their_own_fnp() -> None:
    # A normal wound always lands before a mortal one, so a 1-model unit dies to the
    # normal wound and the mortal wound is lost; mortal-only Feel No Pain cannot change that.
    out = allocate_model(
        _model(
            attacksStat=2,
            wound={"pass": 1, "crit": 0.5},
            devastating=True,
            mortalWoundLost=0.5,
            wounds=1,
            modelCount=1,
        )
    )
    # Only both attacks critting leaves the model to two mortal wounds: 1 - 0.25 * (0.5 * 0.5).
    assert out["modelsDestroyed"] == pytest.approx(1 - 0.25 * 0.25, abs=1e-12)


@pytest.mark.parametrize(
    ("field", "value"),
    [("damage", [{"value": 1.5, "probability": 1}]), ("attacksBonus", 0.5), ("wounds", 2.5)],
)
def test_fractional_quantities_raise(field: str, value: Any) -> None:
    with pytest.raises(ValueError, match="must be a whole number"):
        allocate_model(_model(**{field: value}))


def test_quantity_distribution_shifts_dice_totals() -> None:
    assert quantity_distribution(3) == [(3, 1.0)]
    out = quantity_distribution("D3+1")
    assert [value for value, _ in out] == [2, 3, 4]
    assert sum(p for _, p in out) == pytest.approx(1, abs=1e-12)
