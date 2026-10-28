"""The discrete allocation stage: what one shooting or fighting unit's attacks
do to the models of the target unit, as an exact distribution rather than an
expected value.

Each attack that gets through deals its Damage to one model; damage beyond
that model's remaining wounds is lost, and an already damaged model takes the
next attack. Feel No Pain rolls once for each wound that would be lost.
Devastating Wounds mortal wounds are inflicted after all normal damage and
also damage at most one model each, the rest being lost.

The state is (models alive, wounds left on the damaged model, zeroing uses
left). Event counts come from the exact joint distribution of normal and
mortal damage events per attack, so Sustained Hits, Lethal Hits and
Devastating Wounds keep their correlation within an attack.

A damage-zeroing defence changes an unsaved attack's Damage to 0 before it is
rolled. Every normal damage event has the same Damage distribution, so the
defender spends a use on the first event it can: for this activation no later
choice does better. Mortal-wound events are not attacks with a Damage
characteristic and are never zeroed.

Python mirror of ``tools/src/cruncher/allocation.ts``. Accumulation order
mirrors the TS loops so the float results match.
"""

from __future__ import annotations

import math
from typing import Any, Literal, NotRequired, TypedDict

from wh40kdc.cruncher.damage_roll import quantity_distribution
from wh40kdc.cruncher.engine import AttackModel, EngineInput, crunch_model
from wh40kdc.data.dataset import Dataset

#: The largest event table the exact computation builds, measured as attacks x
#: table rows x table columns. Past it the allocation is refused rather than
#: approximated.
MAX_EVENT_WORK = 1_000_000

#: Probabilities indexed [normal events][mortal events].
Joint = list[list[float]]


class AllocationOutput(TypedDict):
    #: Expected wounds removed from the target unit.
    damageDealt: float
    modelsDestroyed: float
    #: Probability of each number of models destroyed, from 0 to the unit's size.
    modelsDestroyedDistribution: list[float]


class DamageZeroing(TypedDict):
    """A defence that changes the Damage of an attack allocated to the target
    to 0, ``uses`` times: shared by the unit, or available to each model
    separately."""

    uses: int
    per: Literal["unit", "model"]


class AllocationDefences(TypedDict):
    """Defender options that act on individual attacks, which only the
    allocation stage sees."""

    zeroing: NotRequired[DamageZeroing]


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


def _trim(table: Joint) -> Joint:
    """``table`` without trailing all-zero rows and columns; convolution skips
    zeros, so the nonzero values are unchanged."""
    rows = len(table)
    while rows > 1 and all(p == 0 for p in table[rows - 1]):
        rows -= 1
    columns = len(table[0])
    while columns > 1 and all(row[columns - 1] == 0 for row in table[:rows]):
        columns -= 1
    return [row[:columns] for row in table[:rows]]


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
    """Distribution of one attack's normal damage events and its second kind of
    event: mortal wounds with Devastating Wounds, otherwise unsaved critical
    wounds when they have their own save and Damage (``criticalWound``), else
    none."""
    wound = model["wound"]
    hit = model["hit"]
    devastating = model["devastating"]
    critical = model.get("criticalWound")
    split = critical is not None and not devastating
    normal_wound = wound["pass"] - wound["crit"]
    to_main = (normal_wound + (0 if devastating or split else wound["crit"])) * model["unsaved"]
    if devastating:
        to_second = wound["crit"]
    elif split:
        to_second = wound["crit"] * critical["unsaved"]  # type: ignore[index]
    else:
        to_second = 0
    wound_roll: Joint = [[1 - to_main - to_second, to_second], [to_main, 0.0]]
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


def _wounds_lost(damage_roll: list[Any], lost: float) -> list[float]:
    """Distribution of wounds one event removes before the damaged model's
    remaining wounds cap it: each wound is lost with probability ``lost``."""
    out: list[float] = []
    for outcome in damage_roll:
        damage = _integral(outcome["value"], "Damage")
        for removed in range(damage + 1):
            if removed == len(out):
                out.append(0.0)
            out[removed] += outcome["probability"] * _binomial(damage, removed, lost)
    return out


def allocate(
    input: EngineInput,
    dataset: Dataset | None = None,
    defences: AllocationDefences | None = None,
) -> AllocationOutput:
    """Exact allocation of an attacking unit's damage into the target's models.
    Without an explicit ``defences["zeroing"]``, the input's ``damage-zeroing``
    buffs supply it."""
    output, model = crunch_model(input, dataset)
    if defences is not None and defences.get("zeroing") is not None:
        return allocate_model(model, defences)
    zeroing = output["resolved"]["damageZeroing"]
    if zeroing["unit"] > 0 and zeroing["model"] > 0:
        raise ValueError(
            "allocate: unit-wide and per-model damage zeroing together are not modelled"
        )
    if zeroing["unit"] > 0:
        return allocate_model(model, {"zeroing": {"uses": zeroing["unit"], "per": "unit"}})
    if zeroing["model"] > 0:
        return allocate_model(model, {"zeroing": {"uses": zeroing["model"], "per": "model"}})
    return allocate_model(model)


def _zeroing_of(defences: AllocationDefences | None) -> DamageZeroing:
    zeroing: DamageZeroing = (defences or {}).get("zeroing") or {"uses": 0, "per": "unit"}
    if zeroing.get("per") not in ("unit", "model"):
        raise ValueError(
            f'allocate: zeroing per must be "unit" or "model", got {zeroing.get("per")}'
        )
    if _integral(zeroing.get("uses"), "zeroing uses") < 0:
        raise ValueError(f"allocate: zeroing uses must not be negative, got {zeroing['uses']}")
    return zeroing


def _bounded_per_attack(model: AttackModel) -> tuple[Joint, dict[int, float], int]:
    """One attack's event table, the attack-count distribution and the largest
    count, refused past the exact bound."""
    per = _trim(_per_attack(model))
    counts = _attack_counts(model)
    most = max(counts.keys())
    work = most * (most * (len(per) - 1) + 1) * (most * (len(per[0]) - 1) + 1)
    if work > MAX_EVENT_WORK:
        raise ValueError(
            f"allocate: {most} attacks exceed the exact allocation bound "
            f"(work {work} > {MAX_EVENT_WORK})"
        )
    return per, counts, most


def _events(per: Joint, counts: dict[int, float], most: int) -> Joint:
    """Joint distribution of the unit's total normal and mortal damage events."""
    total: Joint = [[0.0]]
    acc: Joint = [[1.0]]
    for attacks in range(most + 1):
        weight = counts.get(attacks, 0.0)
        if weight > 0:
            total = _add(total, acc, weight)
        if attacks < most:
            acc = _convolve(acc, per)
    return total


def allocate_model(
    model: AttackModel, defences: AllocationDefences | None = None
) -> AllocationOutput:
    """Exact allocation of the damage an :class:`AttackModel` describes."""
    models = _integral(model["modelCount"], "target models")
    wounds = _integral(model["wounds"], "target Wounds")
    zeroing = _zeroing_of(defences)
    if models == 0 or wounds == 0:
        return {"damageDealt": 0.0, "modelsDestroyed": 0.0, "modelsDestroyedDistribution": [1.0]}
    uses = int(zeroing["uses"]) + 1
    per_model = zeroing["per"] == "model"
    cells = models * wounds
    dead = cells * uses

    # Alive state (m, w, u) is ((m - 1) * wounds + (w - 1)) * uses + u; `dead` absorbs.
    def step(state: list[float], removed: list[float], zeroable: bool) -> list[float]:
        out = [0.0] * (dead + 1)
        out[dead] = state[dead]
        for id_ in range(dead):
            p = state[id_]
            if p == 0:
                continue
            cell = id_ // uses
            left = cell % wounds + 1
            unused = id_ % uses
            if zeroable and unused > 0:
                out[id_ - 1] += p
                continue
            alive = cell // wounds + 1
            refilled = uses - 1 if per_model else unused
            for amount, q in enumerate(removed):
                if q == 0:
                    continue
                if amount == 0:
                    nxt = id_
                elif amount < left:
                    nxt = id_ - amount * uses
                elif alive == 1:
                    nxt = dead
                else:
                    nxt = ((alive - 2) * wounds + (wounds - 1)) * uses + refilled
                out[nxt] += p * q
        return out

    per, counts, most = _bounded_per_attack(model)
    normal = _wounds_lost(model["damage"], model["woundLost"])
    state = [0.0] * (dead + 1)
    state[dead - 1] = 1.0
    final = [0.0] * (dead + 1)
    critical = model.get("criticalWound")
    if critical is not None and not model["devastating"]:
        # Critical wounds with their own save and Damage land in attack order, so the
        # allocation steps one attack at a time: each attack's normal wounds, then its
        # critical ones.
        critical_lost = _wounds_lost(critical["damage"], model["woundLost"])
        for attacks in range(most + 1):
            weight = counts.get(attacks, 0.0)
            if weight > 0:
                for id_, q in enumerate(state):
                    final[id_] += weight * q
            if attacks == most:
                break
            nxt = [0.0] * (dead + 1)
            after_normal = state
            for normal_events, row in enumerate(per):
                if normal_events > 0:
                    after_normal = step(after_normal, normal, True)
                after = after_normal
                for critical_events, p in enumerate(row):
                    if critical_events > 0:
                        after = step(after, critical_lost, True)
                    if p > 0:
                        for id_, q in enumerate(after):
                            nxt[id_] += p * q
            state = nxt
        return _summarise(final, models, wounds, uses, cells, dead)
    events = _events(per, counts, most)
    # Devastating Wounds' mortal wounds deal a critical wound's own Damage when it has one.
    mortal_roll = critical["damage"] if critical is not None else model["damage"]
    mortal = _wounds_lost(mortal_roll, model["mortalWoundLost"])
    for normal_events, row in enumerate(events):
        if normal_events > 0:
            state = step(state, normal, True)
        if not any(p > 0 for p in row):
            continue
        after = state
        for mortal_events, p in enumerate(row):
            if mortal_events > 0:
                after = step(after, mortal, False)
            if p > 0:
                for id_, q in enumerate(after):
                    final[id_] += p * q

    return _summarise(final, models, wounds, uses, cells, dead)


def _summarise(
    final: list[float], models: int, wounds: int, uses: int, cells: int, dead: int
) -> AllocationOutput:
    """Expected wounds removed, expected models destroyed and their distribution."""
    destroyed = [0.0] * (models + 1)
    damage_dealt = 0.0
    for id_, p in enumerate(final):
        cell = id_ // uses
        alive = 0 if id_ == dead else cell // wounds + 1
        remaining = 0 if id_ == dead else (alive - 1) * wounds + cell % wounds + 1
        destroyed[models - alive] += p
        damage_dealt += p * (cells - remaining)
    models_destroyed = 0.0
    for count, p in enumerate(destroyed):
        models_destroyed += p * count
    return {
        "damageDealt": damage_dealt,
        "modelsDestroyed": models_destroyed,
        "modelsDestroyedDistribution": destroyed,
    }
