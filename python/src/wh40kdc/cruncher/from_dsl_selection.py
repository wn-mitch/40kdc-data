"""Unit selections and other player-vouched choices as levers.

A ``select-units`` effect whose nested effect reaches the ``selected-unit`` is a choice the
player makes on the table: which unit is picked, whether the range and visibility hold, and
whether a gating roll succeeded are not known to the cruncher. The translator therefore offers
the selection's buffs as one opt-in lever on the unit the selection can reach, and records what
the player vouches for in the lever's ``requires``.

Python mirror of ``tools/src/cruncher/from-dsl-selection.ts`` plus ``translateSelection``,
``offerLever``, ``isProvidedByAnotherUnit`` and ``friendlyFilterExcludes`` from
``tools/src/cruncher/from-dsl.ts``. The walker lives in :mod:`wh40kdc.cruncher.from_dsl`, which
imports this module; that import is deferred to call time to avoid a cycle.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.cruncher.buffs import Buff, BuffSource, EngineContext

_SELECTED_UNIT = "selected-unit"

#: Self targets that, in an ability another unit provides, name that provider.
PROVIDER_TARGETS = frozenset(["this-unit", "ability-unit", "this-model"])


def plan_selection(
    node: dict[str, Any], source: BuffSource, perspective: str, context: EngineContext
) -> dict[str, Any]:
    """Plan a ``select-units`` node for the crunched unit under ``perspective``.

    Returns ``{"kind": "none"}`` (not a selection lever), ``{"kind": "skip"}`` (nothing reaches
    the crunched unit), ``{"kind": "unsupported", "reason"}``, or ``{"kind": "lever", "effect",
    "applicability"?, "requires", "label"}``.

    - A friendly selection reaches the crunched unit when its keywords match the selector. When
      the eligibility excludes the ability's own unit, the lever exists only when another unit
      provides the ability (``abilityKind: "support"``).
    - An enemy selection reaches the other side of the attack.
    - A top-level dice gate with no failure branch becomes the lever's content; its roll joins
      ``requires``.
    """
    selector = node.get("selector") if isinstance(node.get("selector"), dict) else None
    filt = selector.get("filter") if isinstance(selector, dict) else None
    unit_ids = filt.get("unit_ids") if isinstance(filt, dict) else None
    owner = filt.get("owner") if isinstance(filt, dict) else None
    if selector is None or not isinstance(filt, dict) or (
        owner not in ("friendly", "enemy")
        and not (unit_ids is not None and owner in (None, "any"))
    ):
        return {"kind": "none"}
    if unit_ids is not None and owner in (None, "any"):
        owner = "friendly"
    if (
        filt.get("level") == "model"
        or filt.get("model_names") is not None
        or selector.get("bind_as") is not None
    ):
        return {"kind": "none"}
    if not _references_selected_unit(node.get("effect")):
        return {"kind": "none"}

    all_of = filt.get("all_of")
    any_of = filt.get("any_of")
    excluded = filt.get("none_of")
    has_keywords = "all_of" in filt or "any_of" in filt
    has_excluded = "none_of" in filt
    if (all_of is not None and not _is_keyword_list(all_of)) or (
        any_of is not None and not _is_keyword_list(any_of)
    ) or (excluded is not None and not _is_keyword_list(excluded)):
        return {
            "kind": "unsupported",
            "reason": "select-units: the selector's keyword lists are malformed",
        }
    selection = {k: v for k, v in node.items() if k != "effect"}
    requires: list[Any] = [selection]
    applicability: dict[str, Any] | None = None

    unit_ids = filt.get("unit_ids")
    if unit_ids is not None and (
        filt.get("level") != "unit"
        or not isinstance(unit_ids, list)
        or not unit_ids
        or any(not isinstance(unit_id, str) for unit_id in unit_ids)
    ):
        return {
            "kind": "unsupported",
            "reason": "select-units: unit_ids identity filter is malformed",
        }
    if unit_ids is not None:
        identity_key = (
            "attackerUnitId"
            if (owner == "friendly") == (perspective == "attacker")
            else "targetUnitId"
        )
        identity = context.get(identity_key)
        if not isinstance(identity, str):
            return {"kind": "unsupported", "reason": "select-units: unit identity is unavailable"}
        if identity not in unit_ids:
            return {"kind": "skip"}
    if owner == "friendly":
        provided = source.get("kind") == "ability" and source.get("abilityKind") == "support"
        if _excludes_ability_unit(selector.get("eligibility")) and not provided:
            return {"kind": "skip"}
        if has_keywords or has_excluded:
            own = context.get("attackerKeywords" if perspective == "attacker" else "targetKeywords")
            if own is None:
                return {
                    "kind": "unsupported",
                    "reason": (
                        "select-units: the crunched unit's keywords are unavailable for the "
                        "selector"
                    ),
                }
            holds = (
                (not all_of or all(_includes_keyword(own, k) for k in all_of))
                and (not any_of or any(_includes_keyword(own, k) for k in any_of))
                and not any(_includes_keyword(own, k) for k in excluded or [])
            )
            if not holds:
                return {"kind": "skip"}
        effect = node.get("effect")
        label = "Selected unit"
    else:
        other = "defender" if perspective == "attacker" else "attacker"
        enemy_keywords: list[str] = []
        if isinstance(all_of, list):
            enemy_keywords.extend(all_of)
        if isinstance(any_of, list):
            enemy_keywords.extend(any_of)
        gate = _selected_enemy_gate(
            enemy_keywords if has_keywords else None,
            excluded if has_excluded else None,
            perspective,
        )
        if isinstance(gate, str):
            return {"kind": "unsupported", "reason": gate}
        applicability = gate
        effect = _retarget(node.get("effect"), other)
        label = "Selected enemy unit"

    if isinstance(effect, dict) and effect.get("type") == "dice-gated":
        if effect.get("on_fail") is not None:
            return {
                "kind": "unsupported",
                "reason": "select-units: a dice gate with a failure branch is not a single lever",
            }
        roll = {k: v for k, v in effect.items() if k not in ("on_success", "on_fail")}
        requires.append(roll)
        effect = effect.get("on_success")
    plan: dict[str, Any] = {"kind": "lever", "effect": effect, "requires": requires, "label": label}
    if applicability:
        plan["applicability"] = applicability
    return plan


def _selected_enemy_gate(
    keywords: list[str] | None, excluded: list[str] | None, perspective: str
) -> dict[str, Any] | None | str:
    """The keyword gate an enemy selector puts on the selected unit, or a reason the buff layer
    cannot express it."""
    out: dict[str, Any] = {}
    if keywords:
        if len(keywords) > 1:
            return (
                "select-units: more than one required keyword on the selected enemy unit is not "
                "gated by the buff layer"
            )
        if perspective == "attacker":
            out["requiresTargetKeyword"] = keywords[0]
        else:
            out["requiresAttackerKeyword"] = keywords[0]
    if excluded:
        if perspective != "attacker":
            return (
                "select-units: excluded keywords on the attacking unit are not gated by the buff "
                "layer"
            )
        out["excludedTargetKeywords"] = list(excluded)
    return out or None


def _references_selected_unit(node: Any) -> bool:
    """Does the effect name the selected unit as a target anywhere, outside a nested selection?"""
    if isinstance(node, list):
        return any(_references_selected_unit(child) for child in node)
    if not isinstance(node, dict):
        return False
    if node.get("type") == "select-units":
        return False
    if node.get("target") == _SELECTED_UNIT:
        return True
    return any(_references_selected_unit(v) for k, v in node.items() if k != "target")

def bind_each_recipient(node: dict[str, Any], replacement: Any | None = None) -> Any | None:
    """Bind a for-each-unit recipient to its canonical candidate filter."""
    selector = node.get("selector")
    if not isinstance(selector, dict) or not isinstance(selector.get("filter"), dict):
        return None
    if selector.get("eligibility") is not None:
        return None
    binding = selector.get("bind_as")
    bound_recipient = False
    other_target = False

    def bind(value: Any) -> Any:
        nonlocal bound_recipient, other_target
        if isinstance(value, list):
            return [bind(child) for child in value]
        if not isinstance(value, dict) or value.get("type") in ("select-units", "for-each-unit"):
            return value
        out: dict[str, Any] = {}
        for key, child in value.items():
            recipient = child == "recipient" or (
                isinstance(binding, str)
                and isinstance(child, dict)
                and child.get("selection_var") == binding
            )
            out[key] = (
                replacement
                if key == "target" and recipient and replacement is not None
                else selector["filter"]
                if key == "target" and recipient
                else bind(child)
            )
            if key == "target":
                bound_recipient = bound_recipient or recipient
                other_target = other_target or not recipient
        return out

    effect = bind(node.get("effect"))
    return effect if bound_recipient and not other_target else None


def _retarget(node: Any, target: str) -> Any:
    """Copy the effect with each ``selected-unit`` target replaced, leaving nested selections."""
    if isinstance(node, list):
        return [_retarget(child, target) for child in node]
    if not isinstance(node, dict) or node.get("type") == "select-units":
        return node
    return {
        k: target if k == "target" and v == _SELECTED_UNIT else _retarget(v, target)
        for k, v in node.items()
    }


def _excludes_ability_unit(condition: Any) -> bool:
    """Does the eligibility forbid selecting the unit holding the ability?"""
    if not isinstance(condition, dict):
        return False
    operands = condition.get("operands")
    if condition.get("operator") == "not" and isinstance(operands, list):
        return any(
            isinstance(operand, dict)
            and operand.get("type") == "same-unit"
            and isinstance(operand.get("parameters"), dict)
            and operand["parameters"].get("as") == "ability-unit"
            for operand in operands
        )
    if condition.get("operator") == "and" and isinstance(operands, list):
        return any(_excludes_ability_unit(operand) for operand in operands)
    return False


def _is_keyword_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(k, str) and k for k in value)


def _includes_keyword(keywords: Any, keyword: str) -> bool:
    lower = keyword.lower()
    return any(isinstance(c, str) and c.lower() == lower for c in keywords)


def translate_selection(
    plan: dict[str, Any],
    node: dict[str, Any],
    source: BuffSource,
    opts: dict[str, Any],
    out: dict[str, Any],
) -> None:
    """Offer a planned unit selection as one lever, gated on the selected unit's keywords, with
    the selection (and any roll) in ``requires``."""
    if plan["kind"] in ("skip", "none"):
        return
    if plan["kind"] == "unsupported":
        out["unsupported"].append({"reason": plan["reason"], "effectFragment": node})
        return
    offer_lever(
        plan["effect"],
        source,
        opts,
        out,
        {
            "id": f"{opts['abilityId']}#selected",
            "label": plan["label"],
            "requires": plan["requires"],
            "applicability": plan.get("applicability"),
        },
    )


def offer_lever(
    effect: Any,
    source: BuffSource,
    opts: dict[str, Any],
    out: dict[str, Any],
    lever: dict[str, Any],
) -> None:
    """Translate ``effect`` and offer what it gives the crunched unit as one opt-in lever that
    requires ``lever["requires"]``. Levers nested in the effect keep their own choice and add
    those requirements to theirs; ``lever["applicability"]`` gates every buff."""
    from wh40kdc.cruncher import from_dsl as dsl

    sub: dict[str, Any] = {"applied": [], "unsupported": [], "activatable": []}
    dsl._walk(effect, source, opts, sub)
    applicability = lever.get("applicability")

    def gate(buff: Buff) -> Buff:
        return dsl._apply_applicability(buff, applicability) if applicability else buff

    out["unsupported"].extend(sub["unsupported"])
    for nested in sub["activatable"]:
        out["activatable"].append(
            {
                **nested,
                "buffs": [gate(b) for b in nested["buffs"]],
                "requires": [*lever["requires"], *(nested.get("requires") or [])],
            }
        )
    if sub["applied"]:
        buffs = [gate(b) for b in sub["applied"]]
        out["activatable"].append(
            {
                "id": lever["id"],
                "label": f"{lever['label']}: {dsl._label_for_buffs(buffs)}",
                "buffs": buffs,
                "requires": lever["requires"],
            }
        )


def is_provided_by_another_unit(source: BuffSource) -> bool:
    return source.get("kind") == "ability" and source.get("abilityKind") == "support"


def friendly_filter_excludes(node: dict[str, Any], opts: dict[str, Any]) -> bool:
    """Whether a friendly unit-filter target names keywords the crunched unit lacks. Only the
    plain keyword fields are read; a filter of alternatives is left to the alternatives check,
    and a missing keyword list keeps the filter permissive."""
    target = node.get("target")
    if (
        not isinstance(target, dict)
        or target.get("owner") != "friendly"
        or isinstance(target.get("any_of_filters"), list)
    ):
        return False
    keywords = opts["context"].get(
        "attackerKeywords" if opts["perspective"] == "attacker" else "targetKeywords"
    )
    if not _is_keyword_list(keywords):
        return False
    all_of: list[str] = target["all_of"] if _is_keyword_list(target.get("all_of")) else []
    any_of: list[str] | None = target["any_of"] if _is_keyword_list(target.get("any_of")) else None
    none_of: list[str] = target["none_of"] if _is_keyword_list(target.get("none_of")) else []
    return not (
        all(_includes_keyword(keywords, k) for k in all_of)
        and (any_of is None or any(_includes_keyword(keywords, k) for k in any_of))
        and not any(_includes_keyword(keywords, k) for k in none_of)
    )


#: The unit-ref naming the unit whose action fired the enclosing trigger.
_EVENT_SUBJECT = "event-subject"

#: Internal binding: the event's subject is another unit, so the effect never reaches the
#: buffed unit.
OTHER_UNIT = "other-unit"


def bind_event_subject(
    trigger: Any, effect: Any, context: EngineContext, perspective: str
) -> Any:
    """Bind ``event-subject`` effects when the trigger says who acts.

    ``this-unit`` names the ability's own unit. A friendly unit filter the buffed unit matches
    names the buffed unit; one it fails names another unit. The binding is left in place when the
    subject is absent, an enemy, differs across alternative triggers, or cannot be checked, so the
    translator reports it. A nested ability part with its own trigger binds its own subject.
    Returns ``effect`` itself when nothing is rebound.
    """
    from wh40kdc.cruncher import from_dsl as dsl

    triggers = [
        item for item in (trigger if isinstance(trigger, list) else [trigger])
        if isinstance(item, dict)
    ]
    if not triggers:
        return effect
    subject = triggers[0].get("subject")
    if any(item.get("subject") != subject for item in triggers):
        return effect
    if subject == "this-unit":
        return _rebind_event_subject(effect, "this-unit")
    if not isinstance(subject, dict) or subject.get("owner") != "friendly":
        return effect
    verdict = dsl._matches_unit_filter(
        subject, context, "attacker" if perspective == "attacker" else "target"
    )
    if verdict == "unknown":
        return effect
    # `selected-unit`, not `this-unit`: in a supporting unit's ability `this-unit` names the
    # provider.
    return _rebind_event_subject(effect, _SELECTED_UNIT if verdict is True else OTHER_UNIT)


def _rebind_event_subject(node: Any, to: str) -> Any:
    """Returns ``node`` itself when it holds no ``event-subject`` target to rebind."""
    if isinstance(node, list):
        children = [_rebind_event_subject(child, to) for child in node]
        changed = any(child is not orig for child, orig in zip(children, node, strict=True))
        return children if changed else node
    if not isinstance(node, dict) or (
        node.get("type") == "ability-part" and node.get("trigger") is not None
    ):
        return node
    changed = False
    out: dict[str, Any] = {}
    for key, value in node.items():
        out[key] = (
            to
            if key == "target" and isinstance(value, str) and value == _EVENT_SUBJECT
            else _rebind_event_subject(value, to)
        )
        if out[key] is not value:
            changed = True
    return out if changed else node
