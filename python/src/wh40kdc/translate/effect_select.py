"""Selection and designation phrases for the effect containers: ``select-units`` and
``for-each-unit`` candidate phrases, bindings, ``designate-target`` and
``persistent-designation`` heads, and the duration clauses they weave in.

Python mirror of the selection helpers in ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_leadin import describe_selection_eligibility
from wh40kdc.translate.condition_refs import unit_ref_phrase
from wh40kdc.translate.effect_quantity import quantity_phrase
from wh40kdc.translate.effect_words import (
    Ctx,
    capitalize,
    dekebab,
    filter_subject,
    jstr,
    num,
    or_list,
    title_case,
)
from wh40kdc.translate.expiry import expiry_trail

Effect = dict[str, Any]


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def duration_clauses(duration: Any) -> tuple[str, str]:
    """Duration → (lead, trail); usage, not duration, controls frequency."""
    return ("", expiry_trail(duration))


def selection_ref_name(ref: Any, fallback: str) -> str:
    value = _obj(ref)
    identifier = value.get("selection_var")
    if identifier is None:
        identifier = value.get("event_var")
    if isinstance(identifier, str) and identifier:
        return f"the bound {dekebab(identifier.replace('_', '-'))}"
    return fallback


def selection_binding(sel: dict[str, Any]) -> str:
    binding = sel.get("bind_as")
    if not isinstance(binding, str) or not binding:
        return ""
    plural = selector_count(sel)[1]
    name = binding.replace("-", " ").replace("_", " ")
    return f", binding {'them' if plural else 'it'} as {name}"


def reference_origin(reference: Any) -> str:
    """Range/engagement origin phrase for a selector's ``filter.within``."""
    if reference == "bearer-transport":
        return "this model's unit's Transport"
    if reference == "bearer-unit":
        return "this model's unit"
    if reference == "this-model":
        return "this model"
    if reference == "this-unit":
        return "this model's unit"
    return unit_ref_phrase(reference, "the bearer")


def _selector_filter(sel: dict[str, Any]) -> dict[str, Any]:
    value = sel.get("filter")
    return value if isinstance(value, dict) else {}


def _selector_level(sel: dict[str, Any]) -> str:
    return "model" if _selector_filter(sel).get("level") == "model" else "unit"


def _selector_bounds(sel: dict[str, Any]) -> tuple[Any, Any]:
    count = sel.get("count")
    if not isinstance(count, dict):
        return (None, None)
    return count.get("min"), count.get("max")


def selection_model_filters(sel: dict[str, Any]) -> str:
    filt = _selector_filter(sel)
    names = (
        f" named {or_list([jstr(n) for n in filt['model_names']])}"
        if isinstance(filt.get("model_names"), list)
        else ""
    )
    unit_ids = filt.get("unit_ids")
    identity = (
        f" with unit ID {or_list([jstr(unit_id) for unit_id in unit_ids])}"
        if isinstance(unit_ids, list) and unit_ids
        else ""
    )
    excluded = filt.get("none_of")
    exclusions = ""
    if isinstance(excluded, list) and excluded:
        noun = "models" if _selector_level(sel) == "model" else "units"
        exclusions = f" (excluding {noun} with {or_list([jstr(k) for k in excluded])})"
    return names + identity + exclusions


def _eligibility(sel: dict[str, Any]) -> str:
    elig = sel.get("eligibility")
    return f" {describe_selection_eligibility(elig)}" if isinstance(elig, dict) else ""


def selector_noun(sel: dict[str, Any]) -> str:
    return "model" if _selector_filter(sel).get("level") == "model" else "unit"


def selector_subject(sel: dict[str, Any], plural: bool) -> str:
    subject = filter_subject(_selector_filter(sel)).removeprefix("all ")
    if plural:
        return subject
    subject = re.sub(r"\bunits\b", "unit", subject, count=1)
    subject = re.sub(r"\bmodels\b", "model", subject, count=1)
    return re.sub(r"\bthat are\b", "that is", subject, count=1)


def selector_count(sel: dict[str, Any]) -> tuple[str, bool]:
    count = sel.get("count")
    bounds: dict[str, Any] = count if isinstance(count, dict) else {}
    minimum = bounds.get("min")
    maximum = bounds.get("max")

    def quantity(value: Any) -> str:
        if isinstance(value, dict):
            return quantity_phrase(value)
        return "one" if num(value) == 1 else jstr(value)

    if minimum is not None and minimum == maximum:
        return quantity(minimum), maximum != 1
    if minimum is not None and maximum is not None and minimum != 0:
        return f"from {quantity(minimum)} through {quantity(maximum)}", maximum != 1
    if maximum is not None:
        return f"up to {quantity(maximum)}", maximum != 1
    if minimum is not None:
        # "Select one or more models", not "at least one models".
        return ("one or more" if minimum == 1 else f"at least {quantity(minimum)}"), True
    return "each", False


def select_units_subject(sel: Any) -> str:
    sel = _obj(sel)
    phrase, plural = selector_count(sel)
    bounds = sel.get("count") if isinstance(sel.get("count"), dict) else {}
    maximum = bounds.get("max")
    minimum = bounds.get("min")
    cap = maximum if isinstance(maximum, dict) and (minimum is None or minimum == 0) else None
    if cap is not None:
        cap_phrase = quantity_phrase(cap)
        if cap.get("count_of") is not None:
            phrase = "any number of"
            tail = f" (at most {cap_phrase})"
        else:
            before, _, after = cap_phrase.partition(" (")
            phrase = f"up to {before}"
            tail = f" ({after.removesuffix(')')})"
    else:
        tail = ""
    return (
        f"{phrase} {selector_subject(sel, plural)}{tail}{_eligibility(sel)}"
        f"{selection_limit(sel.get('limit'), selector_noun(sel))}"
    )


def selection_limit(limit: Any, noun: str) -> str:
    limit = _obj(limit)
    if not limit:
        return ""
    count = "once" if num(limit.get("count")) == 1 else f"{jstr(limit.get('count'))} times"
    return (
        f" (each {noun} can be selected for this ability at most {count} "
        f"per {jstr(limit.get('period')).replace('-', ' ')} across your army)"
    )


def selection_limit_phrase(limit: dict[str, Any], noun: str) -> str:
    return selection_limit(limit, noun).strip(" ()")


def select_units_engagement(sel: Any) -> str:
    # Canonical selector relations are rendered by filterSubject as part of the subject.
    return ""


def select_units_plural(sel: Any) -> bool:
    return selector_count(_obj(sel))[1]


def selected_recipient(text: str, sel: Any) -> str:
    sel = _obj(sel)
    noun = _selector_level(sel)
    recipient = f"each selected {noun}" if select_units_plural(sel) else f"the selected {noun}"
    # Membership remains relative to the bearer/current unit, not the selected recipient.
    membership = "\ue000"
    text = text.replace("in the unit", membership)
    text = re.sub(
        r"\b[Tt]he unit's\b",
        lambda mt: f"Each selected {noun}'s" if mt.group(0)[0] == "T" else f"{recipient}'s",
        text,
    )
    return re.sub(
        r"\b[Tt]he unit\b",
        lambda mt: f"Each selected {noun}" if mt.group(0)[0] == "T" else recipient,
        text,
    ).replace(membership, "in the unit")


def selected_context(ctx: Ctx, sel: Any) -> Ctx:
    selected_model = _selector_level(_obj(sel)) == "model"
    return {
        **ctx,
        "selected_unit": not selected_model,
        "selected_model": selected_model,
        "unit_subject": None,
    }


# Where a selector's member_of puts its models.
_MEMBER_OF = {
    "bearer-unit": " in this model's unit",
    "embarked-in-bearer": " embarked within this model",
    "target": " in the target unit",
}


def for_each_unit_subject(sel: Any) -> str:
    subject = selector_subject(sel, False)
    limit = (
        selection_limit(sel.get("limit"), selector_noun(sel))
        if isinstance(sel.get("limit"), dict)
        else ""
    )
    return f"{subject}{_eligibility(sel)}{selection_binding(sel)}{limit}"


def designation_label(designation: Any) -> str:
    """ "(your Suppressed target)" — a designate-target mark's parenthetical."""
    label = title_case(jstr(designation))
    return f" (your {label})" if re.search(r"\bTarget$", label) else f" (your {label} target)"


def designation_target_subject(select: dict[str, Any]) -> str:
    selector = _obj(select.get("selector"))
    if select.get("kind") == "objective":
        from wh40kdc.translate.effect_bind import objective_selector_phrase

        return objective_selector_phrase(selector)
    return f"{select_units_subject(selector)}{selection_binding(selector)}"


def designation_attacker_phrase(applies: Any, block: bool = False) -> str:
    applies = _obj(applies)
    model = applies.get("attacker_filter")
    unit = applies.get("attacker_unit_filter")
    if isinstance(unit, dict):
        model_subject = (
            selector_subject(
                {"filter": {**_obj(model), "owner": "any", "level": "model"}},
                False,
            )
            if isinstance(model, dict)
            else "model"
        )
        unit_subject = selector_subject(
            {"filter": {"owner": "friendly", **unit}},
            False,
        )
        attacker = f"a {model_subject} in a {unit_subject}"
    elif isinstance(model, dict):
        model_filter = {"owner": "friendly", "level": "model", **model}
        attacker = f"a {selector_subject({'filter': model_filter}, False)}"
    else:
        attacker = "a friendly unit"
    action = "makes an attack against it" if block else "attacks it"
    return f"each time {attacker} {action}"


def designated_attack_when(applies: dict[str, Any]) -> str:
    source = selection_ref_name(applies.get("beneficiary"), "the selected beneficiary unit")
    target = selection_ref_name(applies.get("reference"), "the selected designated target")
    return f"each time {source} makes an attack against {target}"


def designated_recipient_context(applies: Any, ctx: Ctx) -> Ctx:
    applies = _obj(applies)
    if applies.get("to") != "bound-unit-attacks-reference":
        return ctx
    return {
        **ctx,
        "unit_subject": selection_ref_name(
            applies.get("beneficiary"), "the selected beneficiary unit"
        ),
    }


def persistent_designation_name(designation: Any, kind: Any) -> str:
    label = title_case(jstr(designation))
    if kind == "objective":
        return f"your {label}" if re.search(r"\bMarker$", label) else f"your {label} marker"
    return f"your {label}" if re.search(r"\bTarget$", label) else f"your {label} target"


def _persistent_select(e: Effect) -> dict[str, Any]:
    select = _obj(e.get("select"))
    selector = _obj(select.get("selector"))
    return {"kind": select.get("kind"), "selector": selector}


def _persistent_kind(e: Effect) -> str:
    return "objective" if _persistent_select(e).get("kind") == "objective" else "unit"


def _persistent_designation_label(designation: Any, kind: Any) -> str:
    return f" ({persistent_designation_name(designation, kind)})"


def persistent_designation_supported(e: Effect) -> bool:
    kind = _persistent_kind(e)
    consumer = _obj(e.get("consumer"))
    beneficiary = consumer.get("beneficiary")
    if beneficiary not in ("this-model", "this-unit"):
        return False
    return (
        kind == "unit" and consumer.get("relation") == "attacks-selected-unit"
    ) or (
        kind == "objective" and consumer.get("relation") == "within-selected-marker"
    )


def persistent_designation_lead(e: Effect) -> str:
    selected = _persistent_select(e)
    selector = selected["selector"]
    kind = selected["kind"]
    label = _persistent_designation_label(e.get("designation"), kind)
    if kind == "objective":
        from wh40kdc.translate.effect_bind import objective_selector_phrase

        selection = objective_selector_phrase(selector)
    else:
        selection = select_units_subject(selector)
    clauses = [f"select {selection}{selection_binding(selector)}{label}."]
    if e.get("allow_while_embarked") is True:
        clauses.append("This selection can be made while this unit is embarked.")
    lifecycle = _obj(e.get("lifecycle"))
    replace = _obj(lifecycle.get("replace"))
    if replace:
        name = persistent_designation_name(e.get("designation"), kind)
        modal = "you may" if replace.get("optional") else "you must"
        replacement_selection = f"{selection}{selection_binding(selector)}"
        clauses.append(
            f"When {name} is destroyed, {modal} select {replacement_selection} to replace it."
        )
    if lifecycle.get("exclusivity") == "one-active-per-bearer-unit":
        clauses.append("Only one such designation can be active for this bearer unit.")
    return " ".join(clauses)


def persistent_designation_when(e: Effect) -> str:
    selected = _persistent_select(e)
    consumer = _obj(e.get("consumer"))
    name = persistent_designation_name(e.get("designation"), selected.get("kind"))
    bearer = (
        "a model in this unit"
        if consumer.get("beneficiary") == "this-unit"
        else "this model"
    )
    if consumer.get("relation") == "within-selected-marker":
        relation = f"while {bearer} is within range of {name}"
    else:
        relation = f"each time {bearer} makes an attack against it"
    _, trail = duration_clauses(e.get("duration"))
    return f"{capitalize(trail)}, {relation}" if trail else relation


def persistent_designation_replacement(e: Effect) -> str:
    kind = _persistent_kind(e)
    replacement = _obj(e.get("replacement"))
    previous = selection_ref_name(
        replacement.get("reference"),
        persistent_designation_name(e.get("designation"), kind),
    )
    label = _persistent_designation_label(e.get("designation"), kind)
    embarked = (
        ". This selection can be made while this unit is embarked"
        if e.get("allow_while_embarked") is True
        else ""
    )
    modal = "you may" if replacement.get("optional") else "you must"
    noun = "objective marker" if kind == "objective" else "enemy unit"
    return (
        f"when {previous} is destroyed, {modal} select one new {noun}{label} to replace "
        "this bearer unit's existing designation. Its existing effects apply to the new "
        f"target without changing the designation's expiry{embarked}"
    )
