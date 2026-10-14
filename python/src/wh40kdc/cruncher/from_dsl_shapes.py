"""Buff-layer handling of the phase-4 DSL shapes: values the engine cannot size, the
``roll`` binding container re-encoding a dice-pool allocation, and the diagnostic label of
an ability's own roll.

Python mirror of the phase-4 helpers in ``tools/src/cruncher/from-dsl.ts``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wh40kdc.cruncher.buffs import Buff, BuffSource

#: Numeric modifier fields whose size a buff reads.
_SIZED_FIELDS = ("value", "count", "amount")

#: Leaves and containers the buff engine reports rather than resolves.
UNSUPPORTED_SHAPE_REASONS: dict[str, str] = {
    "select-objective": (
        "select-objective: the bound objective marker is not resolved by the buff engine"
    ),
    "characteristic-resolution": (
        "characteristic-resolution: which models' characteristic applies depends on the "
        "unit's model mix; not resolved by the buff engine"
    ),
    "borrow-weapons": (
        "borrow-weapons: the passengers' weapons are not added to the Transport's profile "
        "by the buff engine"
    ),
    "select-weapon": "select-weapon: a bound weapon is not resolved by the buff engine",
}


def _js(v: Any) -> str:
    """JS ``String(v)`` for the values a diagnostic interpolates."""
    if v is None:
        return "undefined"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def roll_label(roll: Any) -> str:
    """A roll kind for a diagnostic: "hit", or the ability whose dice it is."""
    if isinstance(roll, dict) and isinstance(roll.get("of_ability"), str):
        return f"{roll['of_ability']} roll"
    return _js(roll)


def unsized_value_reason(node: dict[str, Any]) -> str | None:
    """Why a leaf's size cannot be read, or None: a ``scaling`` block (the size depends on
    models or wounds on the board) or a value bound to the battle size, a roll or a count."""
    modifier = node.get("modifier")
    node_type = node.get("type")
    if not isinstance(modifier, dict) or not isinstance(node_type, str):
        return None
    scaling = node.get("scaling")
    if isinstance(scaling, dict):
        return (
            f"{node_type}: the value scales with {_js(scaling.get('of'))}; "
            "not resolved by the buff engine"
        )
    for field in _SIZED_FIELDS:
        v = modifier.get(field)
        if not isinstance(v, dict):
            continue
        if isinstance(v.get("roll_var"), str):
            what = "a bound roll"
        elif isinstance(v.get("count_of"), str):
            what = f"the number of {v['count_of']}"
        else:
            what = "the battle size"
        return f"{node_type}: its {field} is set by {what}; not resolved by the buff engine"
    return None


Collect = Callable[[Any, BuffSource, dict[str, Any], dict[str, Any], list[Buff]], None]


def enumerate_roll_allocation(
    node: dict[str, Any],
    source: BuffSource,
    opts: dict[str, Any],
    out: dict[str, Any],
    collect: Collect,
    label: Callable[[list[Buff]], str],
) -> bool:
    """A ``roll`` whose nested effect is a choice of dice gates on that roll (``from`` +
    ``requirement``): the general encoding of a dice-pool allocation. Emits the levers the
    dice-pool enumeration does (ids ``<ability>#<option name>``, one group capped by the
    choice's ``max_choices``). Returns False when the roll is not such an allocation."""
    choice = node.get("effect")
    if not isinstance(choice, dict) or choice.get("type") != "choice":
        return False
    options = choice.get("options")
    if not isinstance(options, list):
        return False
    gates: list[tuple[str | None, Any]] = []
    for opt in options:
        part = opt if isinstance(opt, dict) and opt.get("type") == "ability-part" else None
        gate = part.get("effect") if part is not None else opt
        frm = gate.get("from") if isinstance(gate, dict) else None
        if not (
            isinstance(gate, dict)
            and gate.get("type") == "dice-gated"
            and gate.get("requirement") is not None
            and isinstance(frm, dict)
            and frm.get("roll_var") == node.get("roll_var")
        ):
            return False
        name = part.get("name") if part is not None and isinstance(part.get("name"), str) else None
        gates.append((name, gate.get("on_success")))
    max_choices = choice.get("max_choices")
    is_number = isinstance(max_choices, (int, float)) and not isinstance(max_choices, bool)
    max_activations = max_choices if is_number else 1
    for name, effect in gates:
        buffs: list[Buff] = []
        collect(effect, source, opts, {}, buffs)
        if not buffs:
            continue
        lever = name if name is not None else label(buffs)
        out["activatable"].append(
            {
                "id": f"{opts['abilityId']}#{lever}",
                "label": lever,
                "buffs": buffs,
                "group": {"id": opts["abilityId"], "maxActivations": max_activations},
            }
        )
    return True
