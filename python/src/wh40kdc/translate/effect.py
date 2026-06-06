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

Leaf phrasing favors graceful omission over placeholders: optional modifier
fields that are absent (a CP amount, a move distance, a range) drop their
clause instead of rendering ``?``.

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


_TARGET_PHRASES = {
    "unit": "the unit",
    "self": "this model",
    "bearer": "the bearer",
    "attacker": "the attacker",
    "defender": "the defender",
    "enemy-within-aura": "enemy units in range",
    "friendly-within-aura": "friendly units in range",
    "all-friendly": "all friendly units",
    "all-enemy": "all enemy units",
    "attached-unit": "the attached unit",
}

#: Targets that render as plural noun phrases and need plural verb forms.
_PLURAL_TARGETS = frozenset(
    {"enemy-within-aura", "friendly-within-aura", "all-friendly", "all-enemy"}
)


def _format_target(t: str | None) -> str:
    """``unit`` → ``the unit``, ``self`` → ``this model``, etc."""
    if t is None:
        return "the target"
    return _TARGET_PHRASES.get(t, dekebab(t))


def _is_plural_target(t: str | None) -> bool:
    return t in _PLURAL_TARGETS


def _verb(pl: bool, singular: str, plural_form: str) -> str:
    """Pick the verb form agreeing with the target's number."""
    return plural_form if pl else singular


def _possessive(t: str) -> str:
    """``the unit`` → ``the unit's``; ``all friendly units`` → ``all friendly units'``."""
    return f"{t}'" if t.endswith("s") else f"{t}'s"


def _plural(amount: Any, noun: str) -> str:
    """``1 mortal wound`` / ``D3 mortal wounds`` — ``1`` is the only singular amount."""
    n = _jstr(amount)
    return f"{n} {noun}" if n == "1" else f"{n} {noun}s"


def _signed(operation: Any, value: Any) -> str:
    op = "+" if operation in ("add", "improve") else "-"
    return f"{op}{_jstr(value)}"


def _signed_verb(operation: Any) -> str:
    """``improve`` / ``worsen`` — the verb form of ``_signed`` when no value is present."""
    return "improve" if operation in ("add", "improve") else "worsen"


_STAT_NAMES = {
    "M": "Move",
    "T": "Toughness",
    "Sv": "Save",
    "W": "Wounds",
    "Ld": "Leadership",
    "OC": "OC",
    "A": "Attacks",
    "S": "Strength",
    "D": "Damage",
    "AP": "AP",
    "BS": "BS",
    "WS": "WS",
}


def _stat_name(stat: str) -> str:
    """Datasheet stat abbreviations → words (unknown stats fall back to dekebab)."""
    return _STAT_NAMES.get(stat, dekebab(stat))


def _is_numeric(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _format_comparison(comp: str, threshold: Any) -> str:
    th = _jstr(threshold)
    numeric = _is_numeric(threshold)
    if comp == "gte":
        return f"{th}+" if numeric else f"{th} or higher"
    if comp == "lte":
        return f"{th} or less"
    if comp == "gt":
        return f"greater than {th}"
    if comp == "lt":
        return f"less than {th}"
    if comp == "eq":
        return f"exactly {th}"
    return f"{th}+" if numeric else f"{th} or higher"


def _format_comparison_inverse(comp: str, threshold: Any) -> str:
    """The failing band of a comparison: ``gte 4`` fails on ``below 4``."""
    th = _jstr(threshold)
    if comp == "lte":
        return f"above {th}"
    if comp == "gt":
        return f"{th} or less"
    if comp == "lt":
        return f"{th} or more"
    if comp == "eq":
        return f"not exactly {th}"
    return f"below {th}"


def _describe_grant(grant: str, target: str, capacity: Any, pl: bool) -> str:
    """Known ``ability-grant`` grant types → readable clauses. Unmapped values
    fall back to ``gains <dekebab>``."""
    has = _verb(pl, "has", "have")
    if grant == "benefit-of-cover":
        return f"{target} {has} the Benefit of Cover"
    if grant in ("lone-operative", "lone-op"):
        return f"{target} are Lone Operatives" if pl else f"{target} is a Lone Operative"
    if grant in ("leader", "leader-attachment"):
        return f"{target} can be attached to a unit as a Leader"
    if grant == "fights-first":
        return f"{target} {_verb(pl, 'fights', 'fight')} first"
    if grant == "firing-deck":
        if capacity is not None:
            return f"{target} {has} Firing Deck {_jstr(capacity)}"
        return f"{target} {has} a Firing Deck"
    if grant == "deep-strike":
        return f"{target} can deep strike"
    if grant == "deep-strike-6inch-exclusion":
        return f'{target} can deep strike more than 6" from enemy units'
    if grant == "charge-after-advance":
        return f"{target} can charge after advancing"
    if grant == "advance-and-charge":
        return f"{target} can advance and charge"
    if grant == "reactive-overwatch":
        return f"{target} can fire overwatch reactively"
    if grant == "forced-attachment":
        return f"{target} must be attached to a unit"
    if grant == "attached-unit-eligibility":
        return f"{target} {has} special leader-attachment eligibility"
    if grant == "transport-disembark-modifier":
        return f"{target} {has} a special disembark rule"
    if grant == "special-embark-rule":
        return f"{target} {has} a special embark rule"
    if grant == "once-per-battle-special":
        return f"{target} {has} a once-per-battle special rule"
    if grant == "once-per-round-special":
        return f"{target} {has} a once-per-round special rule"
    if grant == "post-attack-debuff":
        return f"{target} {_verb(pl, 'applies', 'apply')} a debuff after attacking"
    if grant == "target-in-engagement":
        return f"{target} can shoot at targets within engagement range"
    if grant == "extended-order-range":
        return f"{target} {has} an extended order range"
    if grant == "flavor-text":
        return f"{target}: no game effect (flavor text)"
    if grant == "faction-metadata":
        return f"{target}: faction rule (see faction rules)"
    cap = f" ({_jstr(capacity)})" if capacity is not None else ""
    return f"{target} {_verb(pl, 'gains', 'gain')} {dekebab(grant)}{cap}"


def _describe_move(kind: str, target: str, dist: Any, pl: bool) -> str:
    """Known ``movement-modifier`` kinds → readable clauses. A null/zero
    distance omits the inches clause entirely (no ``0"`` noise)."""
    has_dist = dist is not None and dist != 0 and dist != "0"
    inches = f' {_jstr(dist)}"' if has_dist else ""
    up_to = f' of up to {_jstr(dist)}"' if has_dist else ""
    has = _verb(pl, "has", "have")
    if kind == "scouts":
        return f"{target} {has} Scouts{inches}"
    if kind == "infiltrate":
        return f"{target} {has} Infiltrators"
    if kind == "deep-strike":
        return f"{target} can deep strike"
    if kind == "hover":
        return f"{target} can hover"
    if kind == "reactive-move":
        return f"{target} can make a reactive move{up_to}"
    if kind in ("shoot-and-scoot", "move-after-shoot"):
        return f"{target} can move{up_to} after shooting"
    if kind == "redeploy-to-reserves":
        return f"{target} can redeploy into reserves"
    if kind == "into-strategic-reserves":
        return f"{target} can move into strategic reserves"
    if kind == "move-over-terrain":
        return f"{target} can move over terrain"
    if kind in ("move-through", "terrain-passthrough"):
        return f"{target} can move through terrain"
    if kind == "pile-in-consolidation":
        if has_dist:
            piles = _verb(pl, "piles", "pile")
            consolidates = _verb(pl, "consolidates", "consolidate")
            return f'{target} {piles} in and {consolidates} up to {_jstr(dist)}"'
        return f"{target} {has} extended pile-in and consolidation"
    if kind == "extended-consolidation":
        if has_dist:
            return f'{target} {_verb(pl, "consolidates", "consolidate")} up to {_jstr(dist)}"'
        return f"{target} {has} extended consolidation"
    if kind == "surge-move":
        return f"{target} can make a surge move{up_to}"
    if kind == "ignore-vertical":
        return f"{target} {_verb(pl, 'ignores', 'ignore')} vertical distance when moving"
    if kind == "deep-strike-6inch-exclusion":
        return f'{target} can deep strike more than 6" from enemy units'
    if kind in ("deep-strike-min-distance", "deep-strike-exclusion-range", "deep-strike-close"):
        if has_dist:
            return f'{target} can deep strike more than {_jstr(dist)}" from enemy units'
        return f"{target} has a modified deep strike distance"
    if kind == "normal":
        return f"{target} can make a normal move{up_to}"
    return f"{target} {_verb(pl, 'gains', 'gain')} {dekebab(kind)}{inches}"


def _describe_restriction(what: str, target: str, pl: bool) -> str:
    """Known ``attack-restriction`` tags → readable clauses. Unmapped values
    fall back to ``<target>: <dekebab>``."""
    is_ = _verb(pl, "is", "are")
    if what == "cannot-be-targeted-unless-closest-or-within-12":
        it = "they are" if pl else "it is"
        return (
            f'{target} cannot be targeted unless the attacker is within 12" '
            f"or {it} the closest eligible target"
        )
    if what == "anti-fallback":
        return f"enemy units in engagement range of {target} cannot fall back"
    if what == "must-be-warlord":
        return f"{target} must be your Warlord"
    if what == "cannot-be-warlord":
        return f"{target} cannot be your Warlord"
    if what in ("no-charge", "cannot-charge", "cannot-declare-charge", "charge-blocked", "charge"):
        return f"{target} cannot declare a charge"
    if what == "no-advance":
        return f"{target} cannot advance"
    if what in ("reinforcement-denial", "prevent-reserve-setup"):
        return f"enemy reinforcements cannot be set up near {target}"
    if what == "prevents-enemy-reserves-within-12":
        return f'enemy reinforcements cannot be set up within 12" of {target}'
    if what in ("army-composition-rule", "army-composition-constraint"):
        return f"{target} {is_} subject to an army composition rule"
    if what == "unique-unit-limit":
        return f"{target} {is_} limited to one per army"
    if what == "fire-overwatch":
        return f"{target} can fire overwatch"
    if what == "cannot-target-bearer":
        return "enemy units cannot target the bearer"
    if what == "cannot-receive-enhancements":
        return f"{target} cannot be given enhancements"
    return f"{target}: {dekebab(what)}"


def describe_effect_inline(e: Effect) -> str:
    """Single-clause translation for leaf effects (and inline container forms)."""
    m = e.get("modifier") or {}
    target = _format_target(e.get("target"))
    pl = _is_plural_target(e.get("target"))
    etype = e.get("type")

    if etype == "stat-modifier":
        scope = f" ({_jstr(m['attack_type'])})" if m.get("attack_type") else ""
        if m.get("stat") is None:
            return f"modify stats for {target}"
        stat = _stat_name(_jstr(m["stat"]))
        if m.get("operation") == "set":
            return f"set {stat} to {_jstr(m.get('value'))}{scope} for {target}"
        if m.get("value") is None:
            return f"{_signed_verb(m.get('operation'))} {stat}{scope} for {target}"
        return f"{_signed(m.get('operation'), m['value'])} {stat}{scope} for {target}"
    if etype == "roll-modifier":
        ctx = f" ({_jstr(m['context'])})" if m.get("context") else ""
        if m.get("critical_on") is not None:
            crit = _jstr(m["critical_on"])
            return f"critical {_jstr(m.get('roll'))}s on {crit}+{ctx} for {target}"
        if m.get("operation") is None and m.get("value") is None:
            return f"modify {_jstr(m.get('roll'))} rolls{ctx} for {target}"
        if m.get("value") is None:
            op = dekebab(_jstr(m.get("operation")))
            return f"{op} {_jstr(m.get('roll'))} rolls{ctx} for {target}"
        signed = _signed(m.get("operation"), m["value"])
        return f"{signed} to {_jstr(m.get('roll'))} rolls{ctx} for {target}"
    if etype == "re-roll":
        atk = f"{_jstr(m['attack_type'])} " if m.get("attack_type") is not None else ""
        roll = f"{atk}{_jstr(m.get('roll'))} rolls"
        subset = m.get("subset")
        if subset == "ones":
            return f"re-roll {roll} of 1 for {target}"
        if subset == "all-failures":
            return f"re-roll failed {roll} for {target}"
        if subset is not None:
            return f"re-roll {roll} ({dekebab(_jstr(subset))}) for {target}"
        return f"re-roll {roll} for {target}"
    if etype == "mortal-wounds":
        if m.get("trigger") is not None and m.get("threshold") is not None:
            trigger = dekebab(_jstr(m["trigger"]))
            return f"{trigger} triggers on {_jstr(m['threshold'])}+ for {target}"
        base = m.get("count")
        if base is None:
            base = m.get("amount")
        if base is not None and m.get("bonus") is not None:
            amount: Any = f"{_jstr(base)}+{_jstr(m['bonus'])}"
        else:
            amount = base
        range_ = m.get("range")
        if range_ is None:
            range_ = m.get("range_inches")
        # `enemy units in range (within 6")` is redundant — fold the inches in.
        to = (
            f'enemy units within {_jstr(range_)}"'
            if e.get("target") == "enemy-within-aura" and range_ is not None
            else None
        )
        within = f' (within {_jstr(range_)}")' if to is None and range_ is not None else ""
        to_str = to if to is not None else target
        if amount is None and m.get("amount_table") is not None:
            return f"deal mortal wounds (amount varies) to {to_str}{within}"
        if amount is None:
            return f"deal mortal wounds to {to_str}{within}"
        return f"deal {_plural(amount, 'mortal wound')} to {to_str}{within}"
    if etype == "feel-no-pain":
        return f"{target} {_verb(pl, 'has', 'have')} Feel No Pain {_jstr(m.get('threshold'))}+"
    if etype == "ward":
        threshold = m.get("threshold")
        if threshold is None:
            threshold = m.get("value")
        return f"{target} {_verb(pl, 'has', 'have')} Ward {_jstr(threshold)}+"
    if etype == "invulnerable-save":
        value = m.get("invuln_sv")
        if value is None:
            value = m.get("value")
        if value is None:
            value = m.get("threshold")
        has = _verb(pl, "has", "have")
        if value is None:
            return f"{target} {has} an invulnerable save"
        return f"{target} {has} a {_jstr(value)}+ invulnerable save"
    if etype == "keyword-grant":
        if isinstance(m.get("keywords"), list):
            kw = ", ".join(_jstr(k) for k in m["keywords"])
        else:
            keyword = m.get("keyword")
            kw = _jstr(keyword if keyword is not None else "keywords")
        poss = _possessive(target)
        if m.get("weapon_name") is not None:
            return f"{poss} {_jstr(m['weapon_name'])} gains {kw}"
        if m.get("weapon_type") is not None:
            return f"{poss} {_jstr(m['weapon_type'])} weapons gain {kw}"
        return f"{poss} weapons gain {kw}"
    if etype == "ability-grant":
        grant = m.get("grant_type")
        if grant is None:
            grant = m.get("ability_id")
        if grant is None:
            return f"{target} {_verb(pl, 'gains', 'gain')} an ability"
        return _describe_grant(_jstr(grant), target, m.get("capacity"), pl)
    if etype == "movement-modifier":
        kind = m.get("move_type")
        if kind is None:
            kind = m.get("type")
        dist = m.get("distance")
        if dist is None:
            dist = m.get("value")
        if kind is None:
            return f"{target} {_verb(pl, 'gains', 'gain')} a movement effect"
        return _describe_move(_jstr(kind), target, dist, pl)
    if etype == "damage-reduction":
        amount = m.get("reduction")
        if amount is None:
            amount = m.get("amount")
        if amount is None:
            amount = m.get("value")
        if amount is None:
            return f"reduce incoming damage to {target}"
        return f"reduce incoming damage to {target} by {_jstr(amount)}"
    if etype == "resurrection":
        count = m.get("count")
        wounds = m.get("wounds_remaining")
        return (
            f"return {_plural(count if count is not None else 1, 'model')} to {target} "
            f"with {_jstr(wounds if wounds is not None else 'full')} wounds"
        )
    if etype == "model-destruction":
        if m.get("count") is None:
            return f"destroy a non-leader model from {target}"
        return f"destroy {_plural(m['count'], 'non-leader model')} from {target}"
    if etype == "cp-gain":
        once = " (once per battle)" if m.get("type") == "once-per-battle-resource" else ""
        if m.get("amount") is None:
            return f"gain CP{once}"
        return f"gain {_jstr(m['amount'])} CP{once}"
    if etype == "cp-refund":
        once = " (once per battle)" if m.get("type") == "once-per-battle-resource" else ""
        strat = f" for {dekebab(_jstr(m['stratagem']))}" if m.get("stratagem") is not None else ""
        freq = f" ({dekebab(_jstr(m['frequency']))})" if m.get("frequency") is not None else ""
        if m.get("amount") is None:
            return f"refund CP{strat}{freq}{once}"
        return f"refund {_jstr(m['amount'])} CP{strat}{freq}{once}"
    if etype == "resource-gain":
        pool = m.get("pool_id")
        if pool is None:
            pool = m.get("resource")
        what = dekebab(_jstr(pool)).removesuffix(" pool") if pool is not None else "resource"
        if m.get("amount") is None:
            return f"gain {what}"
        return f"gain {_jstr(m['amount'])} {what}"
    if etype == "resource-spend":
        pool = m.get("pool_id")
        if pool is None:
            pool = m.get("resource")
        what = dekebab(_jstr(pool)).removesuffix(" pool") if pool is not None else "resource"
        if m.get("operation") == "multiply":
            return f"{what} costs are multiplied by {_jstr(m.get('value'))} for {target}"
        if m.get("amount") is None:
            return f"spend {what}"
        return f"spend {_jstr(m['amount'])} {what}"
    if etype == "leadership-modifier":
        if m.get("test") is not None and m.get("operation") is None:
            return f"force a {dekebab(_jstr(m['test']))} test on {target}"
        if m.get("test") is not None:
            op = dekebab(_jstr(m.get("operation")))
            return f"{op} {dekebab(_jstr(m['test']))} tests for {target}"
        if m.get("operation") is not None and m.get("value") is None:
            return f"{_signed_verb(m['operation'])} Leadership for {target}"
        if m.get("operation") is not None:
            return f"{_signed(m['operation'], m.get('value'))} Leadership for {target}"
        return f"modify Leadership for {target}"
    if etype == "fight-first":
        return f"{target} {_verb(pl, 'fights', 'fight')} first"
    if etype == "fight-last":
        return f"{target} {_verb(pl, 'fights', 'fight')} last"
    if etype == "fight-on-death":
        return f"{target} can fight after being destroyed"
    if etype == "shoot-on-death":
        return f"{target} can shoot after being destroyed"
    if etype == "deep-strike":
        return f"{target} can deep strike"
    if etype == "fallback-and-act":
        return f"{target} can fall back and still act"
    if etype == "attack-restriction":
        restriction = m.get("restriction")
        if restriction is None:
            restriction = m.get("restriction_type")
        range_ = f' (within {_jstr(m["range"])}")' if m.get("range") is not None else ""
        max_ = f" (max {_jstr(m['max_models'])} models)" if m.get("max_models") is not None else ""
        if restriction is None and m.get("attack_type") == "charge":
            return f"{target} cannot declare a charge{range_}{max_}"
        if restriction is None and m.get("attack_type") is not None:
            return f"{target} cannot make {_jstr(m['attack_type'])} attacks{range_}{max_}"
        if restriction is None:
            return f"{target}: attack restriction{range_}{max_}"
        return f"{_describe_restriction(_jstr(restriction), target, pl)}{range_}{max_}"
    if etype == "objective-control-modifier":
        if m.get("sticky"):
            return f"objectives captured by {target} remain under your control after it moves away"
        if m.get("operation") is not None and m.get("value") is None:
            return f"{_signed_verb(m['operation'])} OC for {target}"
        if m.get("operation") is not None:
            return f"{_signed(m['operation'], m.get('value'))} OC for {target}"
        if m.get("value") is None:
            return f"modify OC of {target}"
        return f"modify OC of {target} by {_jstr(m['value'])}"
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
        if e.get("on_success") is None and e.get("on_fail") is not None:
            inv = _format_comparison_inverse(e.get("comparison") or "gte", e.get("threshold"))
            return f"roll {_jstr(e.get('dice'))}: on {inv}, {describe_effect_inline(e['on_fail'])}"
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
        if e.get("on_success") is None and e.get("on_fail") is not None:
            inv = _format_comparison_inverse(e.get("comparison") or "gte", e.get("threshold"))
            return (
                f"{indent}{arrow}Roll {_jstr(e.get('dice'))}: on {inv}, "
                f"{describe_effect_inline(e['on_fail'])}"
            )
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
            req_type = _jstr(requirement.get("type"))
            req = f"needs a {req_type} of {_jstr(requirement.get('min_value'))}+"
            lines.append(
                f"{indent}  - {_jstr(opt.get('name'))}: {req} -> "
                f"{describe_effect_inline(opt.get('effect') or {})}"
            )
        return "\n".join(lines)
    return f"{indent}{arrow}{describe_effect_inline(e)}"


def describe_scope(s: dict[str, Any] | None) -> str:
    """``Scope: aura 6". Duration: phase.`` — empty string when absent."""
    if not s or (not s.get("range") and not s.get("duration")):
        return ""
    range_ = dekebab(s.get("range") or "")
    # `aura-6` carries its radius in the range tag itself — add the inch mark.
    if range_.startswith("aura "):
        rest = range_[len("aura ") :]
        if rest and rest.isdigit():
            range_ = f'aura {rest}"'
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
