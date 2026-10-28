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


def test_zeroes_the_first_attacks_a_unit_wide_defence_can_take() -> None:
    # Three D3 attacks into one 3-wound model with one use: only the last two roll Damage.
    d3 = [{"value": v, "probability": p} for v, p in quantity_distribution("D3")]
    attack = _model(attacksStat=3, damage=d3, wounds=3, modelCount=1)
    zeroed = allocate_model(attack, {"zeroing": {"uses": 1, "per": "unit"}})
    assert zeroed == allocate_model({**attack, "attacksStat": 2})
    # Two D3 rolls fall short of 3 only as 1 and 1.
    assert zeroed["modelsDestroyed"] == pytest.approx(8 / 9, abs=1e-12)
    assert allocate_model(attack, {"zeroing": {"uses": 3, "per": "unit"}})["damageDealt"] == 0


def test_refills_a_per_model_defence_but_never_zeroes_mortal_wounds() -> None:
    attack = _model(attacksStat=3, damage=[{"value": 2, "probability": 1}], wounds=2, modelCount=2)
    per_model = allocate_model(attack, {"zeroing": {"uses": 1, "per": "model"}})
    assert per_model["modelsDestroyedDistribution"] == [0, 1, 0]
    per_unit = allocate_model(attack, {"zeroing": {"uses": 1, "per": "unit"}})
    assert per_unit["modelsDestroyedDistribution"] == [0, 0, 1]
    mortal = _model(
        attacksStat=2, wound={"pass": 1, "crit": 1}, devastating=True, wounds=1, modelCount=2
    )
    assert allocate_model(mortal, {"zeroing": {"uses": 2, "per": "unit"}})["modelsDestroyed"] == 2


def test_rejects_malformed_zeroing_and_event_tables_past_the_exact_bound() -> None:
    with pytest.raises(ValueError, match="zeroing uses"):
        allocate_model(_model(), {"zeroing": {"uses": 1.5, "per": "unit"}})  # type: ignore[typeddict-item]
    with pytest.raises(ValueError, match="zeroing per"):
        allocate_model(_model(), {"zeroing": {"uses": 1, "per": "army"}})  # type: ignore[typeddict-item]
    huge = _model(
        modelsFiring=20,
        attacksStat=4,
        hit={"pass": 2 / 3, "crit": 1 / 6},
        sustainedStat=2,
        wound={"pass": 1 / 2, "crit": 1 / 6},
        devastating=True,
        wounds=3,
        modelCount=20,
    )
    with pytest.raises(ValueError, match="exact allocation bound"):
        allocate_model(huge)
    assert len(allocate_model({**huge, "devastating": False})["modelsDestroyedDistribution"]) == 21


def test_allocate_takes_damage_zeroing_from_the_defenders_buffs(dataset: Any) -> None:
    from wh40kdc.cruncher import allocate, crunch

    def engine_input(buffs: list[dict[str, Any]]) -> Any:
        return {
            "attacker": {"weapon": dataset.weapons.get_any("multi-melta").raw, "profileIndex": 0},
            "target": {
                "unit": dataset.units.get_any("questoris-knight-magaera").raw,
                "profileIndex": 0,
            },
            "modelsFiring": 2,
            "buffs": buffs,
            "context": {"phase": "shooting", "attackerStationary": True, "withinHalfRange": True},
        }

    source = {"kind": "ability", "abilityId": "fabricated-plating", "abilityKind": "unit"}

    def zeroing(uses: int, per: str) -> dict[str, Any]:
        return {
            "source": source,
            "contribution": {"type": "damage-zeroing", "uses": uses, "per": per},
        }

    plain = engine_input([])
    plated = engine_input([zeroing(1, "unit")])
    assert allocate(plated, dataset) == allocate(
        plain, dataset, {"zeroing": {"uses": 1, "per": "unit"}}
    )
    assert allocate(plated, dataset)["damageDealt"] < allocate(plain, dataset)["damageDealt"]
    assert crunch(plated, dataset)["stages"] == crunch(plain, dataset)["stages"]
    with pytest.raises(ValueError, match="together are not modelled"):
        allocate(engine_input([zeroing(1, "unit"), zeroing(1, "model")]), dataset)


def test_critical_wounds_allocate_with_their_own_save_and_damage() -> None:
    base = _model(
        modelsFiring=3,
        attacksStat=2,
        hit={"pass": 2 / 3, "crit": 1 / 6},
        sustainedStat=1,
        wound={"pass": 1 / 2, "crit": 1 / 6},
        unsaved=1 / 2,
        wounds=2,
        modelCount=5,
    )
    same = allocate_model({**base, "criticalWound": {"unsaved": 0.5, "damage": base["damage"]}})
    plain = allocate_model(base)
    assert same["damageDealt"] == pytest.approx(plain["damageDealt"], abs=1e-12)
    assert same["modelsDestroyedDistribution"] == pytest.approx(
        plain["modelsDestroyedDistribution"], abs=1e-12
    )
    harder = allocate_model(
        {**base, "criticalWound": {"unsaved": 1.0, "damage": [{"value": 2, "probability": 1}]}}
    )
    assert harder["damageDealt"] > plain["damageDealt"] + 0.05
    devastating = {**base, "devastating": True}
    mortal = {
        **devastating,
        "criticalWound": {"unsaved": 0.0, "damage": [{"value": 2, "probability": 1}]},
    }
    assert allocate_model(mortal)["damageDealt"] > allocate_model(devastating)["damageDealt"]
