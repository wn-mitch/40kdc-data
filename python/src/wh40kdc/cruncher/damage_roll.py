"""Per-attack damage as an exact distribution over the Damage roll.

A Damage characteristic is either fixed (``3``) or a dice expression (``D6``,
``2D3``, ``D6+1``). Each rolled total passes through the same transform the
engine applies to every attack: add Melta and the damage modifier, floor at
0, then subtract damage reduction to a minimum of 1 when reduction is
active. The expectation is taken over that transformed value, so a floor or
a reduction acts on each roll rather than on the mean.

Python mirror of ``tools/src/cruncher/damage-roll.ts``. Accumulation order
mirrors the TS loops so the float results match bit-for-bit.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Literal, TypedDict

DamageReroll = Literal["ones", "all-failures"]

_DICE_RE = re.compile(r"^(\d*)D(\d+)([+-]\d+)?$", re.IGNORECASE)


class DamageOutcome(TypedDict):
    value: float
    probability: float


class DamageRoll(TypedDict):
    #: Probability of each final per-attack damage value, ascending by value.
    distribution: list[DamageOutcome]
    expected: float
    #: Whether the reroll permission changed any outcome.
    rerollUsed: bool


def _parse_damage(stat: Any) -> float | tuple[int, int, int]:
    """A fixed number, or a ``(count, die, offset)`` dice expression."""
    if isinstance(stat, (int, float)) and not isinstance(stat, bool):
        if math.isfinite(stat):
            return float(stat)
        raise ValueError(f"damage_roll: unresolved quantity {json.dumps(stat)}")
    if not isinstance(stat, str):
        raise ValueError(f"damage_roll: unresolved quantity {json.dumps(stat)}")
    trimmed = stat.strip()
    if trimmed == "":
        raise ValueError("damage_roll: empty quantity")
    try:
        as_number = float(trimmed)
        if math.isfinite(as_number):
            return as_number
    except ValueError:
        pass
    match = _DICE_RE.match(trimmed)
    if not match:
        raise ValueError(f'damage_roll: cannot parse "{stat}"')
    count = 1 if match.group(1) == "" else int(match.group(1))
    die = int(match.group(2))
    offset = int(match.group(3)) if match.group(3) else 0
    return (count, die, offset)


def quantity_distribution(stat: Any) -> list[tuple[float, float]]:
    """Exact distribution of a quantity characteristic (a number or a dice
    expression such as ``D6+1``), as (value, probability) ascending by value."""
    parsed = _parse_damage(stat)
    if not isinstance(parsed, tuple):
        return [(parsed, 1.0)]
    count, die, offset = parsed
    return [(total + offset, probability) for total, probability in _dice_totals(count, die)]


def _dice_totals(count: int, die: int) -> list[tuple[int, float]]:
    """Distribution of the summed dice, as (total, probability) ascending by total."""
    totals: dict[int, float] = {0: 1.0}
    for _ in range(count):
        nxt: dict[int, float] = {}
        for total, probability in totals.items():
            for face in range(1, die + 1):
                nxt[total + face] = nxt.get(total + face, 0.0) + probability / die
        totals = nxt
    return sorted(totals.items(), key=lambda item: item[0])


def damage_roll(
    *,
    stat: Any,
    bonus: float,
    modifier: float,
    reduction: float,
    reroll: DamageReroll | None = None,
) -> DamageRoll:
    """Exact per-attack damage.

    ``stat`` is the profile's printed D, ``bonus`` the flat post-roll bonus
    (Melta at half range), ``modifier`` the summed damage modifier, and
    ``reduction`` the defender damage reduction (0 when inactive).

    A reroll replaces a roll only when the replacement's expected final damage
    exceeds the kept roll's, which is the optimal one-shot policy. ``ones``
    permits rerolling a dice total of 1, so it can only act on a single die;
    ``all-failures`` permits rerolling any total.
    """

    def final(rolled: float) -> float:
        before_reduction = max(0, rolled + bonus + modifier)
        return max(1, before_reduction - reduction) if reduction > 0 else before_reduction

    parsed = _parse_damage(stat)
    if not isinstance(parsed, tuple):
        value = final(parsed)
        return {
            "distribution": [{"value": value, "probability": 1}],
            "expected": value,
            "rerollUsed": False,
        }
    count, die, offset = parsed
    totals = _dice_totals(count, die)
    fresh = 0.0
    for total, probability in totals:
        fresh += probability * final(total + offset)
    outcomes: dict[float, float] = {}
    reroll_used = False
    for total, probability in totals:
        kept = final(total + offset)
        eligible = reroll == "all-failures" or (reroll == "ones" and total == 1)
        if eligible and kept < fresh:
            reroll_used = True
            for again, again_probability in totals:
                value = final(again + offset)
                outcomes[value] = outcomes.get(value, 0.0) + probability * again_probability
        else:
            outcomes[kept] = outcomes.get(kept, 0.0) + probability
    distribution: list[DamageOutcome] = [
        {"value": value, "probability": probability}
        for value, probability in sorted(outcomes.items(), key=lambda item: item[0])
    ]
    expected = 0.0
    for outcome in distribution:
        expected += outcome["value"] * outcome["probability"]
    return {"distribution": distribution, "expected": expected, "rerollUsed": reroll_used}


def one_damage_reroll_gain(distribution: list[DamageOutcome], rolls: float) -> float:
    """Expected damage a "re-roll one Damage roll" adds over ``rolls`` Damage
    rolls of ``distribution`` (a fresh roll's final damage, ascending by value):
    the player re-rolls the lowest roll when it is below a fresh roll's mean.
    Over a whole number of rolls the lowest is ``v`` with probability
    S(v)^rolls - S(next)^rolls, where S(v) is the chance a roll is at least
    ``v``; a count the engine carries as an expectation is read between the
    whole counts either side (engine.py ``between_whole_pools``).
    """
    if rolls <= 0:
        return 0.0
    mean = 0.0
    for outcome in distribution:
        mean += outcome["value"] * outcome["probability"]

    def at_whole(count: int) -> float:
        gain = 0.0
        at_least = 1.0
        for outcome in distribution:
            value = outcome["value"]
            above = max(0.0, at_least - outcome["probability"])
            if value < mean:
                gain += (math.pow(at_least, count) - math.pow(above, count)) * (mean - value)
            at_least = above
        return gain

    low = math.floor(rolls)
    below = at_whole(low)
    return below if rolls == low else below + (rolls - low) * (at_whole(low + 1) - below)
