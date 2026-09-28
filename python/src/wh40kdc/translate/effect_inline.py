"""The inline (one-clause) form of every effect container, and the heads, prompts and
clauses the block form shares with it.

Python mirror of the inline renderers in ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition import dekebab, describe_condition
from wh40kdc.translate.condition_leadin import condition_lead_in
from wh40kdc.translate.effect_leaf import LEAF_TYPES, describe_leaf
from wh40kdc.translate.effect_region import (
    describe_menu_action,
    describe_named_region_conditional,
    describe_named_region_state,
)
from wh40kdc.translate.effect_select import (
    designated_attack_when,
    designated_recipient_context,
    designation_attacker_phrase,
    designation_label,
    designation_target_subject,
    duration_clauses,
    for_each_unit_subject,
    persistent_designation_lead,
    persistent_designation_replacement,
    persistent_designation_supported,
    persistent_designation_when,
    select_units_engagement,
    select_units_subject,
    selected_context,
    selected_recipient,
    selection_binding,
)
from wh40kdc.translate.effect_words import (
    Ctx,
    bracket_keyword,
    capitalize,
    dice_case,
    format_comparison,
    is_num,
    jstr,
    num,
    num_str,
    signed,
    test_name,
    title_case,
)
from wh40kdc.translate.timing import describe_timing
from wh40kdc.translate.trigger import describe_trigger, normalize_triggers

Effect = dict[str, Any]


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def inline(x: Any, ctx: Ctx) -> str:
    return describe_effect_inline(_obj(x), ctx)


def _select_units_inline(sel: Any, effect: Effect, ctx: Ctx) -> str:
    sel = _obj(sel)
    subject = select_units_subject(sel)
    engagement = select_units_engagement(sel)
    binding = selection_binding(sel)
    nested = selected_recipient(describe_effect_inline(effect, selected_context(ctx, sel)), sel)
    if engagement:
        return f"select {subject}{binding}. {engagement} {capitalize(nested)}"
    return f"select {subject}{binding}: {nested}"


def leader_model_ability_grant_clause(e: Effect, ctx: Ctx) -> str:
    """Render the beneficiary-only leader relation without exposing a bearer fallback."""
    filt = _obj(e.get("leader_filter"))
    identity = title_case(filt["identity"]) if filt.get("identity") else ""
    keywords = " and ".join(bracket_keyword(k) for k in (filt.get("keywords") or []))
    role = (
        "the attached CHARACTER leader model"
        if e.get("beneficiary") == "attached-character-leader"
        else "the attached leader model"
    )
    identified = f" identified as {identity}" if identity else ""
    leader = f"{role}{identified}{f' with {keywords}' if keywords else ''}"
    unit_keywords = " and ".join(bracket_keyword(k) for k in (e.get("attached_unit_filter") or []))
    source = f"the bearer unit{f' with {unit_keywords}' if unit_keywords else ''}"
    nested = _obj(_obj(e.get("grant")).get("effect"))
    rendered = re.sub(
        r"^this model\b",
        "that leader model",
        describe_effect_inline({**nested, "target": "this-model"}, ctx),
    )
    return f"while {leader} leads {source}, {rendered}"


_USAGE = {
    "once-per-turn": "once per turn",
    "once-per-phase": "once per phase",
    "once-per-battle-round": "once per battle round",
    "once-per-command-phase": "once per Command phase",
    "once-per-opponent-turn": "once per opponent's turn",
    "first-this-battle": "the first time this battle",
    "first-time-this-phase": "the first time this phase",
}


def usage_clause(u: dict[str, Any]) -> str:
    """Usage limit → front-of-sentence lead clause ("once per turn", "twice per battle")."""
    n = num(u.get("count") if u.get("count") is not None else 1)
    freq = u.get("frequency")
    if isinstance(freq, str) and freq in _USAGE:
        base = _USAGE[freq]
    elif freq == "n-per-battle":
        base = (
            "once per battle"
            if n == 1
            else "twice per battle"
            if n == 2
            else f"{num_str(n)} times per battle"
        )
    else:
        base = dekebab(jstr(freq))
    return f"{base} per {jstr(u['per'])}" if u.get("per") is not None else base


_SCALE_OF = {
    "enemy-models-in-range": "enemy models",
    "friendly-models-in-range": "friendly models",
    "models-in-bearer-unit": "models in this unit",
    "models-in-or-embarked-in-bearer": "models in or embarked within this model",
    "enemy-units-in-range": "enemy units",
    "wounds-lost": "wounds lost",
}


def _scaling_clause(s: dict[str, Any]) -> str:
    """A ``scaling`` block → trailing clause ("for every 5 enemy models within 6\\"")."""
    c = (
        f"for every {jstr(s.get('per'))} "
        f"{_SCALE_OF.get(jstr(s.get('of')), dekebab(jstr(s.get('of'))))}"
    )
    if s.get("within_inches") is not None:
        c += f' within {jstr(s["within_inches"])}"'
    if s.get("round") == "up":
        c += " (rounding up)"
    if s.get("max_value") is not None:
        c += f" (to a maximum of {jstr(s['max_value'])})"
    return c


def _keywords_of(value: dict[str, Any], key: str) -> list[str]:
    return [jstr(k) for k in value[key]] if isinstance(value.get(key), list) else []


def _aura_eligible_subject(who: str, eligible: Any) -> str:
    if not isinstance(eligible, dict):
        return who
    required = _keywords_of(eligible, "required_keywords")
    excluded = _keywords_of(eligible, "excluded_keywords")
    base = f"{who[:-4]}{' '.join(required)} unit" if required else who
    exclusion = f" (excluding {' '.join(excluded)} units)" if excluded else ""
    return f"{base}{exclusion}"


def _keyword_filter_clause(value: Any, noun: str) -> str:
    if not isinstance(value, dict):
        return noun
    required = " and ".join(_keywords_of(value, "required_keywords"))
    excluded = " or ".join(_keywords_of(value, "excluded_keywords"))
    without = f" without {excluded}" if excluded else ""
    return f"{noun}{f' with {required}' if required else ''}{without}"


def _aura_clause(e: Effect, m: dict[str, Any], ctx: Ctx) -> str:
    if m.get("range_bonus") is not None:
        named = f"{title_case(jstr(m['of']))} " if m.get("of") is not None else ""
        return (
            f"the range of this model's {named}abilities is increased by {jstr(m['range_bonus'])}\""
        )
    rng = m.get("range")
    if isinstance(rng, list):
        range_text = "/".join(f'{jstr(r)}"' for r in rng) + " (by battle round)"
    elif rng is not None:
        range_text = f'{jstr(rng)}"'
    else:
        range_text = "range"
    who = "a friendly unit" if e.get("target") == "friendly-within-aura" else "an enemy unit"
    eligible_who = _aura_eligible_subject(who, m.get("eligible"))
    recipient = (
        _keyword_filter_clause(m["recipient_filter"], eligible_who)
        if m.get("recipient_filter") is not None
        else eligible_who
    )
    emitter = (
        _keyword_filter_clause(m["emitter_filter"], "this model")
        if m.get("emitter_filter") is not None
        else "this model"
    )
    effect_text = (
        describe_effect_inline(_obj(m["effect"]), {**ctx, "aura_recipient": True})
        if m.get("effect") is not None
        else "that unit is affected"
    )
    return f"while {recipient} is within {range_text} of {emitter}, {effect_text}"


def describe_effect_inline(e: Effect, ctx: Ctx | None = None) -> str:
    """Single-clause translation (lowercase-initial, no period), with any ``scaling``
    block woven on as a trailing "for every …" clause."""
    ctx = ctx or {}
    base = _describe_effect_inline_base(e, ctx)
    if e.get("type") == "movement-modifier" and e.get("after_move"):
        base += f"; if it does, {describe_effect_inline(e['after_move'], ctx)}"
    if (
        e.get("type") == "mortal-wounds"
        and _obj(e.get("modifier")).get("in_addition_to_normal_damage") is True
    ):
        base += ", in addition to normal damage"
    return f"{base} {_scaling_clause(e['scaling'])}" if e.get("scaling") else base


def describe_requirement(req: Any) -> str:
    """A dice-pool requirement as a noun phrase ("pair of 4+"; alternatives join with " or ")."""

    def one(r: Any) -> str:
        r = _obj(r)
        return f"{jstr(r.get('type'))} of {jstr(r.get('min_value'))}+"

    any_of = _obj(req).get("any_of")
    if isinstance(any_of, list):
        return " or ".join(one(r) for r in any_of)
    return one(req)


def dice_table_result_label(results: Any) -> str:
    if not isinstance(results, list):
        return ""
    faces = sorted(r for r in results if is_num(r))
    if len(faces) > 1 and all(i == 0 or face == faces[i - 1] + 1 for i, face in enumerate(faces)):
        return f"{jstr(faces[0])}-{jstr(faces[-1])}"
    return ", ".join(jstr(f) for f in faces)


def _dice_table_inline(e: Effect, ctx: Ctx) -> str:
    outcomes = [
        f"on {dice_table_result_label(_obj(o).get('results'))}, "
        f"{inline(_obj(o).get('effect'), ctx)}"
        for o in (e.get("outcomes") or [])
    ]
    return f"roll one {dice_case(e.get('dice'))}: {'; '.join(outcomes)}"


def roll_with_rider(steps: list[Any], ctx: Ctx) -> str | None:
    """A roll-with-rider ``sequence``: ``[dice-gated rider, unconditional primary]``.

    Only a gate declaring ``rider: true`` qualifies; "Regardless of the result" keeps the
    rider from reading as a gate on the primary."""
    if len(steps) != 2:
        return None
    first = _obj(steps[0])
    if first.get("type") != "dice-gated" or first.get("rider") is not True:
        return None
    if first.get("on_success") is None:
        return None
    comparison = first.get("comparison") if first.get("comparison") is not None else "gte"
    comp = format_comparison(jstr(comparison), first.get("threshold"))
    return (
        f"roll one {dice_case(first.get('dice'))}. On {comp}, {inline(first['on_success'], ctx)}. "
        f"Regardless of the result, {inline(steps[1], ctx)}"
    )


def dice_gated_body(e: Effect, ctx: Ctx) -> str:
    """ "one D6 (binding …): on a 4+, …; otherwise, …" — shared by the inline and block forms."""
    comparison = e.get("comparison") if e.get("comparison") is not None else "gte"
    comp = format_comparison(jstr(comparison), e.get("threshold"))
    success = inline(e["on_success"], ctx) if e.get("on_success") else "nothing happens"
    fail = f"; otherwise, {inline(e['on_fail'], ctx)}" if e.get("on_fail") else ""
    binding = (
        f" (binding the result as {dekebab(jstr(e['roll_var']).replace('_', '-'))})"
        if e.get("roll_var")
        else ""
    )
    return f"one {dice_case(e.get('dice'))}{binding}: on {comp}, {success}{fail}"


def designate_when(applies: dict[str, Any], block: bool) -> str:
    to = applies.get("to")
    if to == "target":
        return "while it is your target"
    if to == "bearer-attacks-target":
        return (
            "each time this unit makes an attack against it"
            if block
            else "each time this unit attacks it"
        )
    if to == "bound-unit-attacks-reference":
        return designated_attack_when(applies)
    return designation_attacker_phrase(applies, block)


def _describe_effect_inline_base(e: Effect, ctx: Ctx) -> str:
    m = _obj(e.get("modifier"))
    t = e.get("type")
    if t == "named-region-state":
        return describe_named_region_state(m, ctx, inline)
    if t == "aura":
        return _aura_clause(e, m, ctx)
    if t == "no-effect":
        return "nothing happens"
    if t == "conditional":
        inner = _obj(e.get("effect"))
        if inner.get("type") == "named-region-state":
            return describe_named_region_conditional(
                _obj(inner.get("modifier")), _obj(e.get("condition")), ctx, inline
            )
        return (
            f"{condition_lead_in(_obj(e.get('condition')))}, {describe_effect_inline(inner, ctx)}"
        )
    if t in ("rules-bundle", "sequence"):
        steps = e.get("steps") or []
        rider = roll_with_rider(steps, ctx)
        return rider if rider is not None else "; ".join(inline(s, ctx) for s in steps)
    if t == "ability-part":
        return part_inline(e, ctx)
    if t == "choice":
        return f"{choice_prompt(e)}: {' / '.join(inline(o, ctx) for o in (e.get('options') or []))}"
    if t == "dice-gated":
        if e.get("test"):
            return leadership_test(e, ctx)
        return f"roll {dice_gated_body(e, ctx)}"
    if t == "dice-table":
        return _dice_table_inline(e, ctx)
    if t == "dice-pool-allocation":
        opts = " / ".join(
            f"{jstr(_obj(o).get('name'))} (requires "
            f"{describe_requirement(_obj(o).get('requirement'))}): "
            f"{inline(_obj(o).get('effect'), ctx)}"
            for o in (e.get("options") or [])
        )
        return f"roll {pool_text(e)}: {opts}"
    if t == "select-units":
        return _select_units_inline(e.get("selector"), _obj(e.get("effect")), ctx)
    if t == "leader-model-ability-grant":
        return leader_model_ability_grant_clause(e, ctx)
    if t == "persistent-designation":
        if e.get("operation") == "replace":
            return persistent_designation_replacement(e)
        if not persistent_designation_supported(e):
            return "[persistent-designation]"
        consumer = _obj(e.get("consumer"))
        return (
            f"{persistent_designation_lead(e)} {persistent_designation_when(e)}, "
            f"{inline(consumer.get('effect'), ctx)}"
        )
    if t == "for-each-unit":
        inner_ctx = selected_context(ctx, e.get("selector"))
        return (
            f"for each {for_each_unit_subject(e.get('selector'))}: "
            f"{inline(e.get('effect'), inner_ctx)}"
        )
    if t == "designate-target":
        sel = _obj(e.get("select"))
        desig = designation_label(e["designation"]) if e.get("designation") else ""
        select_lead = f"{describe_timing(sel['timing'])}, select" if sel.get("timing") else "select"
        _, dur_trail = duration_clauses(e.get("duration"))
        applies = _obj(e.get("applies"))
        when = designate_when(applies, False)
        when_clause = f"{dur_trail}, {when}" if dur_trail else when
        recipient_ctx = designated_recipient_context(applies, ctx)
        return (
            f"{select_lead} one {designation_target_subject(sel)}{desig}; {when_clause}, "
            f"{inline(applies.get('effect'), recipient_ctx)}"
        )
    if t == "stance-select":
        opts = " / ".join(
            f"{jstr(_obj(o).get('name'))} ({inline(_obj(o).get('effect'), ctx)})"
            for o in (e.get("options") or [])
        )
        return f"{stance_pick(e)}: {opts}"
    if t == "stance-selection-capacity":
        n = num(m.get("additional_selections"))
        n = 1.0 if n != n or n == 0 else n
        times = "one additional time" if n == 1 else f"{num_str(n)} additional times"
        if m.get("allocation") == "fixed-option" and m.get("option_id") is not None:
            subject = title_case(jstr(m["option_id"]))
        else:
            subject = f"one option of {title_case(jstr(m.get('stance_id')))}"
        return f"you can select {subject} {times} per battle"
    if t == "risk-reward":
        risk = _obj(e.get("risk"))
        on_fail = inline(risk["on_fail"], ctx) if risk.get("on_fail") else "suffer a consequence"
        reward = inline(e.get("reward"), ctx)
        return f"take a {test_name(risk.get('test'))} test (on a failure, {on_fail}), then {reward}"
    if t == "issue-orders":
        return (
            "issue Orders, each one of: "
            f"{' / '.join(jstr(_obj(o).get('name')) for o in (e.get('options') or []))}"
        )
    if t == "resource-action-menu":
        actions = " / ".join(
            describe_menu_action(_obj(a), ctx, inline) for a in (e.get("actions") or [])
        )
        return f"actions may be performed when their conditions are met: {actions}"
    if isinstance(t, str) and t in LEAF_TYPES:
        return describe_leaf(e, ctx, inline)
    return f"[{t if t is not None else 'unknown'}]"


def pool_text(e: Effect) -> str:
    pool = e.get("pool")
    return (
        f"{jstr(pool.get('count'))}{jstr(pool.get('die'))}"
        if isinstance(pool, dict)
        else "your dice pool"
    )


_NUMBER_WORDS = ["zero", "one", "two", "three", "four"]


def stance_pick(e: Effect) -> str:
    """ "select one", "select two", "select up to two" — how many menu options are picked."""
    lo = e.get("min_choices") if e.get("min_choices") is not None else 1
    hi = e.get("max_choices") if e.get("max_choices") is not None else 1

    def n(k: Any) -> str:
        if isinstance(k, int) and not isinstance(k, bool) and 0 <= k < len(_NUMBER_WORDS):
            return _NUMBER_WORDS[k]
        return jstr(k)

    if lo == hi:
        return f"select {n(hi)}"
    return f"select up to {n(hi)}" if num(lo) <= 1 else f"select from {n(lo)} to {n(hi)}"


def choice_prompt(e: Effect) -> str:
    prompt = e.get("choice_prompt")
    if isinstance(prompt, str) and prompt.strip():
        return prompt
    label = f" ({title_case(e['choice_label'])})" if e.get("choice_label") else ""
    lo, hi = e.get("min_choices"), e.get("max_choices")
    if lo is not None and hi is not None:
        if lo == hi:
            quantity = f"exactly {jstr(hi)}"
        elif lo == 0:
            quantity = f"up to {jstr(hi)}"
        else:
            quantity = f"from {jstr(lo)} through {jstr(hi)}"
        return f"select {quantity} distinct options{label}"
    return f"select one of the following{label}"


def part_head(e: Effect) -> str:
    """What leads a part: its moment, usage limit, name, the choice to use it and its cost."""
    moment = " or ".join(
        s for s in (describe_trigger(t) for t in normalize_triggers(e.get("trigger"))) if s
    )
    level = (
        f" (Psychic level {jstr(e['level'])})"
        if e.get("kind") == "psychic" and e.get("level") is not None
        else ""
    )
    if e.get("name"):
        named = f"{'you can use ' if e.get('optional') else 'use '}{jstr(e['name'])}{level}"
    else:
        named = "you can" if e.get("optional") else ""
    cost = (
        f"by paying this cost ({describe_effect_inline(_obj(e['cost']))})" if e.get("cost") else ""
    )
    usage = usage_clause(e["usage"]) if e.get("usage") else ""
    _, trail = duration_clauses(e.get("duration"))
    return ", ".join(p for p in (moment, usage, named, cost, trail) if p)


def part_inline(e: Effect, ctx: Ctx) -> str:
    """A part on one line: its head, then its effect."""
    head = part_head(e)
    body = inline(e.get("effect"), ctx)
    return f"{head}: {body}" if head else body


def leadership_test(e: Effect, ctx: Ctx) -> str:
    test = _obj(e.get("test"))
    subject = test.get("subject")
    who = (
        "this model"
        if subject == "self"
        else "the target unit"
        if subject == "target"
        else "that unit"
    )
    kind = "Battle-shock" if test.get("kind") == "battle-shock" else "Leadership"
    modifiers = "; ".join(
        f"apply {signed('add', _obj(md).get('value'))} if "
        f"{describe_condition(_obj(_obj(md).get('condition')))}"
        for md in (test.get("modifiers") or [])
    )
    success = inline(e["on_success"], ctx) if e.get("on_success") else "nothing happens"
    failures = ([f"{who} becomes Battle-shocked"] if test.get("kind") == "battle-shock" else []) + (
        [inline(e["on_fail"], ctx)] if e.get("on_fail") else []
    )
    fail = f"; otherwise, {'; '.join(failures)}" if failures else ""
    mods = f"; {modifiers}" if modifiers else ""
    return (
        f"{who} takes a {kind} test (2D6, passing on its current Leadership or higher{mods}); "
        f"if passed, {success}{fail}"
    )
