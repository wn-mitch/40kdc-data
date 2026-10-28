"""Condition evaluators for declared objectives, designations, keyword model counts, moves and
test results.

Python mirror of the objective matcher of ``tools/src/cruncher/unit-filter.ts`` and the
``controls`` objective counts, ``designated``, keyword ``model-count``, own-move ``happened`` and
``roll-result`` evaluators of ``scenario-conditions.ts``. Context fields keep their TS camelCase
names: ``objectives`` (every objective, ``{controller?, designations?, role?, homeOf?,
territory?, name?}``); ``attackerDesignationsApplied`` / ``targetDesignationsApplied``
(designation to the number of units carrying it that the unit applied); ``attackerKeywordModels``
/ ``targetKeywordModels`` (keyword to the number of models carrying it); ``attackerMoves`` /
``targetMoves`` (every move made this turn); ``testResults`` (roll to ``success`` or
``failure``); ``attackerSelected`` / ``targetSelected`` (every activity selected for this phase);
``attackerKills`` / ``targetKills`` (``{models, units}`` destroyed this phase); ``attackerLosses`` /
``targetLosses`` (models lost this phase); ``attackerRolls`` / ``targetRolls`` and
``attackerRolledAgainst`` / ``targetRolledAgainst`` (``{roll, result}`` this phase). Each evaluator
returns "unknown" when the context does not declare what it needs.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any, TypeGuard

Verdict = bool | str


def _is_object(value: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict)


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def objective_matches(
    filt: dict[str, Any], objective: dict[str, Any], ability_side: str
) -> Verdict:
    """Whether one objective meets every property of an objective filter, read from the ability's
    side. A property the objective leaves out, or the filter states in a form the scenario cannot
    settle, is unknown."""
    other = "target" if ability_side == "attacker" else "attacker"

    def side_of(relative: Any) -> str | None:
        if relative == "friendly":
            return ability_side
        if relative == "enemy":
            return other
        return None

    verdict: Verdict = True
    for key, wanted in filt.items():
        holds: Verdict
        if key == "controlled_by":
            controller = objective.get("controller")
            if controller is None:
                holds = "unknown"
            elif wanted == "any":
                holds = controller != "none"
            elif side_of(wanted) is None:
                holds = "unknown"
            else:
                holds = controller == side_of(wanted)
        elif key == "designated" and isinstance(wanted, str):
            designations = objective.get("designations")
            holds = (
                "unknown"
                if designations is None
                else any(d.lower() == wanted.lower() for d in designations)
            )
        elif key == "role":
            role = objective.get("role")
            holds = "unknown" if role is None else role == wanted
        elif key == "home_of":
            home_of = objective.get("homeOf")
            holds = (
                "unknown"
                if home_of is None or side_of(wanted) is None
                else home_of == side_of(wanted)
            )
        elif key == "territory":
            territory = (
                ability_side
                if wanted == "your-territory"
                else other
                if wanted == "enemy-territory"
                else "no-mans-land"
                if wanted == "no-mans-land"
                else None
            )
            actual = objective.get("territory")
            holds = "unknown" if actual is None or territory is None else actual == territory
        elif key == "name":
            name = objective.get("name")
            holds = "unknown" if name is None else name == wanted
        else:
            holds = "unknown"
        if holds is False:
            return False
        if holds == "unknown":
            verdict = "unknown"
    return verdict


def objective_control(filt: Any, objectives: Any, ability_side: str) -> dict[str, int] | None:
    """How many of the declared objectives meeting ``filt`` each side controls, or None when an
    objective's match, or a matching objective's controller, is unknown."""
    if objectives is None or not _is_object(filt):
        return None
    control = {"attacker": 0, "target": 0, "total": 0}
    for objective in objectives:
        verdict = objective_matches(filt, objective, ability_side)
        if verdict == "unknown":
            return None
        if verdict is False:
            continue
        controller = objective.get("controller")
        if controller is None:
            return None
        control["total"] += 1
        if controller != "none":
            control[controller] += 1
    return control


def evaluate_designated(
    params: dict[str, Any], ctx: dict[str, Any], by_side: str | None, ability_side: str
) -> Verdict:
    """``designated``: with ``count``, how many units carry the designation that the ``by`` unit
    applied; with an objective subject, how many objectives meeting the filter carry it (at least
    one without ``count``)."""
    tag = params.get("tag")
    if not isinstance(tag, str):
        return "unknown"
    bounds = params.get("count")
    if bounds is not None and (
        not _is_object(bounds)
        or (bounds.get("min") is not None and not _is_num(bounds.get("min")))
        or (bounds.get("max") is not None and not _is_num(bounds.get("max")))
    ):
        return "unknown"

    def within(count: int) -> bool:
        if bounds is None:
            return count >= 1
        low, high = bounds.get("min"), bounds.get("max")
        return (low is None or count >= low) and (high is None or count <= high)

    subject = params.get("subject")
    if _is_object(subject) and _is_object(subject.get("objective")):
        objectives = ctx.get("objectives")
        if params.get("by") is not None or objectives is None:
            return "unknown"
        count = 0
        for objective in objectives:
            verdict = objective_matches(
                {**subject["objective"], "designated": tag}, objective, ability_side
            )
            if verdict == "unknown":
                return "unknown"
            if verdict is True:
                count += 1
        return within(count)
    if bounds is not None:
        if subject is not None or by_side is None:
            return "unknown"
        applied = ctx.get(
            "attackerDesignationsApplied" if by_side == "attacker" else "targetDesignationsApplied"
        )
        if applied is None:
            return "unknown"
        return within(
            sum(units for d, units in applied.items() if d.lower() == tag.lower())
        )
    # A unit's own designations are a `matches` filter; the schema gives this condition no such
    # form.
    return "unknown"


def keyword_model_bounds(
    keyword: str, declared: Any, model_keywords: Any, model_count: Any
) -> tuple[float, float] | None:
    """Bounds on how many models of a unit carry ``keyword``: the declared count, else all of them
    when every model carries it. None otherwise: a unit's keywords omit its models' own names, so a
    keyword missing from them does not show that no model carries it."""
    key = keyword.lower()
    if declared is not None:
        for item, count in declared.items():
            if item.lower() == key:
                return (count, count)
    if model_keywords is None or not any(item.lower() == key for item in model_keywords):
        return None
    return (1, math.inf) if model_count is None else (model_count, model_count)


def bounds_verdict(params: dict[str, Any], bounds: tuple[float, float]) -> Verdict:
    """Inclusive ``min``/``max`` bounds against a count known to lie in ``bounds``."""
    low, high = bounds
    minimum = params.get("min") if _is_num(params.get("min")) else None
    maximum = params.get("max") if _is_num(params.get("max")) else None
    if (minimum is not None and high < minimum) or (maximum is not None and low > maximum):
        return False
    if (minimum is None or low >= minimum) and (maximum is None or high <= maximum):
        return True
    return "unknown"


def evaluate_own_move(params: dict[str, Any], ctx: dict[str, Any], side: str | None) -> bool | None:
    """``happened`` for a unit's own moves this turn: whether the unit on ``side`` made any of the
    listed moves. None when the condition has another form or the moves are undeclared."""
    filt = params.get("filter")
    if (
        params.get("event") != "move-ended"
        or params.get("window") != "turn"
        or side is None
        or not _is_object(filt)
    ):
        return None
    if any(key not in ("event", "subject", "filter", "window") for key in params):
        return None
    types = filt.get("move_types")
    if (
        len(filt) != 1
        or not isinstance(types, list)
        or not types
        or not all(isinstance(t, str) for t in types)
    ):
        return None
    moves = ctx.get("attackerMoves" if side == "attacker" else "targetMoves")
    if moves is None:
        return None
    return any(t in moves for t in types)


def evaluate_test_result(params: dict[str, Any], ctx: dict[str, Any]) -> Verdict:
    """``roll-result`` for a test the ability made, from the declared test results."""
    roll, result = params.get("roll"), params.get("result")
    if roll not in ("leadership", "battle-shock", "charge") or result not in ("success", "failure"):
        return "unknown"
    declared = (ctx.get("testResults") or {}).get(roll)
    return "unknown" if declared is None else declared == result


_PHASE_EVENT_KEYS: dict[str, tuple[str, ...]] = {
    "selected": ("event", "subject", "filter", "window"),
    "model-destroyed": ("event", "object", "filter", "window", "count"),
    "destroyed": ("event", "object", "filter", "window", "count"),
    "after-roll": ("event", "subject", "object", "filter", "window"),
}

def evaluate_phase_event(
    params: dict[str, Any], ctx: dict[str, Any], side_of: Callable[[Any], str | None]
) -> Verdict | None:
    """``happened`` this phase, from the declared phase events: what a unit was selected for, the
    enemy models and units it destroyed, the models it lost, and the rolls it made or that were
    made against it. ``side_of`` names the unit of the attack a reference is, if either. None when
    the condition has another form; "unknown" when the fact it reads is undeclared. A kill or roll
    filter narrower than the declared facts can still rule an event out when none happened."""
    event = params.get("event")
    keys = _PHASE_EVENT_KEYS.get(event) if isinstance(event, str) else None
    if params.get("window") != "phase" or keys is None or any(k not in keys for k in params):
        return None
    filt = params.get("filter", {})
    if not _is_object(filt):
        return None
    if event == "selected":
        side = side_of(params.get("subject"))
        if side is None or len(filt) != 1 or not isinstance(filt.get("to"), str):
            return None
        selected = ctx.get(f"{side}Selected")
        return "unknown" if selected is None else filt["to"] in selected
    if event == "after-roll":
        return _evaluate_rolled(params, filt, ctx, side_of)
    bounds = params.get("count", {"min": 1})
    if not _is_object(bounds):
        return None
    if event == "model-destroyed" and not filt:
        found = _loss_range(params.get("object"), ctx, side_of)
    else:
        found = _kill_range(event == "model-destroyed", params.get("object"), filt, ctx, side_of)
    if found is None or isinstance(found, str):
        return found
    return bounds_verdict(bounds, found)


def _loss_range(
    obj: Any, ctx: dict[str, Any], side_of: Callable[[Any], str | None]
) -> tuple[float, float] | str | None:
    """How many of the object's models the ability's unit lost this phase: this model, or any
    model of this unit."""
    if obj not in ("this-model", "model-in-this-unit"):
        return None
    side = side_of("this-unit")
    losses = ctx.get(f"{side}Losses") if side is not None else None
    if losses is None:
        return "unknown"
    return (0, min(losses, 1)) if obj == "this-model" else (losses, losses)


def _kill_range(
    models: bool,
    obj: Any,
    filt: dict[str, Any],
    ctx: dict[str, Any],
    side_of: Callable[[Any], str | None],
) -> tuple[float, float] | str | None:
    """How many enemy models (or units) the ``by`` unit destroyed this phase. A kill by one model,
    or narrowed by object keywords or attack type, counts at most the unit's kills."""
    if not _is_object(obj) or obj.get("owner") != "enemy" or "by" not in filt:
        return None
    level = obj.get("level", None if models else "unit")
    if level != ("model" if models else "unit"):
        return None
    side = side_of(filt["by"])
    if side is None:
        return None
    kills = ctx.get(f"{side}Kills")
    if kills is None:
        return "unknown"
    count = kills["models"] if models else kills["units"]
    narrowed = (
        filt["by"] == "this-model"
        or any(k not in ("owner", "level") for k in obj)
        or any(k != "by" for k in filt)
    )
    return (0, count) if narrowed else (count, count)


def _evaluate_rolled(
    params: dict[str, Any],
    filt: dict[str, Any],
    ctx: dict[str, Any],
    side_of: Callable[[Any], str | None],
) -> Verdict | None:
    """``after-roll`` this phase: a roll the subject unit made, or with an object (and no subject),
    one made against the object unit. A filter beyond the roll and result can only rule the roll
    out."""
    roll, result = filt.get("roll"), filt.get("result")
    if not isinstance(roll, str) or result not in ("success", "failure", "critical"):
        return None
    if "subject" in params and "object" in params:
        return None
    against = "object" in params
    side = side_of(params["object"] if against else params.get("subject"))
    if side is None:
        return None
    rolls = ctx.get(f"{side}RolledAgainst" if against else f"{side}Rolls")
    if rolls is None:
        return "unknown"
    rolled = any(
        entry.get("roll") == roll
        and (
            entry.get("result") == result
            or (result == "success" and entry.get("result") == "critical")
        )
        for entry in rolls
    )
    if not rolled:
        return False
    return "unknown" if any(k not in ("roll", "result") for k in filt) else True
