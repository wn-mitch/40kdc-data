"""Humanize an Ability-DSL ``effect`` tree into natural English — the
``ability.print()`` of the dataset.

Output is an *approximation* generated purely from the structured data (no
external rules text): subject-first, GW-datasheet voice, with duration woven
into the sentence and single-leaf conditionals inlined. ASCII-only; pinned
byte-for-byte across the ports by the ``conformance/effect-translation`` corpus.

This module holds the block form and the top-level sentence; the inline form is in
``effect_inline`` and single effects are in ``effect_leaf`` /
``effect_leaf_board``. Python mirror of ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition import Condition, dekebab
from wh40kdc.translate.condition_leadin import condition_lead_in
from wh40kdc.translate.effect_bind import roll_head, select_objective_block
from wh40kdc.translate.effect_inline import (
    choice_prompt,
    describe_effect_inline,
    describe_requirement,
    designate_when,
    dice_gate,
    dice_table_result_label,
    inline,
    leader_model_ability_grant_clause,
    leadership_test,
    part_head,
    part_inline,
    pool_text,
    roll_with_rider,
    stance_pick,
    usage_clause,
)
from wh40kdc.translate.effect_region import (
    capacity_clause,
    describe_menu_action,
    shared_usage_clause,
)
from wh40kdc.translate.effect_select import (
    designated_recipient_context,
    designation_label,
    designation_target_subject,
    duration_clauses,
    for_each_unit_subject,
    persistent_designation_lead,
    persistent_designation_replacement,
    persistent_designation_supported,
    persistent_designation_when,
    select_units_engagement,
    select_units_plural,
    select_units_subject,
    selected_context,
    selected_recipient,
    selection_binding,
)
from wh40kdc.translate.effect_words import (
    Ctx,
    capitalize,
    dice_case,
    is_num,
    jstr,
    test_name,
)
from wh40kdc.translate.timing import describe_timing, event_clause
from wh40kdc.translate.trigger import describe_trigger, normalize_triggers

Effect = dict[str, Any]

__all__ = [
    "Condition",
    "Ctx",
    "Effect",
    "describe_ability",
    "describe_applies_to",
    "describe_effect",
    "describe_effect_inline",
    "describe_scope",
    "describe_trigger",
    "duration_clauses",
]

_CONTAINER_TYPES = frozenset(
    {
        "roll",
        "select-objective",
        "sequence",
        "rules-bundle",
        "ability-part",
        "choice",
        "dice-gated",
        "dice-table",
        "dice-pool-allocation",
        "select-units",
        "for-each-unit",
        "designate-target",
        "persistent-designation",
        "stance-select",
        "risk-reward",
        "issue-orders",
        "resource-action-menu",
    }
)


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _is_container(x: Any) -> bool:
    return _obj(x).get("type") in _CONTAINER_TYPES


def _option_lines(e: Effect, indent: str, ctx: Ctx) -> list[str]:
    return [
        f"{indent}  - {jstr(_obj(o).get('name'))}: {inline(_obj(o).get('effect'), ctx)}."
        for o in (e.get("options") or [])
    ]


def describe_effect(e: Effect, depth: int = 0, ctx: Ctx | None = None) -> str:
    """Block translation of a *container* effect tree (multi-line, two-space indentation)."""
    ctx = ctx or {}
    indent = "  " * depth
    arrow = "-> " if depth > 0 else ""
    t = e.get("type")
    if t == "conditional":
        inner = _obj(e.get("effect"))
        lead = capitalize(condition_lead_in(_obj(e.get("condition"))))
        if _is_container(inner):
            return f"{indent}{lead}:\n" + describe_effect(inner, depth + 1, ctx)
        return f"{indent}{arrow}{lead}, {describe_effect_inline(inner, ctx)}."
    if t in ("rules-bundle", "sequence"):
        steps = e.get("steps") or []
        rider = roll_with_rider(steps, ctx)
        if rider:
            return f"{indent}{arrow}{capitalize(rider)}."
        return "\n".join(describe_effect(_obj(s), depth, ctx) for s in steps)
    if t == "ability-part":
        # A part is always a bullet of its ability, even at the top level.
        inner = _obj(e.get("effect"))
        if _is_container(inner):
            return f"{indent}-> {capitalize(part_head(e))}:\n" + describe_effect(
                inner, depth + 1, ctx
            )
        return f"{indent}-> {capitalize(part_inline(e, ctx))}."
    if t == "choice":
        lines = [f"{indent}  - {capitalize(inline(o, ctx))}." for o in (e.get("options") or [])]
        return f"{indent}{capitalize(choice_prompt(e))}:\n" + "\n".join(lines)
    if t == "dice-gated":
        if e.get("test"):
            return f"{indent}{arrow}{capitalize(leadership_test(e, ctx))}."
        return f"{indent}{arrow}{capitalize(dice_gate(e, ctx))}."
    if t == "roll":
        inner = _obj(e.get("effect"))
        head = f"{indent}{arrow}{capitalize(roll_head(e))}"
        if _is_container(inner):
            return f"{head}, then:\n" + describe_effect(inner, depth + 1, ctx)
        return f"{head}; then {describe_effect_inline(inner, ctx)}."
    if t == "select-objective":
        inner = _obj(e.get("effect"))
        nested = describe_effect(inner, depth + 1, ctx) if _is_container(inner) else None
        return select_objective_block(e, indent, arrow, nested, lambda x: inline(x, ctx))
    if t == "dice-table":
        lines = [f"{indent}{arrow}Roll one {dice_case(e.get('dice'))}:"]
        for o in e.get("outcomes") or []:
            o = _obj(o)
            label = dice_table_result_label(o.get("results"))
            lines.append(f"{indent}  - On {label}: {capitalize(inline(o.get('effect'), ctx))}.")
        return "\n".join(lines)
    if t == "dice-pool-allocation":
        up_to = (
            f" to activate up to {jstr(e['max_activations'])} of the following"
            if e.get("max_activations") is not None
            else " to activate the following"
        )
        lines = [f"{indent}{arrow}Roll {pool_text(e)}; allocate dice{up_to}:"]
        for o in e.get("options") or []:
            o = _obj(o)
            lines.append(
                f"{indent}  - {jstr(o.get('name'))} (requires "
                f"{describe_requirement(o.get('requirement'))}): "
                f"{inline(o.get('effect'), ctx)}."
            )
        return "\n".join(lines)
    if t == "select-units":
        return _select_units_block(e, depth, ctx, indent, arrow)
    if t == "leader-model-ability-grant":
        return f"{indent}{arrow}{capitalize(leader_model_ability_grant_clause(e, ctx))}."
    if t == "persistent-designation":
        if e.get("operation") == "replace":
            return f"{indent}{arrow}{capitalize(persistent_designation_replacement(e))}."
        if not persistent_designation_supported(e):
            return f"{indent}{arrow}[persistent-designation]."
        inner = _obj(_obj(e.get("consumer")).get("effect"))
        head = (
            f"{indent}{arrow}{capitalize(persistent_designation_lead(e))} "
            f"{persistent_designation_when(e)}"
        )
        if _is_container(inner):
            return f"{head}:\n" + describe_effect(inner, depth + 1, ctx)
        return f"{head}, {describe_effect_inline(inner, ctx)}."
    if t == "for-each-unit":
        inner = _obj(e.get("effect"))
        inner_ctx = selected_context(ctx, e.get("selector"))
        lead = f"For each {for_each_unit_subject(e.get('selector'))}"
        if _is_container(inner):
            return f"{indent}{lead}:\n" + describe_effect(inner, depth + 1, inner_ctx)
        return f"{indent}{lead}: {capitalize(describe_effect_inline(inner, inner_ctx))}."
    if t == "designate-target":
        return _designate_target_block(e, depth, ctx, indent, arrow)
    if t == "stance-select":
        when = (
            capitalize(event_clause(e["select"]))
            if isinstance(e.get("select"), str)
            else "At the start of your turn"
        )
        consum = " (each may be chosen once per battle)" if e.get("mode") == "consumable" else ""
        return "\n".join(
            [f"{indent}{arrow}{when}, {stance_pick(e)}{consum}:", *_option_lines(e, indent, ctx)]
        )
    if t == "risk-reward":
        risk = _obj(e.get("risk"))
        on_fail = inline(risk["on_fail"], ctx) if risk.get("on_fail") else "there is a consequence"
        reward = inline(e.get("reward"), ctx)
        return (
            f"{indent}{arrow}First take a {test_name(risk.get('test'))} test — on a failure, "
            f"{on_fail}; then {reward}."
        )
    if t == "issue-orders":
        n = jstr(e["count"]) if e.get("count") is not None else "one or more"
        rng = f' within {jstr(e["range"])}"' if e.get("range") is not None else ""
        eligible = _obj(e.get("eligible"))
        elig = f" {jstr(eligible['keyword'])}" if eligible.get("keyword") else ""
        head = (
            f"{indent}{arrow}Issue up to {n} Orders to eligible friendly{elig} units{rng}, each "
            "one of:"
        )
        return "\n".join([head, *_option_lines(e, indent, ctx)])
    if t == "resource-action-menu":
        su = shared_usage_clause(e.get("shared_usage"))
        intro = (
            f"Actions may be performed when their conditions are met. {capitalize(su)}"
            if su
            else "Actions may be performed when their conditions are met"
        )
        lines = [f"{indent}{arrow}{intro}:"]
        lines += [
            f"{indent}  - {describe_menu_action(_obj(a), ctx, inline)}"
            for a in (e.get("actions") or [])
        ]
        cap = capacity_clause(e.get("capacity"))
        return f"{indent}{cap}\n" + "\n".join(lines) if cap else "\n".join(lines)
    # Leaf at block position — a single capitalized sentence.
    return f"{indent}{arrow}{capitalize(describe_effect_inline(e, ctx))}."


def _select_units_block(e: Effect, depth: int, ctx: Ctx, indent: str, arrow: str) -> str:
    selector = _obj(e.get("selector"))
    inner = _obj(e.get("effect"))
    inner_ctx = selected_context(ctx, selector)
    engagement = select_units_engagement(selector)
    lead = f"Select {select_units_subject(selector)}{selection_binding(selector)}"
    header = f"{indent}{arrow}{lead}. {engagement}" if engagement else f"{indent}{arrow}{lead}"
    if _is_container(inner):
        bare = re.sub(r"\.$", "", header)
        if select_units_plural(selector):
            noun = "model" if selector.get("target_kind") == "model" else "unit"
            nested = describe_effect(inner, depth + 2, inner_ctx)
            return f"{bare}:\n{indent}  -> For each selected {noun}:\n{nested}"
        return f"{bare}:\n" + describe_effect(inner, depth + 1, inner_ctx)
    nested = selected_recipient(describe_effect_inline(inner, inner_ctx), selector)
    return f"{header} {capitalize(nested)}." if engagement else f"{header}: {nested}."


def _designate_target_block(e: Effect, depth: int, ctx: Ctx, indent: str, arrow: str) -> str:
    sel = _obj(e.get("select"))
    desig = designation_label(e["designation"]) if e.get("designation") else ""
    applies = _obj(e.get("applies"))
    inner = _obj(applies.get("effect"))
    # The mark's timing and duration are content: "After this unit shoots, select …".
    select_lead = (
        f"{capitalize(describe_timing(sel['timing']))}, select" if sel.get("timing") else "Select"
    )
    _, dur_trail = duration_clauses(e.get("duration"))
    when = designate_when(applies, True)
    when_clause = f"{capitalize(dur_trail)}, {when}" if dur_trail else capitalize(when)
    head = (
        f"{indent}{arrow}{select_lead} one {designation_target_subject(sel)}{desig}. {when_clause}"
    )
    recipient_ctx = designated_recipient_context(applies, ctx)
    if _is_container(inner):
        return f"{head}:\n" + describe_effect(inner, depth + 1, recipient_ctx)
    return f"{head}, {describe_effect_inline(inner, recipient_ctx)}."


def describe_scope(s: dict[str, Any] | None) -> str:
    """``Scope: aura (6"). Duration: phase.`` — retained for the legacy translate CLI footer."""
    if not s or (not s.get("range") and not s.get("duration")):
        return ""
    range_ = dekebab(s.get("range") or "")
    inches = f' ({jstr(s["range_inches"])}")' if s.get("range_inches") is not None else ""
    d = s.get("duration") or ""
    duration = (
        "until the start of the next battle round"
        if d == "until-next-battle-round"
        else "until the start of your next turn"
        if d == "until-start-next-turn"
        else dekebab(d)
    )
    return f"Scope: {range_}{inches}. Duration: {duration}."


def describe_applies_to(a: dict[str, Any] | None) -> str:
    """``Applies to: units with Possessed.`` — the roster-highlighting audience."""
    if not a:
        return ""
    required = a.get("required_keywords") or []
    excluded = a.get("excluded_keywords") or []
    if not required and not excluded:
        return ""
    base = f"units with {', '.join(required)}" if required else "all units"
    exc = f" (excluding {', '.join(excluded)})" if excluded else ""
    return f"Applies to: {base}{exc}."


def _assemble_sentence(parts: list[str]) -> str:
    body = ", ".join(p for p in parts if p)
    if body == "":
        return ""
    period = "" if body.endswith(".") or body.endswith(":") else "."
    return capitalize(body) + period


def describe_ability(a: dict[str, Any]) -> str:
    """Full natural-English text for an ability (effect + woven duration, plus a trailing
    ``Applies to:`` line when a curated filter is present)."""
    core = (
        _render_top_level(a["effect"], a.get("scope"), a.get("usage"), a.get("trigger"))
        if a.get("effect")
        else ""
    )
    applies = describe_applies_to(a.get("applies_to"))
    return "\n".join(p for p in (core, applies) if p)


def _condition_within_range(c: Any) -> Any:
    """The inch range of a top-level ``within`` condition, else None."""
    c = _obj(c)
    if c.get("type") != "within":
        return None
    inches = _obj(_obj(c.get("parameters")).get("range")).get("inches")
    return inches if is_num(inches) else None


def _render_top_level(e: Effect, scope: Any, usage: Any = None, trigger: Any = None) -> str:
    ctx: Ctx = {}
    dur_lead, trail = duration_clauses(_obj(scope).get("duration"))
    # An explicit usage limit supersedes the duration's coarse "once per battle" lead.
    lead = (
        usage_clause(usage)
        if isinstance(usage, list)
        or (isinstance(usage, dict) and usage.get("frequency") is not None)
        else dur_lead
    )
    # When a trigger's proximity just restates a within-range condition, render the range once.
    triggers = [t for t in normalize_triggers(trigger) if t.get("event") is not None]
    if any(t.get("event") in ("destroyed", "model-destroyed") for t in triggers):
        ctx["destroyed_trigger"] = True
    cond_range = _condition_within_range(
        e.get("condition") if e.get("type") == "conditional" else None
    )
    parts: list[str] = []
    for t in triggers:
        prox_inches = _obj(_obj(t.get("proximity")).get("range")).get("inches")
        restated = cond_range is not None and prox_inches == cond_range
        s = describe_trigger(
            {k: val for k, val in t.items() if k != "proximity"} if restated else t
        )
        # Two triggers that read the same are one trigger in English ("when X or when X").
        if s and s not in parts:
            parts.append(s)
    trig = " or ".join(parts)
    if e.get("type") == "conditional":
        inner = _obj(e.get("effect"))
        lead_in = condition_lead_in(_obj(e.get("condition")))
        if _is_container(inner):
            header = ", ".join(p for p in (trig, lead, lead_in, trail) if p)
            return capitalize(header) + ":\n" + describe_effect(inner, 1, ctx)
        return _assemble_sentence([trig, lead, lead_in, trail, describe_effect_inline(inner, ctx)])
    if _is_container(e):
        # A designation carrying its own duration renders it itself; don't repeat it in the head.
        own = (
            e.get("type") in ("designate-target", "persistent-designation")
            and e.get("duration") is not None
        )
        head = ", ".join(p for p in (trig, lead, "" if own else trail) if p)
        return (
            capitalize(head) + ":\n" + describe_effect(e, 1, ctx)
            if head
            else describe_effect(e, 0, ctx)
        )
    return _assemble_sentence([trig, lead, trail, describe_effect_inline(e, ctx)])
