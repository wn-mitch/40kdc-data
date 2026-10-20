"""Per-attack Damage-roll distribution. Mirrors ``tools/test/cruncher-damage-roll.test.ts``."""

from __future__ import annotations

from typing import Any

import pytest

from wh40kdc.cruncher.damage_roll import damage_roll


def _roll(stat: Any, **overrides: Any) -> Any:
    args: dict[str, Any] = {"bonus": 0, "modifier": 0, "reduction": 0}
    args.update(overrides)
    return damage_roll(stat=stat, **args)


def test_keeps_the_printed_mean_when_nothing_clamps() -> None:
    assert _roll("D6+1")["expected"] == pytest.approx(4.5, abs=1e-12)
    assert _roll("2D3")["expected"] == pytest.approx(4, abs=1e-12)
    assert _roll(3)["expected"] == 3


def test_floors_each_roll_at_zero_not_the_mean() -> None:
    # D3-2 rolls 0, 0, 1; the mean-then-floor shortcut gives 0.
    assert _roll("D3", modifier=-2)["expected"] == pytest.approx(1 / 3, abs=1e-12)


def test_applies_reduction_to_each_roll_with_a_minimum_of_one() -> None:
    assert _roll("D6", reduction=3)["expected"] == pytest.approx(1.5, abs=1e-12)
    # A fixed 0 still rises to 1 under active reduction.
    assert _roll(1, modifier=-1, reduction=1)["expected"] == 1


def test_rerolls_only_totals_whose_final_damage_is_below_the_fresh_mean() -> None:
    rolled = _roll("D6", reroll="all-failures")
    assert rolled["expected"] == pytest.approx(4.25, abs=1e-12)
    assert rolled["rerollUsed"] is True
    total = sum(outcome["probability"] for outcome in rolled["distribution"])
    assert total == pytest.approx(1, abs=1e-12)


def test_limits_a_ones_reroll_to_a_single_die_showing_one() -> None:
    assert _roll("D6", reroll="ones")["expected"] == pytest.approx(3.5 + 2.5 / 6, abs=1e-12)
    # A 2D6 total can never be 1.
    pair = _roll("2D6", reroll="ones")
    assert pair["expected"] == pytest.approx(7, abs=1e-12)
    assert pair["rerollUsed"] is False


def test_never_rerolls_a_fixed_characteristic_or_a_roll_already_at_the_clamp() -> None:
    fixed = _roll(2, reroll="all-failures")
    assert (fixed["expected"], fixed["rerollUsed"]) == (2, False)
    # D3 under reduction 3 is always 1: rerolling cannot help.
    clamped = _roll("D3", reduction=3, reroll="all-failures")
    assert (clamped["expected"], clamped["rerollUsed"]) == (1, False)


def test_rejects_an_unparseable_characteristic() -> None:
    with pytest.raises(ValueError):
        _roll("D")
    with pytest.raises(ValueError):
        _roll("")
