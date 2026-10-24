"""The discrete allocation stage: what one shooting or fighting unit's attacks
do to the models of the target unit, as an exact distribution rather than an
expected value.

Each attack that gets through deals its Damage to one model; damage beyond
that model's remaining wounds is lost, and an already damaged model takes the
next attack. Feel No Pain rolls once for each wound that would be lost.
Devastating Wounds mortal wounds are inflicted after all normal damage and
also damage at most one model each, the rest being lost.

The state is (models alive, wounds left on the damaged model). Event counts
come from the exact joint distribution of normal and mortal damage events per
attack, so Sustained Hits, Lethal Hits and Devastating Wounds keep their
correlation within an attack.

Python mirror of ``tools/src/cruncher/allocation.ts``. Accumulation order
mirrors the TS loops so the float results match.
"""

from __future__ import annotations

import math
from typing import Any, TypedDict

from wh40kdc.cruncher.damage_roll import quantity_distribution
from wh40kdc.cruncher.engine import AttackModel, EngineInput, crunch_model
from wh40kdc.data.dataset import Dataset

#: Probabilities indexed [normal events][mortal events].
Joint = list[list[float]]


class AllocationOutput(TypedDict):
    #: Expected wounds removed from the target unit.
    damageDealt: float
    modelsDestroyed: float
    #: Probability of each number of models destroyed, from 0 to the unit's size.
    modelsDestroyedDistribution: list[float]


def _joint(rows: int, columns: int) -> Joint:
    return [[0.0] * columns for _ in range(rows)]


def _convolve(left: Joint, right: Joint) -> Joint:
    out = _joint(len(left) + len(right) - 1, len(left[0]) + len(right[0]) - 1)
    for k, row in enumerate(left):
        for j, p in enumerate(row):
            if p == 0:
                continue
            for k2, other in enumerate(right):
                for j2, q in enumerate(other):
                    if q != 0:
                        out[k + k2][j + j2] += p * q
    return out


def _power(base: Joint, times: int) -> Joint:
    out: Joint = [[1.0]]
    for _ in range(times):
        out = _convolve(out, base)
    return out


def _add(into: Joint, source: Joint, weight: float) -> Joint:
    """``into + weight * source``, grown to the larger shape."""
    grown = _joint(max(len(into), len(source)), max(len(into[0]), len(source[0])))
    for k, row in enumerate(into):
        for j, p in enumerate(row):
            grown[k][j] += p
    for k, row in enumerate(source):
        for j, p in enumerate(row):
            grown[k][j] += weight * p
    return grown


def _integral(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"allocate: {what} must be a whole number, got {value}")
    if isinstance(value, float) and not value.is_integer():
        raise ValueError(f"allocate: {what} must be a whole number, got {value}")
    return int(value)


def _optional_distribution(stat: Any) -> list[tuple[float, float]]:
    return [(0, 1.0)] if stat is None else quantity_distribution(stat)


def _per_attack(model: AttackModel) -> Joint:
    """Distribution of one attack's normal and mortal damage events."""
    wound = model["wound"]
    hit = model["hit"]
    devastating = model["devastating"]
    normal_wound = wound["pass"] - wound["crit"]
    to_main = (normal_wound + (0 if devastating else wound["crit"])) * model["unsaved"]
    to_mortal = wound["crit"] if devastating else 0
    wound_roll: Joint = [[1 - to_main - to_mortal, to_mortal], [to_main, 0.0]]
    auto_wound: Joint = [[1 - model["unsaved"]], [model["unsaved"]]]
    normal_hit = 1 if model["torrent"] else hit["pass"] - hit["crit"]
    crit_hit = 0 if model["torrent"] else hit["crit"]
    out = _joint(1, 1)
    out[0][0] = 1 - normal_hit - crit_hit
    result = _add(out, wound_roll, normal_hit)
    if crit_hit > 0:
        first = auto_wound if model["lethal"] else wound_roll
        for count, probability in _optional_distribution(model["sustainedStat"]):
            sustained = _power(wound_roll, _integral(count, "Sustained Hits"))
            result = _add(result, _convolve(first, sustained), crit_hit * probability)
    return result


def _attack_counts(model: AttackModel) -> dict[int, float]:
    """Distribution of the unit's total attacks: each model rolls its own Attacks."""
    one: dict[int, float] = {}
    rapid = _optional_distribution(model["rapidFireStat"])
    for attacks, p in quantity_distribution(model["attacksStat"]):
        for extra, q in rapid:
            total = max(0, _integral(attacks + extra + model["attacksBonus"], "Attacks"))
            one[total] = one.get(total, 0.0) + p * q
    all_: dict[int, float] = {0: 1.0}
    for _ in range(_integral(model["modelsFiring"], "models firing")):
        nxt: dict[int, float] = {}
        for total, p in all_.items():
            for count, q in one.items():
                nxt[total + count] = nxt.get(total + count, 0.0) + p * q
        all_ = nxt
    return all_


def _binomial(trials: int, successes: int, p: float) -> float:
    coefficient = 1.0
    for index in range(successes):
        coefficient = coefficient * (trials - index) / (index + 1)
    return coefficient * math.pow(p, successes) * math.pow(1 - p, trials - successes)


def _wounds_lost(model: AttackModel, lost: float) -> list[float]:
    """Distribution of wounds one event removes before the damaged model's
    remaining wounds cap it: each wound is lost with probability ``lost``."""
    out: list[float] = []
    for outcome in model["damage"]:
        damage = _integral(outcome["value"], "Damage")
        for removed in range(damage + 1):
            if removed == len(out):
                out.append(0.0)
            out[removed] += outcome["probability"] * _binomial(damage, removed, lost)
    return out


def allocate(input: EngineInput, dataset: Dataset | None = None) -> AllocationOutput:
    """Exact allocation of an attacking unit's damage into the target's models."""
    return allocate_model(crunch_model(input, dataset)[1])


def _events(model: AttackModel) -> Joint:
    """Joint distribution of the unit's total normal and mortal damage events."""
    per = _per_attack(model)
    total: Joint = [[0.0]]
    acc: Joint = [[1.0]]
    counts = _attack_counts(model)
    most = max(counts.keys())
    for attacks in range(most + 1):
        weight = counts.get(attacks, 0.0)
        if weight > 0:
            total = _add(total, acc, weight)
        if attacks < most:
            acc = _convolve(acc, per)
    return total


def allocate_model(model: AttackModel) -> AllocationOutput:
    """Exact allocation of the damage an :class:`AttackModel` describes."""
    models = _integral(model["modelCount"], "target models")
    wounds = _integral(model["wounds"], "target Wounds")
    if models == 0 or wounds == 0:
        return {"damageDealt": 0.0, "modelsDestroyed": 0.0, "modelsDestroyedDistribution": [1.0]}
    dead = models * wounds

    # Alive state (m, w) is (m - 1) * wounds + (w - 1); `dead` absorbs.
    def step(state: list[float], removed: list[float]) -> list[float]:
        out = [0.0] * (dead + 1)
        out[dead] = state[dead]
        for id_ in range(dead):
            p = state[id_]
            if p == 0:
                continue
            alive = id_ // wounds + 1
            left = id_ % wounds + 1
            for amount, q in enumerate(removed):
                if q == 0:
                    continue
                if amount == 0:
                    nxt = id_
                elif amount < left:
                    nxt = id_ - amount
                elif alive == 1:
                    nxt = dead
                else:
                    nxt = (alive - 2) * wounds + (wounds - 1)
                out[nxt] += p * q
        return out

    events = _events(model)
    normal = _wounds_lost(model, model["woundLost"])
    mortal = _wounds_lost(model, model["mortalWoundLost"])
    state = [0.0] * (dead + 1)
    state[(models - 1) * wounds + (wounds - 1)] = 1.0
    final = [0.0] * (dead + 1)
    for normal_events, row in enumerate(events):
        if normal_events > 0:
            state = step(state, normal)
        if not any(p > 0 for p in row):
            continue
        after = state
        for mortal_events, p in enumerate(row):
            if mortal_events > 0:
                after = step(after, mortal)
            if p > 0:
                for id_, q in enumerate(after):
                    final[id_] += p * q

    destroyed = [0.0] * (models + 1)
    damage_dealt = 0.0
    for id_, p in enumerate(final):
        alive = 0 if id_ == dead else id_ // wounds + 1
        remaining = 0 if id_ == dead else (alive - 1) * wounds + id_ % wounds + 1
        destroyed[models - alive] += p
        damage_dealt += p * (dead - remaining)
    models_destroyed = 0.0
    for count, p in enumerate(destroyed):
        models_destroyed += p * count
    return {
        "damageDealt": damage_dealt,
        "modelsDestroyed": models_destroyed,
        "modelsDestroyedDistribution": destroyed,
    }
