"""Buff-layer translation of the damage levers carried by ``roll-result``, ``ignore-modifiers``
and ``ability-grant`` leaves: critical thresholds, ignored hit/wound modifiers, and the core
abilities the buff layer models on the unit being attacked.

Python mirror of ``translateRollResult`` / ``translateIgnoreModifiers`` /
``translateAbilityGrant`` / ``translateAbilityModifier`` in ``tools/src/cruncher/from-dsl.ts``.
The shared helpers they use (target classification, narrowing, applicability) live in
:mod:`wh40kdc.cruncher.from_dsl`, which imports this module; the import here is deferred to
call time to keep the two modules free of an import cycle.
"""

from __future__ import annotations

import math
from typing import Any

from wh40kdc.cruncher.buffs import BuffSource
from wh40kdc.cruncher.from_dsl_shapes import roll_label

#: Modifier keys a critical-threshold-only ``roll-result`` may carry.
_CRITICAL_ONLY_KEYS = frozenset(
    ["roll", "critical_on", "attack_type", "weapons"]
)


def _modifier(node: dict[str, Any]) -> dict[str, Any]:
    """The node's ``modifier`` object, or an empty one."""
    modifier = node.get("modifier")
    return modifier if isinstance(modifier, dict) else {}


def _is_int_in(value: float, low: int, high: int) -> bool:
    """JS ``Number.isInteger(value) && value >= low && value <= high``."""
    return math.isfinite(value) and value.is_integer() and low <= value <= high


def translate_roll_result(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: dict[str, Any]
) -> None:
    """A changed roll result. Only a critical threshold on the buffed unit's own hit or wound
    roll is in the damage math; a fixed result for any other roll (advance, battle-shock, ...)
    is outside it."""
    from wh40kdc.cruncher import from_dsl as dsl

    modifier = _modifier(node)
    roll = modifier.get("roll")
    if roll not in ("hit", "wound", "save", "damage"):
        out["unsupported"].append(
            {
                "reason": f'roll-result on "{roll_label(roll)}" is outside the damage path',
                "effectFragment": node,
            }
        )
        return
    narrowed = dsl._unhonorable_narrowing(modifier)
    if narrowed:
        out["unsupported"].append(
            {
                "reason": (
                    f'roll-result: narrows by "{narrowed}" which the cruncher can\'t resolve here'
                ),
                "effectFragment": node,
            }
        )
        return
    critical = dsl._js_number(modifier.get("critical_on"))
    only_critical = all(key in _CRITICAL_ONLY_KEYS for key in modifier)
    if roll not in ("hit", "wound") or not only_critical or not _is_int_in(critical, 2, 6):
        out["unsupported"].append(
            {
                "reason": (
                    f'roll-result on "{roll}": only a critical threshold on hit or wound '
                    "rolls is modelled"
                ),
                "effectFragment": node,
            }
        )
        return
    if opts["perspective"] != "attacker" or not dsl._applies_to_buffed_unit(node, "attacker"):
        return
    applicability = dsl.combine_optional(
        dsl._weapon_type_applicability(modifier), dsl.weapon_applicability(modifier)
    )
    out["applied"].append(
        dsl.with_applicability(
            {
                "source": source,
                "contribution": {"type": "crit-threshold", "roll": roll, "value": int(critical)},
            },
            applicability,
        )
    )


def translate_ignore_modifiers(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: dict[str, Any]
) -> None:
    """Ignoring modifiers to the buffed unit's own hit or wound rolls. Ignoring WS/BS modifiers
    is the same lever here: the buff layer changes WS/BS for incoming attacks only through hit
    modifiers. Every roll except saves reads as its hit and wound rolls: the only other roll the
    buff layer modifies is Damage, and it never applies a worsening Damage roll modifier to the
    attacker."""
    from wh40kdc.cruncher import from_dsl as dsl

    modifier = _modifier(node)
    what = modifier.get("what")
    listed = (
        modifier.get("rolls")
        if what == "rolls"
        else modifier.get("stats")
        if what == "characteristics"
        else None
    )
    except_rolls = modifier.get("except_rolls")
    except_ = except_rolls if what == "rolls" and isinstance(except_rolls, list) else []
    every_roll_but_saves = (
        isinstance(listed, list)
        and len(listed) > 0
        and all(item in ("all", "any") for item in listed)
        and "save" in except_
    )
    if every_roll_but_saves:
        rolls = [roll for roll in ("hit", "wound") if roll not in except_]
        if not rolls:
            return
    else:
        rolls = (
            ["hit" if item in ("WS", "BS") else item for item in listed]
            if isinstance(listed, list)
            else []
        )
    if not rolls or any(roll not in ("hit", "wound") for roll in rolls):
        out["unsupported"].append(
            {
                "reason": "ignore-modifiers: only hit and wound rolls and WS/BS are modelled",
                "effectFragment": node,
            }
        )
        return
    if opts["perspective"] != "attacker" or not dsl._applies_to_buffed_unit(node, "attacker"):
        return
    for roll in dict.fromkeys(rolls):
        out["applied"].append(
            {"source": source, "contribution": {"type": "ignore-modifiers", "roll": roll}}
        )


def translate_ability_grant(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: dict[str, Any]
) -> None:
    """A printed grant (``definition``) translates its body for the holders. Otherwise, the core
    abilities the buff layer models on the unit being attacked: Stealth and the benefit of cover
    (Stealth gives the benefit of cover) and Feel No Pain. Like the other defender-side leaves,
    they contribute nothing to the buffed unit's own attacks."""
    from wh40kdc.cruncher import from_dsl as dsl

    modifier = _modifier(node)
    # A printed grant carries the granted ability's body: it is the holders' own ability, so it
    # reaches the buffed unit exactly when the grant does, and its "this unit" is the holder.
    definition = modifier.get("definition")
    if isinstance(definition, dict):
        holders = dsl._classify_target(node)
        target = node.get("target")
        if holders == "self":
            if target in ("this-model", "model-in-this-unit") or (
                isinstance(target, dict) and target.get("level") == "model"
            ):
                out["unsupported"].append(
                    {
                        "reason": (
                            "ability-grant: model-only definition cannot be applied to the"
                            " entire unit"
                        ),
                        "effectFragment": node,
                    }
                )
            else:
                dsl._walk(definition, source, {**opts, "grantedHolder": True}, out)
        elif holders == "unknown":
            out["unsupported"].append(
                {
                    "reason": (
                        "ability-grant: the units holding the granted ability are not resolved"
                    ),
                    "effectFragment": node,
                }
            )
        return
    ability = modifier.get("ability")
    fnp = dsl._js_number(modifier.get("value"))
    contribution: dict[str, Any] | None
    if ability in ("stealth", "benefit-of-cover"):
        contribution = {"type": "cover"}
    elif ability == "feel-no-pain" and _is_int_in(fnp, 2, 6):
        contribution = {"type": "feel-no-pain", "threshold": int(fnp)}
    else:
        contribution = None
    if contribution is None:
        out["unsupported"].append(
            {
                "reason": 'effect type "ability-grant" is not modelled by the buff layer',
                "effectFragment": node,
            }
        )
        return
    if opts["perspective"] != "target" or dsl._classify_target(node) != "self":
        return
    out["applied"].append({"source": source, "contribution": contribution})


def translate_ability_modifier(
    node: dict[str, Any], source: BuffSource, opts: dict[str, Any], out: dict[str, Any]
) -> None:
    """A change to another ability. Adding selections to the crunched unit's own ability raises
    the cap of the lever pool that ability offers, which the consumer resolves by the ability's
    name; other aspects are not modelled."""
    from wh40kdc.cruncher import from_dsl as dsl

    modifier = node.get("modifier")
    if isinstance(modifier, dict):
        by = modifier.get("value")
        ability = modifier.get("ability")
        if (
            modifier.get("aspect") == "selections"
            and modifier.get("operation") == "add"
            and isinstance(ability, str)
            and isinstance(by, (int, float))
            and not isinstance(by, bool)
            and float(by).is_integer()
            and by > 0
        ):
            if not dsl._applies_to_buffed_unit(node, opts["perspective"]):
                return
            count = int(by)
            label = (
                f"One more {ability} selection"
                if count == 1
                else f"{count} more {ability} selections"
            )
            out["activatable"].append(
                {
                    "id": f"{opts['abilityId']}#cap",
                    "label": label,
                    "buffs": [],
                    "capRaise": {"ability": ability, "by": count},
                }
            )
            return
    out["unsupported"].append(
        {
            "reason": 'effect type "ability-modifier" is not modelled by the buff layer',
            "effectFragment": node,
        }
    )
