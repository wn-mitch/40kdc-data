"""Humanize an Ability-DSL ``effect`` tree into plain English — the
``ability.print()`` of the dataset.

Output is an *approximation* generated purely from the structured data (no
external rules text), ASCII-only, with a fixed clause order: pinned
byte-for-byte across the TS, Rust, and Python ports by the
``conformance/effect-translation`` corpus.

Container nodes (``sequence``, ``conditional``, ``choice``, ``dice-gated``,
``dice-pool-allocation``) render block-style with two-space indentation and
an ASCII ``-> `` arrow; leaves render as single clauses. Unknown leaf types
degrade to a deterministic bracketed form (``[the-type]``).

Python mirror of ``tools/src/translate/effect.ts``.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.translate.condition import dekebab, describe_condition

Effect = dict[str, Any]


def _jstr(v: Any) -> str:
    """JS-template stringification (numbers print without trailing ``.0``)."""
    if v is None:
        return "?"
    if isinstance(v, list):
        return ", ".join(_jstr(x) for x in v)
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _format_target(t: str | None) -> str:
    return dekebab(t) if t else "target"


def _signed(operation: Any, value: Any) -> str:
    op = "+" if operation in ("add", "improve") else "-"
    return f"{op}{_jstr(value)}"


def _format_comparison(comp: str, threshold: Any) -> str:
    th = _jstr(threshold)
    if comp == "gte":
        return f"{th}+"
    if comp == "lte":
        return f"{th} or less"
    if comp == "gt":
        return f"greater than {th}"
    if comp == "lt":
        return f"less than {th}"
    if comp == "eq":
        return f"exactly {th}"
    return f"{th}+"


def describe_effect_inline(e: Effect) -> str:
    """Single-clause translation for leaf effects (and inline container forms)."""
    m = e.get("modifier") or {}
    target = _format_target(e.get("target"))
    etype = e.get("type")

    if etype == "stat-modifier":
        scope = f" ({_jstr(m['attack_type'])})" if m.get("attack_type") else ""
        if m.get("stat") is None:
            return f"modify stats for {target}"
        if m.get("operation") == "set":
            return f"set {_jstr(m['stat'])} to {_jstr(m.get('value'))}{scope} for {target}"
        return (
            f"{_signed(m.get('operation'), m.get('value'))} {_jstr(m['stat'])}{scope} for {target}"
        )
    if etype == "roll-modifier":
        ctx = f" ({_jstr(m['context'])})" if m.get("context") else ""
        if m.get("value") is None:
            op = dekebab(_jstr(m.get("operation")))
            return f"{op} {_jstr(m.get('roll'))} rolls{ctx} for {target}"
        signed = _signed(m.get("operation"), m["value"])
        return f"{signed} to {_jstr(m.get('roll'))} rolls{ctx} for {target}"
    if etype == "re-roll":
        subset = f" ({dekebab(_jstr(m['subset']))})" if m.get("subset") else ""
        atk = f" ({_jstr(m['attack_type'])})" if m.get("attack_type") else ""
        return f"re-roll {_jstr(m.get('roll'))} rolls{subset}{atk} for {target}"
    if etype == "mortal-wounds":
        amount = m.get("count")
        if amount is None:
            amount = m.get("amount")
        if amount is None:
            amount = "variable" if m.get("amount_table") else "?"
        range_ = m.get("range")
        if range_ is None:
            range_ = m.get("range_inches")
        within = f' (within {_jstr(range_)}")' if range_ is not None else ""
        return f"deal {_jstr(amount)} mortal wounds to {target}{within}"
    if etype == "feel-no-pain":
        return f"{target} gains Feel No Pain {_jstr(m.get('threshold'))}+"
    if etype == "ward":
        threshold = m.get("threshold")
        if threshold is None:
            threshold = m.get("value")
        return f"{target} gains Ward {_jstr(threshold)}+"
    if etype == "invulnerable-save":
        return f"{target} gains a {_jstr(m.get('value'))}+ invulnerable save"
    if etype == "keyword-grant":
        if isinstance(m.get("keywords"), list):
            kw = ", ".join(_jstr(k) for k in m["keywords"])
        else:
            keyword = m.get("keyword")
            kw = _jstr(keyword if keyword is not None else "keywords")
        if m.get("weapon_name") is not None:
            return f"{target}'s {_jstr(m['weapon_name'])} gains {kw}"
        if m.get("weapon_type") is not None:
            return f"{target}'s {_jstr(m['weapon_type'])} weapons gain {kw}"
        return f"{target}'s weapons gain {kw}"
    if etype == "ability-grant":
        grant = m.get("grant_type")
        if grant is None:
            grant = m.get("ability_id")
        cap = f" ({_jstr(m['capacity'])})" if m.get("capacity") is not None else ""
        granted = dekebab(_jstr(grant)) if grant is not None else "an ability"
        return f"{target} gains {granted}{cap}"
    if etype == "movement-modifier":
        kind = m.get("move_type")
        if kind is None:
            kind = m.get("type")
        dist = m.get("distance")
        if dist is None:
            dist = m.get("value")
        inches = f' {_jstr(dist)}"' if dist is not None else ""
        effect_name = dekebab(_jstr(kind)) if kind is not None else "a movement effect"
        return f"{target} gains {effect_name}{inches}"
    if etype == "damage-reduction":
        amount = m.get("amount")
        if amount is None:
            amount = m.get("value")
        return f"reduce incoming damage to {target} by {_jstr(amount)}"
    if etype == "resurrection":
        count = m.get("count")
        wounds = m.get("wounds_remaining")
        return (
            f"return {_jstr(count if count is not None else 1)} model(s) to {target} "
            f"with {_jstr(wounds if wounds is not None else 'full')} wounds"
        )
    if etype == "model-destruction":
        return f"destroy {_jstr(m.get('count'))} non-leader model(s) from {target}"
    if etype == "cp-gain":
        return f"gain {_jstr(m.get('amount'))} CP"
    if etype == "cp-refund":
        return f"refund {_jstr(m.get('amount'))} CP"
    if etype == "resource-gain":
        return f"gain {_jstr(m.get('amount'))} to {_jstr(m.get('pool_id'))}"
    if etype == "resource-spend":
        return f"spend {_jstr(m.get('amount'))} from {_jstr(m.get('pool_id'))}"
    if etype == "leadership-modifier":
        if m.get("test") is not None and m.get("operation") is None:
            return f"force a {dekebab(_jstr(m['test']))} test on {target}"
        if m.get("test") is not None:
            op = dekebab(_jstr(m.get("operation")))
            return f"{op} {dekebab(_jstr(m['test']))} tests for {target}"
        if m.get("operation") is not None:
            return f"{_signed(m['operation'], m.get('value'))} Leadership for {target}"
        return f"modify Leadership for {target}"
    if etype == "fight-first":
        return f"{target} fights first"
    if etype == "fight-last":
        return f"{target} fights last"
    if etype == "fight-on-death":
        return f"{target} fights on death"
    if etype == "shoot-on-death":
        return f"{target} shoots on death"
    if etype == "deep-strike":
        return f"{target} can deep strike"
    if etype == "fallback-and-act":
        return f"{target} can fall back and act"
    if etype == "attack-restriction":
        what = m.get("restriction")
        if what is None:
            what = m.get("restriction_type")
        range_ = f' (within {_jstr(m["range"])}")' if m.get("range") is not None else ""
        max_ = f" (max {_jstr(m['max_models'])} models)" if m.get("max_models") is not None else ""
        described = dekebab(_jstr(what)) if what is not None else "attack restriction"
        return f"{target}: {described}{range_}{max_}"
    if etype == "objective-control-modifier":
        if m.get("operation") is not None:
            return f"{_signed(m['operation'], m.get('value'))} OC for {target}"
        return f"modify OC of {target} by {_jstr(m.get('value'))}"
    if etype == "bs-modifier":
        return f"{_signed(m.get('operation'), m.get('value'))} BS for {target}"
    if etype == "charge-roll-modifier":
        return f"{_signed(m.get('operation'), m.get('value'))} to charge rolls for {target}"
    if etype == "engagement-passthrough":
        return f"{target} can move through engagement range"
    if etype == "terrain-area-tag":
        return f"tag the terrain area as {dekebab(_jstr(m.get('tag')))}"
    if etype == "objective-tag":
        return f"tag the objective as {dekebab(_jstr(m.get('tag')))}"
    if etype == "unit-tag":
        return f"tag {target} as {dekebab(_jstr(m.get('tag')))}"

    # Container types — inline forms.
    if etype == "conditional":
        return (
            f"if {describe_condition(e.get('condition') or {})}: "
            f"{describe_effect_inline(e.get('effect') or {})}"
        )
    if etype == "sequence":
        return "; ".join(describe_effect_inline(s) for s in e.get("steps") or [])
    if etype == "choice":
        label = f" ({e['choice_label']})" if e.get("choice_label") else ""
        options = " / ".join(describe_effect_inline(o) for o in e.get("options") or [])
        return f"choose one{label}: {options}"
    if etype == "dice-gated":
        comp = _format_comparison(e.get("comparison") or "gte", e.get("threshold"))
        success = describe_effect_inline(e["on_success"]) if e.get("on_success") else "nothing"
        fail = f", otherwise {describe_effect_inline(e['on_fail'])}" if e.get("on_fail") else ""
        return f"roll {_jstr(e.get('dice'))}: on {comp}, {success}{fail}"
    if etype == "dice-pool-allocation":
        pool = e.get("pool")
        pool_text = f"{_jstr(pool['count'])}{_jstr(pool['die'])}" if pool else "?"
        opts = " / ".join(
            f"{_jstr(o.get('name'))} ({_jstr((o.get('requirement') or {}).get('min_value'))}+): "
            f"{describe_effect_inline(o.get('effect') or {})}"
            for o in e.get("options") or []
        )
        return f"roll {pool_text}: {opts}"

    return f"[{etype if etype is not None else 'unknown'}]"


def describe_effect(e: Effect, depth: int = 0) -> str:
    """Block translation of an effect tree. Containers expand over multiple
    lines with two-space indentation; leaves delegate to
    :func:`describe_effect_inline`."""
    indent = "  " * depth
    arrow = "-> " if depth > 0 else ""
    etype = e.get("type")

    if etype == "conditional":
        return (
            f"{indent}If {describe_condition(e.get('condition') or {})}:\n"
            + describe_effect(e.get("effect") or {}, depth + 1)
        )
    if etype == "sequence":
        return "\n".join(describe_effect(s, depth) for s in e.get("steps") or [])
    if etype == "choice":
        label = f" ({e['choice_label']})" if e.get("choice_label") else ""
        options = "\n".join(
            f"{indent}  {i + 1}. {describe_effect_inline(o)}"
            for i, o in enumerate(e.get("options") or [])
        )
        return f"{indent}{arrow}Choose one{label}:\n{options}"
    if etype == "dice-gated":
        comp = _format_comparison(e.get("comparison") or "gte", e.get("threshold"))
        success = describe_effect_inline(e["on_success"]) if e.get("on_success") else "nothing"
        fail = f", otherwise {describe_effect_inline(e['on_fail'])}" if e.get("on_fail") else ""
        return f"{indent}{arrow}Roll {_jstr(e.get('dice'))}: on {comp}, {success}{fail}"
    if etype == "dice-pool-allocation":
        pool = e.get("pool")
        pool_text = f"{_jstr(pool['count'])}{_jstr(pool['die'])}" if pool else "?"
        lines = [
            f"{indent}{arrow}Roll {pool_text} (max {_jstr(e.get('max_activations'))} activations):"
        ]
        for opt in e.get("options") or []:
            requirement = opt.get("requirement") or {}
            lines.append(
                f"{indent}  - {_jstr(opt.get('name'))}: need {_jstr(requirement.get('type'))} of "
                f"{_jstr(requirement.get('min_value'))}+ -> "
                f"{describe_effect_inline(opt.get('effect') or {})}"
            )
        return "\n".join(lines)
    return f"{indent}{arrow}{describe_effect_inline(e)}"


def describe_scope(s: dict[str, Any] | None) -> str:
    """``Scope: aura (6"). Duration: phase.`` — empty string when absent."""
    if not s or (not s.get("range") and not s.get("duration")):
        return ""
    range_ = dekebab(s.get("range") or "")
    inches = f' ({_jstr(s["range_inches"])}")' if s.get("range_inches") is not None else ""
    duration = dekebab(s.get("duration") or "")
    return f"Scope: {range_}{inches}. Duration: {duration}."


def describe_ability(a: dict[str, Any]) -> str:
    """Full generated text for an ability: the effect tree plus a trailing
    scope line. This is the ``ability.print()`` consumers render when the
    dataset carries no rules prose."""
    effect = describe_effect(a["effect"]) if a.get("effect") else ""
    scope = describe_scope(a.get("scope"))
    if scope:
        return f"{effect}\n{scope}" if effect else scope
    return effect
