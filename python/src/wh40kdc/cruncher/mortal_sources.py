"""Mortal wounds an ability inflicts on an enemy unit outside an attack: after a Charge move, at
the start of a phase, when a unit is selected. Each is a source: the expected number of mortal
wounds the target suffers each time its moment comes, before Feel No Pain.

Mortal wounds an attack's own hit or wound rolls inflict are not sources; the buff layer turns
them into a ``mortal-wounds-on-roll`` contribution the engine applies per attack.

Python mirror of ``tools/src/cruncher/mortal-sources.ts``. Accumulation order mirrors the TS loops
so the float results match.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from typing import Any, TypeGuard

from wh40kdc.cruncher.damage_roll import quantity_distribution
from wh40kdc.cruncher.from_dsl import _evaluate_condition, _js_number, _js_str, _undecided_needs

_SELF_TARGETS = frozenset(["this-unit", "this-model", "bearer", "self", "attacker"])

Distribution = list[tuple[float, float]]


def _is_object(value: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict)


def _is_number(value: Any) -> TypeGuard[float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _json(value: Any, present: bool = True) -> str:
    """JS ``JSON.stringify`` for the values that flow into reason strings."""
    if not present:
        return "undefined"
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def mortal_wound_sources(
    ability_id: str,
    effect: Any,
    trigger: Any,
    context: dict[str, Any],
    rating: str | int | float | None = None,
) -> dict[str, Any]:
    """The mortal wounds ``effect`` (with the record's own ``trigger``) inflicts on an enemy unit
    outside an attack, as ``{"sources": [{id, moment, expected, needs}], "unsupported": [...]}``.
    A condition the context leaves undecided is reported as a need and assumed to hold; one it
    decides false removes what it gates. ``phase-is`` conditions never gate a source: the moment
    names when it happens, whatever phase the attack is made in. Mortal wounds the ability's own
    unit suffers are not sources."""
    ctx = {key: value for key, value in context.items() if key != "phase"}
    sources: list[dict[str, Any]] = []
    unsupported: list[dict[str, Any]] = []

    def decide(raw: Any, state: dict[str, Any]) -> dict[str, Any] | None:
        condition = _without_phase(raw)
        if condition is None:
            return state
        verdict = _evaluate_condition(condition, ctx, "attacker")
        if verdict is False:
            return None
        if verdict is True:
            return state
        needs = _undecided_needs(condition, ctx, "attacker", None)
        return {**state, "needs": _merge_needs(state["needs"], needs)}

    def enter_trigger(value: Any, state: dict[str, Any]) -> dict[str, Any] | None:
        items = value if isinstance(value, list) else [value]
        triggers = [item for item in items if _is_object(item)]
        if not triggers:
            return state
        nxt = {**state, "moment": "|".join(_moment_of(item) for item in triggers)}
        subjects = [
            item["subject"].get("owner") if _is_object(item.get("subject")) else None
            for item in triggers
        ]
        # A nested moment with no subject of its own ("roll for that unit") keeps the enclosing one.
        if any(owner is not None for owner in subjects):
            if all(owner == "enemy" for owner in subjects):
                nxt["subjectEnemy"] = True
            elif all(owner == "friendly" for owner in subjects):
                nxt["subjectEnemy"] = False
            else:
                nxt["subjectEnemy"] = None
        # Alternative moments are each enough on their own; only a single trigger's condition gates.
        if len(triggers) == 1:
            gated = decide(triggers[0].get("condition"), nxt)
            if gated is None:
                return None
            nxt = gated
        return nxt

    def report(node: Any, reason: str) -> None:
        unsupported.append({"reason": reason, "effectFragment": node})

    def reaches(filt: dict[str, Any], state: dict[str, Any]) -> dict[str, Any] | None:
        """The state once the target is one of the units ``filt`` reaches, or None when the
        context rules it out. Its range and other unit facts are needs on the target."""
        rest = {key: value for key, value in filt.items() if key != "owner"}
        if not rest:
            return state
        return decide(
            {"type": "matches", "parameters": {"subject": "target", "filter": rest}}, state
        )

    def models_rolling(
        roll: dict[str, Any], state: dict[str, Any]
    ) -> tuple[int | float, dict[str, Any] | None] | str:
        """How many models roll dice for a per-model roll, or why that is not known."""
        own = ctx.get("attackerModelCount")
        target = ctx.get("targetModelCount")
        if "per_model" in roll:
            ref = roll["per_model"]
            on_target = _target_is_enemy(ref, state) if isinstance(ref, str) else None
            if ref != "this-unit" and on_target is not True:
                return f"dice rolled for each model of {_json(ref)} are not modelled"
            count = own if ref == "this-unit" else target
            if count is None:
                return "the number of models rolling is not in the context"
            return (count, state)
        each = roll["for_each"] if _is_object(roll.get("for_each")) else {}
        filt = each["filter"] if _is_object(each.get("filter")) else {}
        own_models = (
            filt.get("level") == "model"
            and filt.get("member_of") == "this-unit"
            and all(key in ("level", "member_of", "owner") for key in filt)
        )
        if not own_models:
            return "dice rolled for each of a subset of models are not modelled"
        if own is None:
            return "the number of models rolling is not in the context"
        # Which of the unit's models meet the eligibility is a fact about all of them: answered
        # yes, every model rolls.
        return (own, decide(each.get("eligibility"), state))

    def inflict(node: dict[str, Any], state: dict[str, Any]) -> None:
        target = node.get("target")
        if (
            _is_object(target)
            and target.get("owner") in ("enemy", "any")
            and "selection_var" not in target
            and "event_var" not in target
        ):
            nxt = reaches(target, state)
            if nxt is not None:
                inflict({**node, "target": "defender"}, nxt)
            return
        on_target = _target_is_enemy(target, state)
        if on_target is False:
            return
        if on_target is None:
            report(
                node,
                f"mortal-wounds: cannot tell whether {_json(target, 'target' in node)} "
                "is the target",
            )
            return
        modifier = node["modifier"] if _is_object(node.get("modifier")) else {}
        roll = modifier["roll"] if _is_object(modifier.get("roll")) else {}
        models: int | float | None = None
        if "per_model" in roll or "for_each" in roll:
            counted = models_rolling(roll, state)
            if isinstance(counted, str):
                report(node, f"mortal-wounds: {counted}")
                return
            models, counted_state = counted
            if counted_state is None:
                return
            state = counted_state
        expected = _expected_mortal_wounds(modifier, rating, models)
        if isinstance(expected, str):
            report(node, f"mortal-wounds: {expected}")
            return
        existing = next(
            (
                found
                for found in sources
                if found["id"] == state["id"] and found["moment"] == state["moment"]
            ),
            None,
        )
        if existing is not None:
            existing["expected"] += state["probability"] * expected
            existing["needs"] = _merge_needs(existing["needs"], state["needs"])
        else:
            sources.append(
                {
                    "id": state["id"],
                    "moment": state["moment"],
                    "expected": state["probability"] * expected,
                    "needs": list(state["needs"]),
                }
            )

    def walk(node: Any, state: dict[str, Any]) -> None:
        if not _is_object(node) or state["probability"] == 0:
            return
        node_type = node.get("type")
        if node_type in ("sequence", "rules-bundle"):
            steps = node.get("steps")
            for step in steps if isinstance(steps, list) else []:
                walk(step, state)
        elif node_type == "ability-part":
            nxt = state if node.get("trigger") is None else enter_trigger(node["trigger"], state)
            if nxt is not None:
                walk(node.get("effect"), nxt)
        elif node_type == "conditional":
            nxt = decide(node.get("condition"), state)
            if nxt is not None:
                walk(node.get("effect"), nxt)
        elif node_type == "select-units":
            selector = node["selector"] if _is_object(node.get("selector")) else {}
            filt = selector.get("filter")
            owner = filt.get("owner") if _is_object(filt) else None
            nxt = decide(
                selector.get("eligibility"),
                {
                    **state,
                    "selectedEnemy": True
                    if owner == "enemy"
                    else False
                    if owner == "friendly"
                    else None,
                },
            )
            if nxt is not None:
                walk(node.get("effect"), nxt)
        elif node_type == "for-each-unit":
            selector = node["selector"] if _is_object(node.get("selector")) else {}
            filt = selector["filter"] if _is_object(selector.get("filter")) else {}
            owner = filt.get("owner")
            if owner != "enemy":
                if owner != "friendly" and _contains_mortal_wounds(node.get("effect")):
                    report(node, "mortal-wounds: for-each-unit reaches units of either side")
                return
            nxt = reaches(filt, state)
            if nxt is not None:
                walk(node.get("effect"), {**nxt, "recipientEnemy": True})
        elif node_type == "roll":
            walk(node.get("effect"), state)
        elif node_type == "choice":
            options = node.get("options")
            for index, option in enumerate(options if isinstance(options, list) else []):
                walk(option, {**state, "id": f"{state['id']}?{index}"})
        elif node_type == "dice-gated":
            success = _gate_probability(node)
            if success is None:
                report(node, "dice-gated: only a fixed threshold on rolled dice is modelled")
                return
            walk(node.get("on_success"), {**state, "probability": state["probability"] * success})
            walk(
                node.get("on_fail"),
                {**state, "probability": state["probability"] * (1 - success)},
            )
        elif node_type == "dice-table":
            if node.get("distinct") is True:
                report(node, "dice-table: distinct results are not modelled")
                return
            faces = 3 if node.get("dice") == "D3" else 6
            count = node.get("count")
            dice = count if _is_number(count) else 1
            outcomes = node.get("outcomes")
            for outcome in outcomes if isinstance(outcomes, list) else []:
                if not _is_object(outcome) or not isinstance(outcome.get("results"), list):
                    continue
                hits = len(
                    [
                        face
                        for face in outcome["results"]
                        if _is_number(face) and 1 <= face <= faces
                    ]
                )
                walk(
                    outcome.get("effect"),
                    {**state, "probability": state["probability"] * dice * (hits / faces)},
                )
        elif node_type == "mortal-wounds":
            inflict(node, state)
        elif _contains_mortal_wounds(node):
            report(node, f'mortal-wounds inside "{_js_str(node_type)}" are not modelled')

    start = enter_trigger(
        trigger, {"probability": 1, "moment": None, "needs": [], "id": ability_id}
    )
    if start is not None:
        walk(effect, start)
    return {
        "sources": [found for found in sources if found["expected"] > 0],
        "unsupported": unsupported,
    }


def _without_phase(condition: Any) -> dict[str, Any] | None:
    """The condition with its ``phase-is`` leaves taken as satisfied (a compound keeps its other
    operands), or None when nothing else remains. A negated ``phase-is`` is satisfied too."""
    if not _is_object(condition):
        return None
    if condition.get("type") == "phase-is":
        return None
    if not isinstance(condition.get("operator"), str) or not isinstance(
        condition.get("operands"), list
    ):
        return condition
    operands = [
        operand
        for operand in (_without_phase(item) for item in condition["operands"])
        if operand is not None
    ]
    if not operands:
        return None
    if condition["operator"] == "not":
        if len(operands) != len(condition["operands"]):
            return None
        return {**condition, "operands": operands}
    return operands[0] if len(operands) == 1 else {**condition, "operands": operands}


def _moment_of(trigger: dict[str, Any]) -> str:
    """The trigger's event and the filter value that tells its moments apart."""
    filt = trigger["filter"] if _is_object(trigger.get("filter")) else {}
    move_types = filt.get("move_types")
    candidates = [
        filt.get("phase"),
        filt.get("to"),
        filt.get("kind"),
        filt.get("roll"),
        "+".join(_js_str(t) for t in move_types) if isinstance(move_types, list) else None,
        filt.get("from"),
    ]
    detail = next((v for v in candidates if isinstance(v, str) and len(v) > 0), None)
    event = _js_str(trigger.get("event"))
    return f"{event}:{detail}" if detail else event


def _target_is_enemy(target: Any, state: dict[str, Any]) -> bool | None:
    """True when the mortal wounds land on an enemy unit, False on the ability's own side, None
    when unknown."""
    if isinstance(target, str):
        if target in _SELF_TARGETS:
            return False
        if target == "defender":
            return True
        if target == "selected-unit":
            return state.get("selectedEnemy")
        if target == "event-subject":
            return state.get("subjectEnemy")
        if target == "recipient":
            return state.get("recipientEnemy")
        return None
    if _is_object(target) and target.get("owner") == "friendly":
        return False
    return None


def _expected_mortal_wounds(
    modifier: dict[str, Any], rating: Any = None, models: int | float | None = None
) -> float | str:
    """Expected mortal wounds from a ``mortal-wounds`` modifier, or why it cannot be computed."""
    for key in modifier:
        if key not in ("count", "max", "per", "roll", "psychic"):
            return f"{key} is not modelled"
    count = modifier.get("count")
    try:
        if _is_object(count) and count.get("rating") is True:
            per_wound = [] if rating is None else quantity_distribution(rating)
        else:
            per_wound = quantity_distribution(count)
    except ValueError:
        return f"count {_json(count, 'count' in modifier)} is not a fixed or dice quantity"
    if not per_wound:
        return "count follows the ability's rating, which is not given"
    total = per_wound
    if "roll" in modifier or "per" in modifier:
        roll = modifier.get("roll")
        if modifier.get("per") != "success" or not _is_object(roll):
            per = modifier.get("per")
            shown = "null" if per is None and "per" in modifier else _js_str(per)
            return f"per {shown} is not modelled"
        try:
            dice = quantity_distribution(roll.get("dice"))
        except ValueError:
            return f"dice {_json(roll.get('dice'), 'dice' in roll)} is not a fixed or dice quantity"
        # Dice for each model: the per-model dice, rolled once for every model.
        if models is not None:
            dice = _sum_distribution(dice, models)
        comparison = roll.get("comparison")
        success = _face_probability(
            _js_number(roll.get("threshold")), comparison if isinstance(comparison, str) else "gte"
        )
        if success is None:
            return f"threshold {_json(roll.get('threshold'), 'threshold' in roll)} is not modelled"
        total = _success_totals(dice, success, per_wound)
    cap = modifier.get("max")
    maximum = cap if _is_number(cap) else math.inf
    result = 0.0
    for value, probability in total:
        result += min(value, maximum) * probability
    return result


def _success_totals(dice: Distribution, success: float, count: Distribution) -> Distribution:
    """Distribution of the summed counts over the dice that succeed."""
    out: dict[float, float] = {}
    for n, pn in dice:
        sums: dict[float, float] = {0: 1}
        k = 0
        while k <= n:
            pk = _binomial(n, k) * success**k * (1 - success) ** (n - k)
            for value, probability in sums.items():
                out[value] = out.get(value, 0) + pn * pk * probability
            sums = _convolve(sums, count)
            k += 1
    return sorted(out.items(), key=lambda item: item[0])


def _sum_distribution(draw: Distribution, times: int | float) -> Distribution:
    """Distribution of the sum of ``times`` independent draws."""
    sums: dict[float, float] = {0: 1}
    index = 0
    while index < times:
        sums = _convolve(sums, draw)
        index += 1
    return sorted(sums.items(), key=lambda item: item[0])


def _convolve(left: dict[float, float], right: Distribution) -> dict[float, float]:
    out: dict[float, float] = {}
    for a, pa in left.items():
        for b, pb in right:
            out[a + b] = out.get(a + b, 0) + pa * pb
    return out


def _binomial(n: float, k: int) -> float:
    result = 1.0
    for i in range(1, k + 1):
        result = (result * (n - k + i)) / i
    return result


def _face_probability(threshold: float, comparison: str) -> float | None:
    """Probability one D6 meets ``threshold`` under ``comparison``; None for a threshold that is
    not a face."""
    if not math.isfinite(threshold) or not float(threshold).is_integer():
        return None
    faces = [face for face in range(1, 7) if _compare(face, threshold, comparison)]
    return len(faces) / 6


def _gate_probability(node: dict[str, Any]) -> float | None:
    """Probability a ``dice-gated`` node succeeds; None when it is not a fixed threshold on
    rolled dice."""
    if "test" in node or "from" in node or "requirement" in node:
        return None
    threshold = node.get("threshold")
    if not _is_number(threshold):
        return None
    dice_value = node.get("dice")
    try:
        dice = quantity_distribution("D6" if dice_value is None else dice_value)
    except ValueError:
        return None
    comparison = node.get("comparison")
    comparison = comparison if isinstance(comparison, str) else "gte"
    result = 0.0
    for value, probability in dice:
        result += probability if _compare(value, threshold, comparison) else 0
    return result


def _compare(value: float, threshold: float, comparison: str) -> bool:
    ops: dict[str, Callable[[float, float], bool]] = {
        "lte": lambda a, b: a <= b,
        "lt": lambda a, b: a < b,
        "gt": lambda a, b: a > b,
        "eq": lambda a, b: a == b,
    }
    return ops.get(comparison, lambda a, b: a >= b)(value, threshold)


def _merge_needs(left: list[Any], right: list[Any]) -> list[Any]:
    out = list(left)
    for need in right:
        if not any(existing["key"] == need["key"] for existing in out):
            out.append(need)
    return out


def _contains_mortal_wounds(node: Any) -> bool:
    if isinstance(node, list):
        return any(_contains_mortal_wounds(item) for item in node)
    if not _is_object(node):
        return False
    if node.get("type") == "mortal-wounds":
        return True
    return any(_contains_mortal_wounds(value) for value in node.values())
