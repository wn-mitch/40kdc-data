"""The ``named-region-state`` container and the ``resource-action-menu`` container's
menu phrases. Nested effects render through the ``inline`` callback the container
describer supplies.

Python mirror of the named-region and menu helpers in ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wh40kdc.translate.condition import Condition, describe_condition
from wh40kdc.translate.effect_select import select_units_subject
from wh40kdc.translate.effect_words import (
    Ctx,
    capitalize,
    dekebab,
    filter_subject,
    jstr,
    range_phrase,
    region_phrase,
    resource_noun,
    title_case,
)
from wh40kdc.translate.expiry import expiry_trail
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


def _region(value: Any) -> str:
    value = _rec(value)
    rule = _rec(value.get("rule_region"))
    if rule.get("region_id") is not None:
        return _title(rule["region_id"])
    return _title(value.get("region_id"))


def _prefix(m: dict[str, Any]) -> str:
    region = _region(m.get("region_ref"))
    producer = _rec(m.get("producer"))
    sentences: list[str] = []
    for entry in _items(producer.get("baseline")):
        baseline = _rec(entry)
        duration = expiry_trail(baseline.get("duration"))
        trail = f" {duration}" if duration else ""
        sentences.append(
            f"{capitalize(region_phrase(_rec(baseline.get('region'))))} "
            f"is within {region}{trail}."
        )
    for entry in _items(producer.get("phase_extensions")):
        extension = _rec(entry)
        trigger = " or ".join(
            phrase
            for phrase in (
                describe_trigger(item)
                for item in normalize_triggers(extension.get("trigger"))
            )
            if phrase
        )
        duration = expiry_trail(extension.get("duration"))
        trail = f" {duration}" if duration else ""
        sentences.append(
            f"{capitalize(trigger)}, if "
            f"{describe_condition(_rec(extension.get('condition')))}, "
            f"{region_phrase(_rec(extension.get('region')))} is within {region}{trail} "
            "(evaluated once at that time)."
        )
    for entry in _items(producer.get("additive_extensions")):
        addition = _rec(entry)
        # "one or more friendly X units": the quantifier replaces the filter's own "all".
        source = filter_subject(_rec(addition.get("filter"))).removeprefix("all ")
        sentences.append(
            f"The area within {range_phrase(addition.get('range'))} of one or more "
            f"{source} is within {region}, "
            "continuously as those units move."
        )
    return " ".join(sentences)


def _subject(m: dict[str, Any]) -> str:
    consumer = _rec(m.get("consumer"))
    return filter_subject(_rec(consumer.get("beneficiary_filter")))


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
    subject = _subject(m)
    effect = inline(_rec(branch.get("effect")), {**ctx, "unit_subject": subject})
    if conditional:
        return effect
    if not qualified:
        return f"{capitalize(effect)}."
    condition = _rec(consumer.get("qualified_condition"))
    if condition:
        return f"If {describe_condition(condition)}, {effect} instead"
    membership = _rec(consumer.get("membership"))
    region = _region(m.get("region_ref"))
    relation = _relation(membership.get("relation"))
    membership_subject = "such a unit" if whole_unit else "such a model"
    return f"If {membership_subject} is {relation} {region}, {effect} instead"


def describe_named_region_state(m: dict[str, Any], ctx: Ctx, inline: Inline) -> str:
    # A producer-only state declares the region and nothing reads it here: its sentences, as one
    # clause the caller finishes ("If …, your deployment zone is within …").
    if m.get("consumer") is None:
        return _declared_region(_prefix(m))
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


def _menu_action_eligibility_clause(elig: Any) -> str:
    if not isinstance(elig, dict):
        return ""
    has_filter = elig.get("filter") is not None or elig.get("count") is not None
    requirements = [describe_condition(c) for c in (elig.get("requires") or [])]
    if not has_filter and not requirements:
        return ""
    parts: list[str] = []
    if has_filter:
        selector = {
            "filter": elig.get("filter") or {},
            "count": elig.get("count") or {"min": 1, "max": 1},
        }
        parts.append(f"only usable by {select_units_subject(selector)}")
    if requirements:
        parts.append(" and ".join(requirements))
    return f" ({', '.join(parts)})"


def _menu_action_duration_clause(duration: Any) -> str:
    if duration == "phase":
        return "until the end of the phase"
    if duration == "turn":
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


def _declared_region(sentences: str) -> str:
    """The region's sentences as one clause: the first letter lowered, the last full stop left to
    the caller."""
    clause = sentences[:-1] if sentences.endswith(".") else sentences
    return clause[:1].lower() + clause[1:]
