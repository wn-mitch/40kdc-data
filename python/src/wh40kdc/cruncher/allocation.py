"""The discrete allocation stage: what one shooting or fighting unit's attacks
do to the models of the target unit, as an exact distribution rather than an
expected value.

Each attack that gets through deals its Damage to one model; damage beyond
that model's remaining wounds is lost, and an already damaged model takes the
next attack. Feel No Pain rolls once for each wound that would be lost.
Mortal wounds an ability inflicts on the attack's rolls come after all normal
damage, one wound at a time, each carrying over to the next model. Devastating
Wounds mortal wounds come last and damage at most one model each, the rest
being lost.

The state is (models alive, wounds left on the damaged model, zeroing uses
left). Event counts come from the exact joint distribution of normal damage
events, mortal-wound events and ability mortal wounds per attack, so Sustained
Hits, Lethal Hits, Devastating Wounds and mortal wounds on a roll keep their
correlation within an attack.

A damage-zeroing defence changes an unsaved attack's Damage to 0 before it is
rolled. Every normal damage event has the same Damage distribution, so the
defender spends a use on the first event it can: for this activation no later
choice does better. Mortal-wound events are not attacks with a Damage
characteristic and are never zeroed.

Python mirror of ``tools/src/cruncher/allocation.ts``. Accumulation order
mirrors the TS loops so the float results match.
"""

from __future__ import annotations

import json
import math
from typing import Any, Literal, NotRequired, TypedDict

from wh40kdc.cruncher.damage_roll import damage_roll, quantity_distribution
from wh40kdc.cruncher.engine import AttackModel, EngineInput, crunch_model
from wh40kdc.data.dataset import Dataset

#: The largest event table the exact computation builds, measured as attacks x
#: table rows x table columns x table depth. Past it the allocation is refused rather than
#: approximated.
MAX_EVENT_WORK = 1_000_000

#: Probabilities indexed [normal events][mortal events][ability mortal wounds].
Joint = list[list[list[float]]]

#: States by the ability mortal wounds still to inflict: layer k waits on k of them.
Layers = list[list[float]]


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


def _joint(rows: int, columns: int, depth: int = 1) -> Joint:
    return [[[0.0] * depth for _ in range(columns)] for _ in range(rows)]


def _convolve(left: Joint, right: Joint) -> Joint:
    out = _joint(
        len(left) + len(right) - 1,
        len(left[0]) + len(right[0]) - 1,
        len(left[0][0]) + len(right[0][0]) - 1,
    )
    for k, row in enumerate(left):
        for j, cell in enumerate(row):
            for a, p in enumerate(cell):
                if p == 0:
                    continue
                for k2, other in enumerate(right):
                    for j2, cell2 in enumerate(other):
                        for a2, q in enumerate(cell2):
                            if q != 0:
                                out[k + k2][j + j2][a + a2] += p * q
    return out


def _trim(table: Joint) -> Joint:
    """``table`` without trailing all-zero rows, columns and depth; convolution
    skips zeros, so the nonzero values are unchanged."""
    rows = len(table)
    while rows > 1 and all(p == 0 for cell in table[rows - 1] for p in cell):
        rows -= 1
    columns = len(table[0])
    while columns > 1 and all(p == 0 for row in table[:rows] for p in row[columns - 1]):
        columns -= 1
    depth = len(table[0][0])
    while depth > 1 and all(cell[depth - 1] == 0 for row in table[:rows] for cell in row[:columns]):
        depth -= 1
    return [[cell[:depth] for cell in row[:columns]] for row in table[:rows]]


def _power(base: Joint, times: int) -> Joint:
    out: Joint = [[[1.0]]]
    for _ in range(times):
        out = _convolve(out, base)
    return out


def _add(into: Joint, source: Joint, weight: float) -> Joint:
    """``into + weight * source``, grown to the larger shape."""
    grown = _joint(
        max(len(into), len(source)),
        max(len(into[0]), len(source[0])),
        max(len(into[0][0]), len(source[0][0])),
    )
    for k, row in enumerate(into):
        for j, cell in enumerate(row):
            for a, p in enumerate(cell):
                grown[k][j][a] += p
    for k, row in enumerate(source):
        for j, cell in enumerate(row):
            for a, p in enumerate(cell):
                grown[k][j][a] += weight * p
    return grown


def _shift(table: Joint, by: int) -> Joint:
    """``table`` with every ability mortal-wound count raised by ``by``."""
    if by == 0:
        return table
    return [[[0.0] * by + cell for cell in row] for row in table]


def _integral(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"allocate: {what} must be a whole number, got {value}")
    if isinstance(value, float) and not value.is_integer():
        raise ValueError(f"allocate: {what} must be a whole number, got {value}")
    return int(value)


def _optional_distribution(stat: Any) -> list[tuple[float, float]]:
    return [(0, 1.0)] if stat is None else quantity_distribution(stat)


def _roll_mortals_of(model: AttackModel) -> dict[str, int]:
    """The mortal wounds an attack's rolls inflict, each count whole and not negative."""
    out: dict[str, int] = {}
    for key, count in model["rollMortals"].items():
        whole = _integral(count, f"mortal wounds on a roll ({key})")
        if whole < 0:
            raise ValueError(
                f"allocate: mortal wounds on a roll ({key}) must not be negative, got {count}"
            )
        out[key] = whole
    return out


def _per_attack(model: AttackModel) -> Joint:
    """Distribution of one attack's normal damage events, its second kind of
    event (mortal wounds with Devastating Wounds, otherwise unsaved critical
    wounds when they have their own save and Damage (``criticalWound``), else
    none) and the mortal wounds its rolls inflict."""
    mortals = _roll_mortals_of(model)
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
    unsaved = model["unsaved"]

    def wound_roll(extra: int) -> Joint:
        # `extra`: the mortal wounds a critical wound inflicts beyond every critical wound's.
        on_wound = mortals["wound"]
        on_critical = on_wound + mortals["criticalWound"] + extra
        if on_wound == 0 and on_critical == 0:
            return [[[1 - to_main - to_second], [to_second]], [[to_main], [0.0]]]
        out = _joint(2, 2, max(on_wound, on_critical) + 1)
        crit_unsaved: float
        if devastating:
            crit_unsaved, crit_event = 1.0, out[0][1]
        elif split:
            crit_unsaved, crit_event = critical["unsaved"], out[0][1]  # type: ignore[index]
        else:
            crit_unsaved, crit_event = unsaved, out[1][0]
        out[0][0][0] += 1 - wound["pass"]
        out[1][0][on_wound] += normal_wound * unsaved
        out[0][0][on_wound] += normal_wound * (1 - unsaved)
        crit_event[on_critical] += wound["crit"] * crit_unsaved
        out[0][0][on_critical] += wound["crit"] * (1 - crit_unsaved)
        return out

    auto_wound = _shift([[[1 - unsaved]], [[unsaved]]], mortals["wound"])
    normal_hit = 1 if model["torrent"] else hit["pass"] - hit["crit"]
    crit_hit = 0 if model["torrent"] else hit["crit"]
    out = _joint(1, 1)
    out[0][0][0] = 1 - normal_hit - crit_hit
    result = _add(out, _shift(wound_roll(0), mortals["hit"]), normal_hit)
    if crit_hit > 0:
        first = auto_wound if model["lethal"] else wound_roll(mortals["criticalWoundOfCriticalHit"])
        plain = wound_roll(0)
        for count, probability in _optional_distribution(model["sustainedStat"]):
            sustained = _power(plain, _integral(count, "Sustained Hits"))
            hits = _shift(_convolve(first, sustained), mortals["hit"] + mortals["criticalHit"])
            result = _add(result, hits, crit_hit * probability)
    return result


def _attack_counts(model: AttackModel) -> dict[int, float]:
    """Distribution of the unit's total attacks: each model rolls its own Attacks."""
    one: dict[int, float] = {}
    rapid = _optional_distribution(model["rapidFireStat"])
    reroll = model.get("attacksReroll")
    rolled: list[tuple[float, float]] = (
        [
            (o["value"], o["probability"])
            for o in damage_roll(
                stat=model["attacksStat"], bonus=0, modifier=0, reduction=0, reroll=reroll
            )["distribution"]
        ]
        if reroll
        else list(quantity_distribution(model["attacksStat"]))
    )
    for attacks, p in rolled:
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

    def span(size: int) -> int:
        return most * (size - 1) + 1

    work = most * span(len(per)) * span(len(per[0])) * span(len(per[0][0]))
    if work > MAX_EVENT_WORK:
        raise ValueError(
            f"allocate: {most} attacks exceed the exact allocation bound "
            f"(work {work} > {MAX_EVENT_WORK})"
        )
    return per, counts, most


def _events(per: Joint, counts: dict[int, float], most: int) -> Joint:
    """Joint distribution of the unit's total normal damage events, mortal-wound
    events and ability mortal wounds."""
    total: Joint = [[[0.0]]]
    acc: Joint = [[[1.0]]]
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
    out, _ = _summarise(*_allocate_from(model, _zeroing_of(defences)))
    return out


def _allocate_from(
    model: AttackModel, zeroing: DamageZeroing, start: list[float] | None = None
) -> tuple[list[float], int, int, int]:
    """One line's attacks allocated into the target, starting from ``start`` (a
    state distribution from an earlier line), else from the unit at full
    strength with every zeroing use left. Returns the final state distribution
    and its geometry: (final, models, wounds, uses)."""
    if model.get("unmodelled"):
        raise ValueError(
            f"allocate: {', '.join(model['unmodelled'])} not modelled by exact allocation"
        )
    models = _integral(model["modelCount"], "target models")
    wounds = _integral(model["wounds"], "target Wounds")
    uses = int(zeroing["uses"]) + 1
    if models == 0 or wounds == 0:
        return [1.0], 0, 1, uses
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
    mortals = _roll_mortals_of(model)
    normal = _wounds_lost(model["damage"], model["woundLost"])
    # An ability mortal wound: one Damage, rolling the mortal-wound Feel No Pain.
    one = _wounds_lost([{"value": 1, "probability": 1.0}], model["mortalWoundLost"])

    def zeros() -> list[float]:
        return [0.0] * (dead + 1)

    state: Layers = [list(start) if start is not None else zeros()]
    if start is None:
        state[0][dead - 1] = 1.0
    pending: Layers = []

    def gather(into: Layers, layers: Layers, weight: float) -> None:
        for k, layer in enumerate(layers):
            while len(into) <= k:
                into.append([])
            if not into[k]:
                into[k] = zeros()
            target = into[k]
            for id_, q in enumerate(layer):
                target[id_] += weight * q

    def step_all(from_: Layers, removed: list[float]) -> Layers:
        return [step(layer, removed, True) for layer in from_]

    def shift_all(from_: Layers, by: int) -> Layers:
        return from_ if by == 0 else [zeros() for _ in range(by)] + from_

    critical = model.get("criticalWound")
    if critical is not None and not model["devastating"]:
        # Critical wounds with their own save and Damage land in the order their hits wound, and
        # a normal and a critical wound of different Damage do not commute: the allocation steps
        # one hit at a time, an attack's critical hit before the extra hits Sustained Hits gives it.
        critical_lost = _wounds_lost(critical["damage"], model["woundLost"])
        to_normal = (model["wound"]["pass"] - model["wound"]["crit"]) * model["unsaved"]
        to_critical = model["wound"]["crit"] * critical["unsaved"]
        normal_hit = 1 if model["torrent"] else model["hit"]["pass"] - model["hit"]["crit"]
        crit_hit = 0 if model["torrent"] else model["hit"]["crit"]
        extras = sorted(
            _optional_distribution(model["sustainedStat"]), key=lambda extra: extra[0]
        )
        extra_counts = [(_integral(count, "Sustained Hits"), p) for count, p in extras]

        def blend(parts: list[tuple[float, Layers]]) -> Layers:
            out: Layers = [zeros()]
            for weight, from_ in parts:
                if weight > 0:
                    gather(out, from_, weight)
            return out

        def wound_roll(from_: Layers, extra: int) -> Layers:
            # `extra`: the mortal wounds a critical wound inflicts beyond every critical wound's.
            on_wound = mortals["wound"]
            on_critical = on_wound + mortals["criticalWound"] + extra
            if on_wound == 0 and on_critical == 0:
                return blend(
                    [
                        (1 - to_normal - to_critical, from_),
                        (to_normal, step_all(from_, normal)),
                        (to_critical, step_all(from_, critical_lost)),
                    ]
                )
            normal_wound = model["wound"]["pass"] - model["wound"]["crit"]
            return blend(
                [
                    (1 - model["wound"]["pass"], from_),
                    (normal_wound * (1 - model["unsaved"]), shift_all(from_, on_wound)),
                    (to_normal, shift_all(step_all(from_, normal), on_wound)),
                    (model["wound"]["crit"] - to_critical, shift_all(from_, on_critical)),
                    (to_critical, shift_all(step_all(from_, critical_lost), on_critical)),
                ]
            )

        def first_wound(from_: Layers) -> Layers:
            # Lethal Hits: the critical hit wounds automatically, a normal wound taking the save.
            if model["lethal"]:
                landed = blend(
                    [(1 - model["unsaved"], from_), (model["unsaved"], step_all(from_, normal))]
                )
                return shift_all(landed, mortals["wound"])
            return wound_roll(from_, mortals["criticalWoundOfCriticalHit"])

        def attack(from_: Layers) -> Layers:
            parts = [
                (1 - normal_hit - crit_hit, from_),
                (normal_hit, shift_all(wound_roll(from_, 0), mortals["hit"])),
            ]
            if crit_hit > 0:
                after = first_wound(shift_all(from_, mortals["hit"] + mortals["criticalHit"]))
                done = 0
                for count, probability in extra_counts:
                    while done < count:
                        after = wound_roll(after, 0)
                        done += 1
                    parts.append((crit_hit * probability, after))
            return blend(parts)

        for attacks in range(most + 1):
            weight = counts.get(attacks, 0.0)
            if weight > 0:
                gather(pending, state, weight)
            if attacks == most:
                break
            state = attack(state)
    else:
        events = _events(per, counts, most)
        # Devastating Wounds' mortal wounds deal a critical wound's own Damage when it has one.
        mortal_roll = critical["damage"] if critical is not None else model["damage"]
        mortal = _wounds_lost(mortal_roll, model["mortalWoundLost"])
        # Normal damage, then the ability's mortal wounds, then the Devastating Wounds events:
        # every ability mortal wound is inflicted here, so the outcome lands in layer 0.
        target = zeros()
        current = state[0]
        for normal_events, row in enumerate(events):
            if normal_events > 0:
                current = step(current, normal, True)
            after_wounds = current
            for count in range(len(row[0])):
                if not any(p > 0 for cell in row for p in cell[count:]):
                    break
                if count > 0:
                    after_wounds = step(after_wounds, one, False)
                after = after_wounds
                for mortal_events, cell in enumerate(row):
                    if mortal_events > 0:
                        after = step(after, mortal, False)
                    p = cell[count]
                    if p > 0:
                        for id_, q in enumerate(after):
                            target[id_] += p * q
        pending.append(target)

    # The ability's mortal wounds the step-by-step path leaves pending, one wound each after all
    # normal damage: layer k takes k of them.
    final = pending[-1] if pending and pending[-1] else zeros()
    for layer in reversed(pending[:-1]):
        final = step(final, one, False)
        for id_, q in enumerate(layer):
            final[id_] += q
    return final, models, wounds, uses


def _summarise(
    final: list[float], models: int, wounds: int, uses: int
) -> tuple[AllocationOutput, list[float]]:
    """Expected wounds removed, expected models destroyed and their
    distribution, plus the distribution of wounds removed. States are by
    (models alive, wounds left, zeroing uses left); see :func:`_allocate_from`."""
    cells = models * wounds
    dead = cells * uses
    destroyed = [0.0] * (models + 1)
    dealt = [0.0] * (cells + 1)
    damage_dealt = 0.0
    for id_, p in enumerate(final):
        cell = id_ // uses
        alive = 0 if id_ == dead else cell // wounds + 1
        remaining = 0 if id_ == dead else (alive - 1) * wounds + cell % wounds + 1
        destroyed[models - alive] += p
        dealt[cells - remaining] += p
        damage_dealt += p * (cells - remaining)
    models_destroyed = 0.0
    for count, p in enumerate(destroyed):
        models_destroyed += p * count
    out: AllocationOutput = {
        "damageDealt": damage_dealt,
        "modelsDestroyed": models_destroyed,
        "modelsDestroyedDistribution": destroyed,
    }
    return out, dealt


class TargetGroup(TypedDict):
    """One allocation group of an attached target unit (rules 05.03 and
    05.04): one for each CHARACTER model, and one for the other models with
    the same W, Sv and InSv."""

    character: bool


class AttachedGroupOutput(TypedDict):
    #: Probability of each number of the group's models destroyed.
    modelsDestroyedDistribution: list[float]


class AttachedAllocationOutput(AllocationOutput):
    """:func:`allocate_attached`'s result: the unit's, and each group's models
    destroyed."""

    #: Probability of each number of wounds removed from the target unit, from 0 to all of them.
    woundsDealtDistribution: list[float]
    #: For each group in the order given, the probability of each number of its models destroyed.
    groups: list[AttachedGroupOutput]


#: The largest number of target states :func:`allocate_attached` tracks before it refuses.
MAX_ATTACHED_STATES = 200_000


def _shared_rolls(model: AttackModel) -> str:
    """The fields of an attack's model that every group of an attached target must share."""
    return json.dumps(
        [
            model["modelsFiring"],
            model["attacksStat"],
            model.get("attacksReroll"),
            model["attacksBonus"],
            model["rapidFireStat"],
            model["torrent"],
            model["hit"]["pass"],
            model["hit"]["crit"],
            model["sustainedStat"],
            model["lethal"],
            model["wound"]["pass"],
            model["wound"]["crit"],
            model["devastating"],
            model["precision"],
            model["rollMortals"],
        ]
    )


def _resolved_zeroing(output: Any) -> DamageZeroing | None:
    """The damage-zeroing defence an engine output's buffs supply, if any."""
    zeroing = output["resolved"]["damageZeroing"]
    if zeroing["unit"] > 0 and zeroing["model"] > 0:
        raise ValueError(
            "allocate: unit-wide and per-model damage zeroing together are not modelled"
        )
    if zeroing["unit"] > 0:
        return {"uses": zeroing["unit"], "per": "unit"}
    if zeroing["model"] > 0:
        return {"uses": zeroing["model"], "per": "model"}
    return None


def allocate_attached(
    lines: list[list[EngineInput]],
    groups: list[TargetGroup],
    dataset: Dataset | None = None,
    defences: AllocationDefences | None = None,
) -> AttachedAllocationOutput:
    """Exact allocation of several attack lines into an attached unit, fired in
    the order given. ``lines[l][g]`` is line ``l`` crunched against group
    ``g``: the same attacker and context, with the group's own profile, model
    count and defensive buffs. Each group must see the same Hit and Wound
    rolls, so give every group the attached unit's keywords and its Toughness,
    the highest among the Bodyguard models (05.02.01).

    ``groups`` is the defender's allocation order, CHARACTER groups after every
    other group. The current group is the first with a model left; an attack's
    save, Damage and Feel No Pain are that group's, and the damaged model takes
    the next attack. A line with [PRECISION] starts on the first CHARACTER
    group with a model left and keeps it current until the line is resolved or
    the group is destroyed. Saves are made as each wound reaches the current
    group rather than all at once and sorted lowest first, which is exact while
    every group has the same save.

    With one group this is the lines allocated in sequence into one unit: each
    line's attacks land on what the earlier lines left. Without an explicit
    ``defences["zeroing"]``, the first line's first group supplies the
    damage-zeroing defence, shared across the groups.
    """
    if not groups:
        raise ValueError("allocate_attached: the target needs at least one group")
    first_character = next((g for g, group in enumerate(groups) if group["character"]), -1)
    if first_character >= 0 and any(not group["character"] for group in groups[first_character:]):
        raise ValueError(
            "allocate_attached: no CHARACTER group can come before a non-CHARACTER group"
        )
    for line in lines:
        if len(line) != len(groups):
            raise ValueError(
                f"allocate_attached: every line needs one input per group ({len(groups)}), "
                f"got {len(line)}"
            )
    crunched = [[crunch_model(input, dataset) for input in line] for line in lines]
    zeroing = (defences or {}).get("zeroing")
    if zeroing is None and crunched:
        zeroing = _resolved_zeroing(crunched[0][0][0])
    resolved = _zeroing_of({"zeroing": zeroing} if zeroing is not None else None)
    if len(groups) == 1:
        if not crunched:
            return {
                "damageDealt": 0.0,
                "modelsDestroyed": 0.0,
                "modelsDestroyedDistribution": [1.0],
                "woundsDealtDistribution": [1.0],
                "groups": [{"modelsDestroyedDistribution": [1.0]}],
            }
        first = crunched[0][0][1]
        allocated: tuple[list[float], int, int, int] | None = None
        for line_models in crunched:
            model = line_models[0][1]
            if model["modelCount"] != first["modelCount"] or model["wounds"] != first["wounds"]:
                raise ValueError("allocate_attached: every line must target the same unit")
            allocated = _allocate_from(
                model, resolved, allocated[0] if allocated is not None else None
            )
        assert allocated is not None
        single, dealt = _summarise(*allocated)
        return {
            **single,
            "woundsDealtDistribution": dealt,
            "groups": [{"modelsDestroyedDistribution": single["modelsDestroyedDistribution"]}],
        }
    if not crunched:
        raise ValueError(
            "allocate_attached: give at least one line to read the target's groups from"
        )
    geometry = [
        (
            _integral(model["modelCount"], "target models"),
            _integral(model["wounds"], "target Wounds"),
        )
        for _, model in crunched[0]
    ]
    state: list[float] | None = None
    for line_models in crunched:
        models = [model for _, model in line_models]
        for g, model in enumerate(models):
            if model.get("unmodelled"):
                raise ValueError(
                    f"allocate: {', '.join(model['unmodelled'])} not modelled by exact allocation"
                )
            if model["modelCount"] != geometry[g][0] or model["wounds"] != geometry[g][1]:
                raise ValueError("allocate_attached: every line must target the same groups")
            if _shared_rolls(model) != _shared_rolls(models[0]):
                raise ValueError(
                    "allocate_attached: the groups disagree on the attack's Hit or Wound rolls; "
                    "give each group the attached unit's keywords and Toughness"
                )
        state = _allocate_groups_from(models, groups, geometry, resolved, state)
    assert state is not None
    return _summarise_groups(state, geometry, int(resolved["uses"]) + 1)


def _group_strides(geometry: list[tuple[int, int]]) -> tuple[list[int], int]:
    """Mixed-radix strides of the groups' remaining wounds, and the number of cells."""
    strides: list[int] = []
    cells = 1
    for models, wounds in geometry:
        strides.append(cells)
        cells *= models * wounds + 1
    return strides, cells


def _allocate_groups_from(
    models: list[AttackModel],
    groups: list[TargetGroup],
    geometry: list[tuple[int, int]],
    zeroing: DamageZeroing,
    start: list[float] | None = None,
) -> list[float]:
    """One line's attacks into the groups, from ``start`` (an earlier line's
    states) or the unit at full strength. A state is the wounds each group has
    left, plus zeroing uses left: a group has at most one damaged model, so
    its wounds left say how many models it has and how hurt the damaged one
    is."""
    model = models[0]
    uses = int(zeroing["uses"]) + 1
    per_model = zeroing["per"] == "model"
    strides, cells = _group_strides(geometry)
    size = cells * uses
    if size > MAX_ATTACHED_STATES:
        raise ValueError(
            f"allocate: the attached unit's {size} states exceed the exact allocation bound "
            f"({MAX_ATTACHED_STATES})"
        )

    def left(cell: int, g: int) -> int:
        return (cell // strides[g]) % (geometry[g][0] * geometry[g][1] + 1)

    full = sum(m * w * strides[g] for g, (m, w) in enumerate(geometry))

    def zeros() -> list[float]:
        return [0.0] * size

    initial = list(start) if start is not None else zeros()
    if start is None:
        initial[full * uses + uses - 1] = 1.0

    # What one wound, critical wound or mortal wound does to the current group.
    split = any(m.get("criticalWound") is not None for m in models) and not model["devastating"]
    params: list[dict[str, tuple[float, list[float], bool]]] = []
    for m in models:
        own = m.get("criticalWound")
        critical_unsaved = own["unsaved"] if own is not None else m["unsaved"]
        critical_damage = own["damage"] if own is not None else m["damage"]
        params.append(
            {
                "wound": (m["unsaved"], _wounds_lost(m["damage"], m["woundLost"]), True),
                "critical": (
                    critical_unsaved,
                    _wounds_lost(critical_damage, m["woundLost"]),
                    True,
                ),
                "one": (
                    1.0,
                    _wounds_lost([{"value": 1, "probability": 1.0}], m["mortalWoundLost"]),
                    False,
                ),
                "dev": (1.0, _wounds_lost(critical_damage, m["mortalWoundLost"]), False),
            }
        )

    def first_alive(cell: int, order: list[int]) -> int:
        return next((g for g in order if left(cell, g) > 0), -1)

    default_order = list(range(len(groups)))
    characters = [g for g in default_order if groups[g]["character"]]

    def run(from_: list[float], chosen: int) -> list[float]:
        # The line's attacks from one share of the start, `chosen` the group [PRECISION] keeps
        # current.
        current = [
            chosen if chosen >= 0 and left(cell, chosen) > 0 else first_alive(cell, default_order)
            for cell in range(cells)
        ]

        def step(state: list[float], kind: str) -> list[float]:
            out = zeros()
            for id_ in range(size):
                p = state[id_]
                if p == 0:
                    continue
                cell = id_ // uses
                g = current[cell]
                if g < 0:
                    out[id_] += p
                    continue
                unsaved, removed, zeroable = params[g][kind]
                if unsaved < 1:
                    out[id_] += p * (1 - unsaved)
                hit = p * unsaved
                if hit == 0:
                    continue
                unused = id_ % uses
                if zeroable and unused > 0:
                    out[id_ - 1] += hit
                    continue
                wounds = geometry[g][1]
                remaining = left(cell, g)
                alive = -(-remaining // wounds)
                on_model = remaining - (alive - 1) * wounds
                for amount, q in enumerate(removed):
                    if q == 0:
                        continue
                    kills = amount >= on_model
                    if amount == 0:
                        nxt = remaining
                    elif kills:
                        nxt = (alive - 1) * wounds
                    else:
                        nxt = remaining - amount
                    refilled = uses - 1 if kills and per_model else unused
                    out[(cell + (nxt - remaining) * strides[g]) * uses + refilled] += hit * q
            return out

        table_model: AttackModel = {**model, "unsaved": 1.0}
        if split:
            table_model["criticalWound"] = {"unsaved": 1.0, "damage": model["damage"]}
        per, counts, most = _bounded_per_attack(table_model)
        mortals = _roll_mortals_of(model)
        pending: Layers = []

        def gather(into: Layers, layers: Layers, weight: float) -> None:
            for k, layer in enumerate(layers):
                while len(into) <= k:
                    into.append(zeros())
                target = into[k]
                for id_, q in enumerate(layer):
                    target[id_] += weight * q

        def step_all(layers: Layers, kind: str) -> Layers:
            return [step(layer, kind) for layer in layers]

        def shift_all(layers: Layers, by: int) -> Layers:
            return layers if by == 0 else [zeros() for _ in range(by)] + layers

        if split:
            # Critical wounds with their own save or Damage land in the order their hits wound.
            normal_hit = 1 if model["torrent"] else model["hit"]["pass"] - model["hit"]["crit"]
            crit_hit = 0 if model["torrent"] else model["hit"]["crit"]
            extras = sorted(
                _optional_distribution(model["sustainedStat"]), key=lambda extra: extra[0]
            )
            extra_counts = [(_integral(count, "Sustained Hits"), p) for count, p in extras]

            def blend(parts: list[tuple[float, Layers]]) -> Layers:
                out: Layers = [zeros()]
                for weight, layers in parts:
                    if weight > 0:
                        gather(out, layers, weight)
                return out

            def wound_roll(layers: Layers, extra: int) -> Layers:
                wound = model["wound"]
                return blend(
                    [
                        (1 - wound["pass"], layers),
                        (
                            wound["pass"] - wound["crit"],
                            shift_all(step_all(layers, "wound"), mortals["wound"]),
                        ),
                        (
                            wound["crit"],
                            shift_all(
                                step_all(layers, "critical"),
                                mortals["wound"] + mortals["criticalWound"] + extra,
                            ),
                        ),
                    ]
                )

            def first_wound(layers: Layers) -> Layers:
                if model["lethal"]:
                    return shift_all(step_all(layers, "wound"), mortals["wound"])
                return wound_roll(layers, mortals["criticalWoundOfCriticalHit"])

            def attack(layers: Layers) -> Layers:
                parts = [
                    (1 - normal_hit - crit_hit, layers),
                    (normal_hit, shift_all(wound_roll(layers, 0), mortals["hit"])),
                ]
                if crit_hit > 0:
                    after = first_wound(shift_all(layers, mortals["hit"] + mortals["criticalHit"]))
                    done = 0
                    for count, probability in extra_counts:
                        while done < count:
                            after = wound_roll(after, 0)
                            done += 1
                        parts.append((crit_hit * probability, after))
                return blend(parts)

            layers: Layers = [from_]
            for attacks in range(most + 1):
                weight = counts.get(attacks, 0.0)
                if weight > 0:
                    gather(pending, layers, weight)
                if attacks == most:
                    break
                layers = attack(layers)
        else:
            # Wounds, then the ability's mortal wounds, then Devastating Wounds' mortal wounds.
            events = _events(per, counts, most)
            target = zeros()
            pending.append(target)
            after_normal = from_
            for normal_events, row in enumerate(events):
                if normal_events > 0:
                    after_normal = step(after_normal, "wound")
                after_ones = after_normal
                for ones in range(len(row[0])):
                    if not any(p > 0 for cell in row for p in cell[ones:]):
                        break
                    if ones > 0:
                        after_ones = step(after_ones, "one")
                    after = after_ones
                    for dev_events, cell in enumerate(row):
                        if dev_events > 0:
                            after = step(after, "dev")
                        p = cell[ones]
                        if p > 0:
                            for id_, q in enumerate(after):
                                target[id_] += p * q
        final = pending[-1] if pending else zeros()
        for layer in reversed(pending[:-1]):
            final = step(final, "one")
            for id_, q in enumerate(layer):
                final[id_] += q
        return final

    if not model["precision"] or not characters:
        return run(initial, -1)
    # [PRECISION] picks a CHARACTER group at the start of the line: split the start by which one.
    out = zeros()
    shares: dict[int, list[float]] = {}
    for id_, p in enumerate(initial):
        if p == 0:
            continue
        chosen = first_alive(id_ // uses, characters)
        share = shares.setdefault(chosen, zeros())
        share[id_] += p
    for chosen, share in shares.items():
        for id_, q in enumerate(run(share, chosen)):
            out[id_] += q
    return out


def _summarise_groups(
    final: list[float], geometry: list[tuple[int, int]], uses: int
) -> AttachedAllocationOutput:
    strides, _ = _group_strides(geometry)
    total = sum(models for models, _ in geometry)
    total_wounds = sum(models * wounds for models, wounds in geometry)
    destroyed = [0.0] * (total + 1)
    dealt = [0.0] * (total_wounds + 1)
    by_group = [[0.0] * (models + 1) for models, _ in geometry]
    damage_dealt = 0.0
    for id_, p in enumerate(final):
        if p == 0:
            continue
        cell = id_ // uses
        killed = 0
        lost = 0
        for g, (models, wounds) in enumerate(geometry):
            remaining = (cell // strides[g]) % (models * wounds + 1)
            dead = models - -(-remaining // wounds)
            by_group[g][dead] += p
            killed += dead
            lost += models * wounds - remaining
        destroyed[killed] += p
        dealt[lost] += p
        damage_dealt += p * lost
    models_destroyed = 0.0
    for count, p in enumerate(destroyed):
        models_destroyed += p * count
    return {
        "damageDealt": damage_dealt,
        "modelsDestroyed": models_destroyed,
        "modelsDestroyedDistribution": destroyed,
        "woundsDealtDistribution": dealt,
        "groups": [{"modelsDestroyedDistribution": d} for d in by_group],
    }
