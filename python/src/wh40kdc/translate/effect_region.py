"""The ``named-region-state`` container and the ``resource-action-menu`` container's
menu phrases. Nested effects render through the ``inline`` callback the container
describer supplies.

Python mirror of the named-region and menu helpers in ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from wh40kdc.translate.condition import Condition, describe_condition
from wh40kdc.translate.effect_words import (
    Ctx,
    dekebab,
    is_num,
    jstr,
    resource_noun,
    roll_name,
    signed,
    title_case,
)
from wh40kdc.translate.trigger import describe_trigger, normalize_triggers

Inline = Callable[[Any, Ctx], str]


def _rec(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _items(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _title(value: Any) -> str:
    return title_case(jstr(value))


def _relation(value: Any) -> str:
    return "wholly within" if jstr(value) == "wholly-within" else dekebab(jstr(value))


def _keywords(value: Any) -> str:
    return " or ".join(jstr(k) for k in value) if isinstance(value, list) else "?"


def _prefix(m: dict[str, Any]) -> str:
    region = _title(_rec(m.get("region_ref")).get("region_id"))
    producer = _rec(m.get("producer"))
    sentences: list[str] = []
    baseline = _items(producer.get("baseline"))
    for entry in baseline:
        zone = jstr(_rec(entry).get("zone"))
        if zone == "own-deployment-zone":
            sentences.append(f"Your deployment zone is always within {region}.")
        elif zone != "?":
            sentences.append(f"{_title(zone)} is always within {region}.")
    phase_ext = _items(producer.get("phase_extensions"))
    has_phase = False
    for entry in phase_ext:
        zone = jstr(_rec(entry).get("zone"))
        if zone == "no-mans-land":
            sentences.append(
                f"At the start of each phase, No Man's Land is within {region} until the end "
                "of that phase "
                "if you control at least half of its objective markers."
            )
            has_phase = True
        elif zone == "opponent-deployment-zone":
            sentences.append(
                "The same applies separately to your opponent's deployment zone."
                if has_phase
                else "At the start of each phase, your opponent's deployment zone is within "
                f"{region} until the "
                "end of that phase if you control at least half of its objective markers."
            )
            has_phase = True
        elif zone != "?":
            sentences.append(
                f"At the start of each phase, {_title(zone)} is within {region} until the end "
                "of that phase "
                "if you control at least half of its objective markers."
            )
            has_phase = True
    additions = _items(producer.get("additive_extensions"))
    for entry in additions:
        addition = _rec(entry)
        if addition.get("kind") != "unit-proximity":
            continue
        predicate = _rec(_rec(addition.get("source_gate")).get("unit_predicate"))
        kws = (
            " and ".join(jstr(k) for k in predicate["keywords"])
            if isinstance(predicate.get("keywords"), list)
            else "?"
        )
        sentences.append(
            f'The area within {jstr(addition.get("radius_inches"))}" of one or more friendly '
            f"{kws} units "
            f"is within {region}, continuously as those units move."
        )
    source_parts: list[str] = []
    for entry in additions:
        addition = _rec(entry)
        if addition.get("kind") == "unit-proximity":
            continue
        predicate = _rec(_rec(addition.get("source_gate")).get("unit_predicate"))
        if len(predicate) == 0:
            continue
        radius = (
            f' within {jstr(addition["radius_inches"])}"'
            if addition.get("radius_inches") is not None
            else ""
        )
        part = (
            f"{_title(predicate.get('faction'))} units with "
            f"{_keywords(predicate.get('keywords'))}{radius}"
        )
        if part:
            source_parts.append(part)
    unique = list(dict.fromkeys(source_parts))
    if unique:
        sentences.append(
            f"Selected objective markers extend {region} around {' or '.join(unique)}."
        )
    return " ".join(sentences)


def _subject(m: dict[str, Any]) -> str:
    gate = _rec(_rec(m.get("consumer")).get("beneficiary_gate"))
    faction = _title(gate["faction"]) if gate.get("faction") is not None else ""
    faction_part = f" from your {faction} army" if faction else " from your army"
    return f"Models in {_keywords(gate.get('keywords'))} units{faction_part}"


def _effect(branch: dict[str, Any], qualified: bool, ctx: Ctx, inline: Inline) -> str:
    effect = _rec(branch.get("effect"))
    modifier = _rec(effect.get("modifier"))
    roll = roll_name(modifier.get("roll"))
    if effect.get("type") == "re-roll":
        cnt = modifier.get("count") if is_num(modifier.get("count")) else None
        capped_roll = "" if jstr(modifier.get("roll")) == "any" else f"{roll} "
        if cnt is not None:
            failed = "failed " if modifier.get("subset") == "all-failures" else ""
            text = (
                f"can re-roll {'one' if cnt == 1 else f'up to {jstr(cnt)}'} "
                f"{failed}{capped_roll}"
                f"roll{'' if cnt == 1 else 's'}"
                f"{' of 1' if modifier.get('subset') == 'ones' else ''}"
            )
        elif modifier.get("result_scope") == "any-result":
            text = f"can re-roll the {roll} roll"
        elif modifier.get("subset") == "ones":
            text = f"can re-roll {roll} rolls of 1"
        else:
            text = f"can re-roll {roll} rolls"
    elif effect.get("type") == "roll-modifier" and modifier.get("value") is not None:
        text = f"gets {signed(modifier.get('operation'), modifier.get('value'))} to {roll}"
    else:
        text = inline(effect, ctx)
    if branch.get("optional") is False:
        text = re.sub(r"^can re-roll", "re-roll", text)
    if modifier.get("weapon_keyword") is not None:
        text += f" for {'those ' if qualified else ''}{jstr(modifier['weapon_keyword'])} attacks"
    return text


def _branch(
    m: dict[str, Any],
    whole_unit: bool,
    qualified: bool,
    conditional: bool,
    ctx: Ctx,
    inline: Inline,
) -> str:
    consumer = _rec(m.get("consumer"))
    branch = _rec(consumer.get("qualified_branch" if qualified else "default_branch"))
    effect = _effect(branch, qualified, ctx, inline)
    if conditional:
        return f"{_subject(m)} {effect}"
    if not qualified:
        return f"{_subject(m)} {effect}."
    condition = _rec(consumer.get("qualified_condition"))
    if condition.get("operator") is not None:
        return f"If {describe_condition(condition)}, those models {effect} instead"
    membership = _rec(consumer.get("membership"))
    region = _title(_rec(m.get("region_ref")).get("region_id"))
    relation = _relation(membership.get("relation"))
    subject = (
        f"If such a unit is {relation} {region}, those models"
        if whole_unit
        else f"If such a model is {relation} {region}, it"
    )
    return f"{subject} {effect} instead"


def describe_named_region_state(m: dict[str, Any], ctx: Ctx, inline: Inline) -> str:
    consumer = _rec(m.get("consumer"))
    whole_unit = _rec(consumer.get("membership")).get("unit_scope") == "whole-unit"
    attack = consumer.get("attack_condition")
    gate = f"For each qualifying attack ({describe_condition(attack)}): " if attack else ""
    default = _branch(m, whole_unit, False, False, ctx, inline)
    qualified = _branch(m, whole_unit, True, False, ctx, inline)
    return f"{_prefix(m)} {gate}{default} {qualified}"


def describe_named_region_conditional(
    m: dict[str, Any], condition: Condition, ctx: Ctx, inline: Inline
) -> str:
    consumer = _rec(m.get("consumer"))
    whole_unit = _rec(consumer.get("membership")).get("unit_scope") == "whole-unit"
    operands = condition.get("operands")
    negated = (
        condition.get("operator") == "not" and isinstance(operands, list) and len(operands) == 1
    )
    predicate = describe_condition(
        operands[0] if negated and isinstance(operands, list) else condition
    )
    default = _branch(m, whole_unit, False, True, ctx, inline)
    qualified = _branch(m, whole_unit, True, True, ctx, inline)
    if negated:
        return f"{_prefix(m)} Unless {predicate}, {default}. If {predicate}, {qualified}."
    return f"{_prefix(m)} When {predicate}, {qualified}. Otherwise, {default}."


def _menu_action_subject(elig: dict[str, Any]) -> str:
    requires = elig.get("requires_keyword") or []
    excludes = elig.get("excludes_keyword") or []
    if excludes:
        return f"one friendly non-{'/'.join(jstr(k) for k in excludes)} unit"
    if requires:
        return f"a friendly {' '.join(jstr(k) for k in requires)} unit"
    return "the unit"


def _menu_action_eligibility_clause(elig: Any) -> str:
    if not isinstance(elig, dict):
        return ""
    has_gate = bool(elig.get("requires_keyword")) or bool(elig.get("excludes_keyword"))
    requirements = [describe_condition(c) for c in (elig.get("requires") or [])]
    if not has_gate and not requirements:
        return ""
    parts: list[str] = []
    if has_gate:
        parts.append(f"only usable by {_menu_action_subject(elig)}")
    if requirements:
        parts.append(" and ".join(requirements))
    return f" ({', '.join(parts)})" if parts else ""


def _menu_action_duration_clause(duration: Any) -> str:
    if duration == "until-end-of-phase":
        return "until the end of the phase"
    if duration == "until-end-of-turn":
        return "until the end of the turn"
    return ""


def describe_menu_action(a: dict[str, Any], ctx: Ctx, inline: Inline) -> str:
    """One ``resource-action-menu`` action → a bullet body."""
    label = jstr(a.get("label") if a.get("label") is not None else a.get("id"))
    trig = " or ".join(
        s for s in (describe_trigger(t) for t in normalize_triggers(a.get("when"))) if s
    )
    cost = _rec(a.get("cost"))
    cost_phrase = (
        f"spend {jstr(cost.get('amount'))} "
        f"{resource_noun(cost.get('pool_id'), cost.get('resource_label'), cost.get('amount'))}"
    )
    eff = inline(a.get("effect") or {}, ctx)
    dur = _menu_action_duration_clause(a.get("duration"))
    usage_note = (
        " (may be triggered more than once per phase if a different unit performs it each time)"
        if _rec(a.get("usage")).get("repeatable_if_different_unit")
        else ""
    )
    body = ", ".join(
        p
        for p in (
            f"{trig}{_menu_action_eligibility_clause(a.get('eligibility'))}",
            cost_phrase,
            eff,
            dur,
        )
        if p
    )
    return f"{label}: {body}{usage_note}."


def capacity_clause(capacity: Any) -> str:
    """``capacity`` → the menu's per-refresh budget sentence; "" when absent."""
    if not capacity:
        return ""
    label = jstr(capacity.get("resource_label"))
    noun = jstr(capacity.get("ability_noun"))
    amount = jstr(capacity.get("amount"))
    refresh = {
        "battle-round": "battle round",
        "turn": "turn",
        "phase": "phase",
        "battle": "battle",
    }.get(jstr(capacity.get("refresh")), dekebab(jstr(capacity.get("refresh"))))
    return (
        f"This unit has a {label} of {amount}. In each {refresh}, it can use {noun} abilities "
        "whose combined "
        f"{label} does not exceed {amount}."
    )


def shared_usage_clause(su: Any) -> str:
    """``shared_usage`` → a menu-level sentence fragment; "" when absent."""
    if not su:
        return ""
    parts: list[str] = []
    unit_max = su.get("unit_max_manoeuvres_per_phase")
    if unit_max is not None:
        parts.append(
            "a unit may perform at most one action per phase"
            if unit_max == 1
            else f"a unit may perform at most {jstr(unit_max)} actions per phase"
        )
    default_max = su.get("default_manoeuvre_max_per_phase")
    if default_max is not None:
        parts.append(
            "unless stated otherwise, a given action may be triggered once per phase"
            if default_max == 1
            else "unless stated otherwise, a given action may be triggered up to "
            f"{jstr(default_max)} times per phase"
        )
    return "; ".join(parts)
