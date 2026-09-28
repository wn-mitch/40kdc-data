"""Selection and designation phrases for the effect containers: ``select-units`` and
``for-each-unit`` candidate phrases, bindings, ``designate-target`` and
``persistent-designation`` heads, and the duration clauses they weave in.

Python mirror of the selection helpers in ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_leadin import describe_selection_eligibility
from wh40kdc.translate.effect_words import Ctx, capitalize, dekebab, jstr, num, or_list, title_case
from wh40kdc.translate.timing import describe_timing

Effect = dict[str, Any]


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def duration_clauses(duration: Any) -> tuple[str, str]:
    """Duration → (lead, trail). ``lead`` fronts the sentence; ``trail`` sits before the effect."""
    trails = {
        "attack-sequence": "until that unit finishes resolving its attacks",
        "resolution": "when resolving this use",
        "phase": "until the end of the phase",
        "turn": "until the end of the turn",
        "battle": "for the rest of the battle",
        "battle-round": "until the end of the battle round",
        "until-next-command-phase": "until the start of your next Command phase",
        "until-next-movement-phase": "until the start of your next Movement phase",
        "until-next-battle-round": "until the start of the next battle round",
        "until-start-next-turn": "until the start of your next turn",
    }
    if duration == "one-use":
        return ("once per battle", "")
    if isinstance(duration, str) and duration in trails:
        return ("", trails[duration])
    return ("", "")


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
    if isinstance(binding, str) and binding:
        it = "them" if sel.get("selection_mode") == "any-number" else "it"
        return f", binding {it} as {dekebab(binding.replace('_', '-'))}"
    return ""


def reference_origin(reference: Any) -> str:
    """Range/engagement origin phrase for a selector's ``reference``."""
    if reference == "bearer-transport":
        return "this model's unit's Transport"
    return "this model's unit" if reference == "bearer-unit" else "the bearer"


def selection_model_filters(sel: dict[str, Any]) -> str:
    names = (
        f" named {or_list([jstr(n) for n in sel['model_names']])}"
        if isinstance(sel.get("model_names"), list)
        else ""
    )
    excluded = sel.get("excluded_keywords")
    exclusions = ""
    if isinstance(excluded, list) and excluded:
        noun = "models" if sel.get("target_kind") == "model" else "units"
        exclusions = f" (excluding {noun} with {or_list([jstr(k) for k in excluded])})"
    return names + exclusions


def _eligibility(sel: dict[str, Any]) -> str:
    elig = sel.get("eligibility")
    return f" {describe_selection_eligibility(elig)}" if isinstance(elig, dict) else ""


def select_units_subject(sel: Any) -> str:
    """ "one enemy Vehicle unit within 12\\"" — the ``select-units`` selector phrase."""
    sel = _obj(sel)
    kw = " ".join(title_case(jstr(k)) for k in (sel.get("keywords") or []))
    exact = sel.get("count")
    if (
        exact is None
        and sel.get("min_count") is not None
        and num(sel.get("min_count")) == num(sel.get("max_count"))
    ):
        exact = sel.get("max_count")
    bounded = sel.get("min_count") is not None and exact is None
    count = exact if exact is not None else sel.get("max_count")
    single = num(count) == 1
    noun_base = "model" if sel.get("target_kind") == "model" else "unit"
    noun = noun_base if single else f"{noun_base}s"
    if exact is not None:
        quantity = "one" if single else jstr(count)
    elif bounded:
        quantity = f"from {jstr(sel.get('min_count'))} through {jstr(sel.get('max_count'))}"
    else:
        quantity = f"up to {jstr(count)}"
    bound_origin = (
        f" of {selection_ref_name(sel['within_inches_from'], 'the bound source unit')}"
        if sel.get("within_inches_from")
        else ""
    )
    if sel.get("within_inches") is not None:
        within = f' within {jstr(sel["within_inches"])}"{bound_origin}'
    elif sel.get("range_inches") is not None:
        origin = bound_origin or f" of {reference_origin(sel.get('reference'))}"
        within = f' within {jstr(sel["range_inches"])}"{origin}'
    else:
        within = ""
    if sel.get("visible_to"):
        visible = f" visible to {selection_ref_name(sel['visible_to'], 'the bound source unit')}"
    elif sel.get("visibility_required") is True:
        visible = " visible to the bearer"
    else:
        visible = ""
    inclusive = ", inclusive" if bounded else ""
    return (
        f"{quantity} {jstr(sel.get('owner'))}{f' {kw}' if kw else ''} "
        f"{noun}{selection_model_filters(sel)}"
        f"{inclusive}{within}{visible}{_eligibility(sel)}"
    )


def selection_limit_phrase(limit: dict[str, Any], noun: str) -> str:
    count = "once" if limit.get("count") == 1 else f"{jstr(limit.get('count'))} times"
    return (
        f"each {noun} can be selected for this ability at most {count} "
        f"per {dekebab(jstr(limit.get('period')))} across your army"
    )


def select_units_engagement(sel: Any) -> str:
    sel = _obj(sel)
    parts: list[str] = []
    noun = "model" if sel.get("target_kind") == "model" else "unit"
    origin = reference_origin(sel.get("reference"))
    if sel.get("engagement_relation") == "engaged-with-bearer":
        parts.append(f"For each selected {noun}, it must be within Engagement Range of {origin}.")
    if sel.get("engagement_relation") == "not-engaged-with-bearer":
        parts.append(
            f"For each selected {noun}, it must not be within Engagement Range of {origin}."
        )
    limit = sel.get("selection_limit")
    if limit:
        parts.append(f"{capitalize(selection_limit_phrase(limit, noun))}.")
    return " ".join(parts)


def select_units_plural(sel: Any) -> bool:
    sel = _obj(sel)
    count = sel.get("count") if sel.get("count") is not None else sel.get("max_count")
    return num(count) > 1


def selected_recipient(text: str, sel: Any) -> str:
    sel = _obj(sel)
    noun = "model" if sel.get("target_kind") == "model" else "unit"
    recipient = f"each selected {noun}" if select_units_plural(sel) else f"the selected {noun}"
    text = re.sub(
        r"\b[Tt]he unit's\b",
        lambda mt: f"Each selected {noun}'s" if mt.group(0)[0] == "T" else f"{recipient}'s",
        text,
    )
    return re.sub(
        r"\b[Tt]he unit\b",
        lambda mt: f"Each selected {noun}" if mt.group(0)[0] == "T" else recipient,
        text,
    )


def selected_context(ctx: Ctx, sel: Any) -> Ctx:
    selected_model = _obj(sel).get("target_kind") == "model"
    return {
        **ctx,
        "selected_unit": not selected_model,
        "selected_model": selected_model,
        "unit_subject": None,
    }


def for_each_unit_subject(sel: Any) -> str:
    """ "enemy unit within 6\\"" — the ``for-each-unit`` selector phrase."""
    sel = _obj(sel)
    keyword_list = (
        [title_case(jstr(k)) for k in sel["keywords"]]
        if isinstance(sel.get("keywords"), list)
        else []
    )
    if not keyword_list:
        keywords = ""
    elif sel.get("keyword_match") == "any":
        keywords = f"{or_list(keyword_list)} "
    else:
        keywords = f"{' '.join(keyword_list)} "
    within = ""
    if sel.get("within_inches") is not None:
        within += f' within {jstr(sel["within_inches"])}"'
    if sel.get("within_objective"):
        within += (
            " within range of "
            f"{selection_ref_name(sel['within_objective'], 'the selected objective marker')}"
        )
    origin = reference_origin(sel.get("reference"))
    rel = sel.get("engagement_relation")
    engagement = (
        f" in Engagement Range of {origin}"
        if rel == "engaged-with-bearer"
        else f" not in Engagement Range of {origin}"
        if rel == "not-engaged-with-bearer"
        else ""
    )
    noun = "model" if sel.get("target_kind") == "model" else "unit"
    eligibility = (
        f" {describe_selection_eligibility(sel['eligibility'])}"
        if sel.get("eligibility") is not None
        else ""
    )
    member = " in this model's unit" if sel.get("member_of") == "bearer-unit" else ""
    return (
        f"{jstr(sel.get('owner'))} "
        f"{keywords}{noun}{selection_model_filters(sel)}{member}{within}{engagement}"
        f"{eligibility}{selection_binding(sel)}"
    )


def designation_label(designation: Any) -> str:
    """ "(your Suppressed target)" — a designate-target mark's parenthetical."""
    label = title_case(jstr(designation))
    return f" (your {label})" if re.search(r"\bTarget$", label) else f" (your {label} target)"


def _designation_target_subject_base(sel: dict[str, Any]) -> str:
    disposition = "friendly" if sel.get("scope") == "friendly-unit" else "enemy"
    keywords = (
        [title_case(jstr(k)) for k in sel["keywords"]]
        if isinstance(sel.get("keywords"), list)
        else []
    )
    join = " or " if sel.get("keyword_match") == "any" else " "
    keyword_text = f" {join.join(keywords)}" if keywords else ""
    reference = reference_origin(sel.get("reference"))
    if sel.get("within_inches_from"):
        origin = f" of {selection_ref_name(sel['within_inches_from'], 'the bound source unit')}"
    elif sel.get("reference"):
        origin = f" of {reference}"
    else:
        origin = ""
    within = (
        f' within {jstr(sel["within_inches"])}"{origin}'
        if sel.get("within_inches") is not None
        else ""
    )
    if sel.get("visible_to"):
        visible = f" visible to {selection_ref_name(sel['visible_to'], 'the bound source unit')}"
    elif sel.get("visibility_required"):
        visible = f" visible to {reference}"
    else:
        visible = ""
    excluded = sel.get("excluded_keywords")
    exclusions = (
        f" (excluding {' and '.join(jstr(k) for k in excluded)} units)"
        if isinstance(excluded, list) and excluded
        else ""
    )
    return f"{disposition}{keyword_text} unit{within}{visible}{exclusions}"


def designation_target_subject(sel: dict[str, Any]) -> str:
    limit = (
        f" ({selection_limit_phrase(sel['selection_limit'], 'unit')})"
        if sel.get("selection_limit")
        else ""
    )
    elig = (
        f" {describe_selection_eligibility(sel['eligibility'])}"
        if sel.get("eligibility") is not None
        else ""
    )
    return _designation_target_subject_base(sel) + elig + selection_binding(sel) + limit


def designation_attacker_phrase(applies: Any, block: bool = False) -> str:
    applies = _obj(applies)
    model_kw = (
        " ".join(applies["attacker_keywords"])
        if applies.get("attacker_keywords") is not None
        else None
    )
    unit_kw = (
        " ".join(applies["attacker_unit_keywords"])
        if applies.get("attacker_unit_keywords") is not None
        else None
    )
    if unit_kw:
        attacker = f"a{f' {model_kw}' if model_kw else ''} model in a friendly {unit_kw} unit"
    elif model_kw:
        attacker = f"a friendly {model_kw} model"
    else:
        attacker = "a friendly unit"
    return f"each time {attacker} {'makes an attack against it' if block else 'attacks it'}"


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


def persistent_designation_name(designation: Any, scope: Any) -> str:
    label = title_case(jstr(designation))
    if scope == "objective-marker":
        return f"your {label}" if re.search(r"\bMarker$", label) else f"your {label} Marker"
    return f"your {label}" if re.search(r"\bTarget$", label) else f"your {label} target"


def _persistent_designation_label(designation: Any, scope: Any) -> str:
    return f" ({persistent_designation_name(designation, scope)})"


def persistent_designation_supported(e: Effect) -> bool:
    sel = _obj(e.get("select"))
    consumer = _obj(e.get("consumer"))
    if consumer.get("beneficiary") not in ("bearer", "unit"):
        return False
    return (
        sel.get("scope") == "enemy-unit" and consumer.get("relation") == "attacks-selected-unit"
    ) or (
        sel.get("scope") == "objective-marker"
        and consumer.get("relation") == "within-selected-marker"
    )


def persistent_designation_lead(e: Effect) -> str:
    sel = _obj(e.get("select"))
    noun = "objective marker" if sel.get("scope") == "objective-marker" else "enemy unit"
    label = _persistent_designation_label(e.get("designation"), sel.get("scope"))
    lead = f"{describe_timing(sel['timing'])}, select" if sel.get("timing") else "select"
    clauses = [f"{lead} one {noun}{label}{selection_binding(sel)}."]
    if sel.get("allow_while_embarked"):
        clauses.append("This selection can be made while this unit is embarked.")
    lifecycle = _obj(e.get("lifecycle"))
    replacement = lifecycle.get("replace")
    if sel.get("selection_policy") == "replace-on-destroyed" and replacement:
        replacement = _obj(replacement)
        name = selection_ref_name(
            replacement.get("reference"),
            persistent_designation_name(e.get("designation"), sel.get("scope")),
        )
        modal = "you may" if replacement.get("optional") else "you must"
        clauses.append(f"When {name} is destroyed, {modal} select one new {noun} to replace it.")
    if lifecycle.get("exclusivity") == "one-active-per-bearer-unit":
        clauses.append("Only one such designation can be active for this bearer unit.")
    if lifecycle.get("expiry") == "battle-end" and e.get("duration") != "battle":
        clauses.append("This designation expires at the end of the battle.")
    return " ".join(clauses)


def persistent_designation_when(e: Effect) -> str:
    sel = _obj(e.get("select"))
    consumer = _obj(e.get("consumer"))
    name = selection_ref_name(
        consumer.get("reference"),
        persistent_designation_name(e.get("designation"), sel.get("scope")),
    )
    bearer = "a model in this unit" if consumer.get("beneficiary") == "unit" else "this model"
    if consumer.get("relation") == "within-selected-marker":
        relation = f"while {bearer} is within range of {name}"
    else:
        relation = (
            f"each time {bearer} makes an attack against "
            f"{name if consumer.get('reference') else 'it'}"
        )
    _, trail = duration_clauses(e.get("duration"))
    return f"{capitalize(trail)}, {relation}" if trail else relation


def persistent_designation_replacement(e: Effect) -> str:
    sel = _obj(e.get("select"))
    replacement = _obj(_obj(e.get("lifecycle")).get("replace"))
    previous = selection_ref_name(
        replacement.get("reference"),
        persistent_designation_name(e.get("designation"), sel.get("scope")),
    )
    label = _persistent_designation_label(e.get("designation"), sel.get("scope"))
    embarked = (
        ". This selection can be made while this unit is embarked"
        if sel.get("allow_while_embarked")
        else ""
    )
    modal = "you may" if replacement.get("optional") else "you must"
    return (
        f"when {previous} is destroyed, {modal} select one new enemy unit{label} to replace "
        "this bearer unit's "
        f"existing designation{selection_binding(sel)}. Its existing effects apply to the new "
        "target without "
        f"changing the designation's battle-end expiry{embarked}"
    )
