"""Single effects on the characteristic, roll, ability and permission axes, as one
lowercase-initial clause with no period. The board axes (protection, models, moves,
placement, tests, resources, designation, army) are in ``effect_leaf_board``.

Python mirror of ``tools/src/translate/effect-leaf.ts``.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import Any

from wh40kdc.translate.effect_leaf_access import permission, targeting
from wh40kdc.translate.effect_leaf_board import describe_board_leaf
from wh40kdc.translate.effect_leaf_shapes import (
    ability_activate,
    ability_limits,
    describe_shape_leaf,
)
from wh40kdc.translate.effect_words import (
    Ctx,
    ability_label,
    and_list,
    bracket_keyword,
    dekebab,
    dice_case,
    effect_subject,
    has_weapon,
    is_num,
    is_plural,
    is_rating_ref,
    jstr,
    none_of,
    num,
    num_str,
    of_or_possessive,
    pronoun,
    range_phrase,
    region_phrase,
    roll_name,
    signed,
    stat_name,
    title_case,
    v,
    weapon_holder,
    weapon_label,
    weapon_noun,
    weapon_roll_scope,
)

Leaf = dict[str, Any]
Inline = Callable[[Any, Ctx], str]

# Every single-effect type; anything else is a container.
LEAF_TYPES = frozenset(
    {
        "stat-modifier",
        "ignore-modifiers",
        "roll-modifier",
        "re-roll",
        "roll-result",
        "end-attack-sequence",
        "ability-grant",
        "keyword-grant",
        "weapon-ability-grant",
        "weapon-grant",
        "ability-modifier",
        "ability-activate",
        "permission",
        "targeting",
        "counts-as",
        "rule-state",
        "mortal-wounds",
        "damage-reduction",
        "feel-no-pain",
        "invulnerable-save",
        "heal",
        "return-models",
        "destroy-models",
        "act-on-death",
        "split-unit",
        "add-unit",
        "destruction-rule",
        "move",
        "move-modifier",
        "set-up",
        "marker",
        "transport-capacity",
        "test",
        "state-change",
        "cp-gain",
        "cost-modifier",
        "resource-gain",
        "resource-spend",
        "resource-die",
        "objective-sticky",
        "designate",
        "army-rule",
        "test-exemption",
        "datasheet-swap",
        "characteristic-resolution",
        "borrow-weapons",
        "select-weapon",
    }
)


def _incoming_lead(m: dict[str, Any], subj: str) -> str:
    """ "each time an attack targets the unit, " — the lead of an ``incoming`` change."""
    attack = (
        f"a {jstr(m['weapon_type'])} attack" if m.get("weapon_type") is not None else "an attack"
    )
    return f"each time {attack} targets {subj}, "


def _stat_change(m: dict[str, Any], what: str) -> str:
    """A stat change as a verb phrase over ``what``."""
    op = jstr(m.get("operation"))
    if op == "set":
        return f"set {what} to {dice_case(m.get('value'))}"
    if op == "halve":
        return f"halve {what}"
    if op == "multiply":
        return f"multiply {what} by {dice_case(m.get('value'))}"
    if op in ("improve", "worsen"):
        return f"{op} {what} by {dice_case(m.get('value'))}"
    verb = "subtract" if op == "subtract" else "add"
    val: Any = m.get("value")
    n = num(val)
    if not math.isnan(n) and n < 0:
        verb = "subtract" if verb == "add" else "add"
        val = num_str(abs(n))
    return f"{verb} {dice_case(val)} {'to' if verb == 'add' else 'from'} {what}"


def _bounds(m: dict[str, Any]) -> str:
    lo = f" (to a minimum of {jstr(m['minimum'])})" if m.get("minimum") is not None else ""
    hi = f" (to a maximum of {jstr(m['maximum'])})" if m.get("maximum") is not None else ""
    return lo + hi


def _stat_modifier(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    # AP is printed negative; the DSL stores its magnitude.
    if (
        m.get("stat") == "AP"
        and m.get("operation") == "set"
        and is_num(m.get("value"))
        and m["value"] > 0
    ):
        m = {**m, "value": f"-{jstr(m['value'])}"}
    stat = f"{stat_name(m.get('stat'))} characteristic"
    if m.get("incoming") is True:
        return (
            f"{_incoming_lead(m, subj)}{_stat_change(m, f'the {stat} of that attack')}{_bounds(m)}"
        )
    if has_weapon(m):
        what = f"the {stat} of {weapon_noun(m)} equipped by {weapon_holder(e.get('target'), ctx)}"
        return f"{_stat_change(m, what)}{_bounds(m)}"
    return f"{_stat_change(m, of_or_possessive(subj, stat))}{_bounds(m)}"


def _ignore_modifiers(m: dict[str, Any], subj: str) -> str:
    kind = (
        "negative "
        if m.get("only") == "worsening"
        else "positive "
        if m.get("only") == "improving"
        else ""
    )
    rolls = m.get("rolls")
    stats = m.get("stats")
    if m.get("what") == "rolls":
        if isinstance(rolls, list) and not any(r in ("all", "any") for r in rolls):
            things = f"{and_list([roll_name(r) for r in rolls])} rolls"
        else:
            things = "rolls"
    else:
        things = (
            f"{and_list([stat_name(s) for s in stats])} characteristics"
            if isinstance(stats, list)
            else "characteristics"
        )
    if m.get("incoming") is True:
        return f"{_incoming_lead(m, subj)}ignore any {kind}modifiers to that attack's {things}"
    return (
        f"{subj} {v(subj, 'ignores')} any {kind}modifiers to {pronoun(subj)} "
        f"{things}{weapon_roll_scope(m)}"
    )


def _roll_modifier(m: dict[str, Any], subj: str) -> str:
    value = "the result of that roll" if m.get("value_from") == "previous-roll" else None
    cap = (
        f" (to a maximum of {signed(m.get('operation'), m['cap'])})"
        if m.get("cap") is not None
        else ""
    )
    rolls = f"{roll_name(m.get('roll'))} rolls"
    sub = m.get("operation") == "subtract"
    if m.get("incoming") is True:
        if value:
            change = f"{'subtract' if sub else 'add'} {value} {'from' if sub else 'to'}"
        else:
            change = f"apply {signed(m.get('operation'), m.get('value'))} to"
        return f"{_incoming_lead(m, subj)}{change} the {roll_name(m.get('roll'))} roll{cap}"
    if value:
        return (
            f"{'subtract' if sub else 'add'} {value} {'from' if sub else 'to'} "
            f"{of_or_possessive(subj, rolls)}{weapon_roll_scope(m)}{cap}"
        )
    return (
        f"{subj} {v(subj, 'gets')} {signed(m.get('operation'), m.get('value'))} to "
        f"{rolls}{weapon_roll_scope(m)}{cap}"
    )


def _re_roll(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    rn = jstr(m.get("roll"))
    noun = "roll" if rn == "any" else f"{roll_name(m.get('roll'))} roll"
    cnt = m.get("count") if is_num(m.get("count")) else None
    failed = "failed " if m.get("subset") == "all-failures" else ""
    if isinstance(m.get("count"), (dict, list)):
        # A counted allowance ("one for each model equipped with …") reads as a number of rolls.
        which = f"a number of {_failed_noun(m, noun)}s equal to {dice_case(m['count'])}"
    elif cnt is not None:
        which = (
            f"{'one' if cnt == 1 else f'up to {jstr(cnt)}'} {failed}{noun}{'' if cnt == 1 else 's'}"
            f"{' of 1' if m.get('subset') == 'ones' else ''}"
        )
    elif m.get("subset") == "ones":
        which = f"{'any' if rn == 'any' else 'a'} {noun} of 1"
    elif m.get("subset") == "all-failures":
        which = f"a failed {noun}"
    else:
        which = "any roll" if rn == "any" else f"the {noun}"
    pool = (
        f" by spending a die from your {title_case(jstr(m['pool']))}"
        if m.get("pool") is not None
        else ""
    )
    can = "must" if m.get("mandatory") is True else "can"
    if m.get("incoming") is True:
        return f"{_incoming_lead(m, subj)}the attacking player {can} re-roll {which}{pool}"
    # "you can re-roll …" names whose roll it is unless that is the ability's own unit.
    target = e.get("target")
    own = (
        target is None
        or target in ("this-unit", "attacker")
        or (target == "recipient" and not ctx.get("aura_recipient"))
    )
    model = target == "this-model" or (target == "selected-unit" and ctx.get("selected_model"))
    holder = weapon_holder(target, ctx) if model else subj
    owner = ""
    if not own:
        attacks = "attacks made by " if rn in ("hit", "wound", "damage") else ""
        owner = f" for {attacks}{holder}"
    return f"you {can} re-roll {which}{owner}{weapon_roll_scope(m)}{pool}"


def _failed_noun(m: dict[str, Any], noun: str) -> str:
    if m.get("subset") == "all-failures":
        return f"failed {noun}"
    return f"{noun} of 1" if m.get("subset") == "ones" else noun


def _roll_result(m: dict[str, Any], subj: str) -> str:
    roll = roll_name(m.get("roll"))
    lead = _incoming_lead(m, subj) if m.get("incoming") is True else ""
    if m.get("critical_on") is not None:
        crit = "Critical Wound" if m.get("roll") == "wound" else "Critical Hit"
        if m["critical_on"] == "success":
            made = "" if lead else f" made by {subj}"
            return f"{lead}each successful {roll} roll{made}{weapon_roll_scope(m)} is a {crit}"
        who = "a" if lead else f"{subj} {v(subj, 'scores')}"
        return (
            f"{lead}{who} {crit}{'' if lead else 's'} on {roll} rolls of {jstr(m['critical_on'])}+"
            f"{weapon_roll_scope(m)}{' for that attack' if lead else ''}"
        )
    if m.get("fails_on") is not None:
        n = num(m["fails_on"])
        span = "1" if n == 1 else f"1-{num_str(n)}"
        if lead:
            return f"{lead}an unmodified {roll} roll of {span} for that attack always fails"
        rolls = of_or_possessive(subj, f"{roll} rolls")
        return f"{rolls}{weapon_roll_scope(m)} always fail on an unmodified {span}"
    if m.get("succeeds_on") is not None:
        rolls = (
            f"the {roll} roll for that attack" if lead else of_or_possessive(subj, f"{roll} rolls")
        )
        return (
            f"{lead}{rolls}{'' if lead else weapon_roll_scope(m)} "
            f"{'succeeds' if lead else 'succeed'} "
            f"only on an unmodified {jstr(m['succeeds_on'])}+"
        )
    tests = jstr(m.get("roll")) in ("battle-shock", "leadership", "desperate-escape")
    if tests and not lead:
        if m.get("result") == "pass":
            return f"{subj} automatically {v(subj, 'passes')} {roll} tests"
        if m.get("result") == "fail":
            return f"{subj} automatically {v(subj, 'fails')} {roll} tests"
    whose = f"the {roll} roll for that attack" if lead else of_or_possessive(subj, f"{roll} rolls")
    verb = (
        {"pass": "automatically succeeds", "fail": "automatically fails"}
        if lead
        else {"pass": "automatically succeed", "fail": "automatically fail"}
    )
    result = m.get("result")
    if result in ("pass", "fail"):
        return f"{lead}{whose}{'' if lead else weapon_roll_scope(m)} {verb[result]}"
    counts = " counts" if lead else f"{weapon_roll_scope(m)} count"
    unmod = "an unmodified " if m.get("unmodified") is True else ""
    return f"{lead}{whose}{counts} as {unmod}{jstr(result)}"


def _ability_grant(m: dict[str, Any], subj: str) -> str:
    # Cover is a state a unit has, not an ability it gains.
    if m.get("ability") == "benefit-of-cover":
        return f"{subj} {v(subj, 'has')} the Benefit of Cover"
    inch = '"' if m.get("ability") in ("scouts", "deep-strike") else ""
    rated = is_rating_ref(m.get("value"))
    shown = "X" if rated else jstr(m.get("value"))
    value = f" {shown}{inch}" if m.get("value") is not None else ""
    noun = "rules" if m.get("rules_bundle") is True else "ability"
    tail = ", X being its rating" if rated else ""
    return f"{subj} {v(subj, 'gains')} the {ability_label(m.get('ability'))}{value} {noun}{tail}"


def _keyword_grant(m: dict[str, Any], subj: str) -> str:
    kws = [jstr(k) for k in m["keywords"]] if isinstance(m.get("keywords"), list) else []
    noun = "keyword" if len(kws) == 1 else "keywords"
    replaces = ""
    if isinstance(m.get("replaces"), list):
        rep = m["replaces"]
        replaces = (
            f", replacing {pronoun(subj)} {and_list([jstr(x) for x in rep])} "
            f"{'keyword' if len(rep) == 1 else 'keywords'}"
        )
    return f"{subj} {v(subj, 'gains')} the {and_list(kws)} {noun}{replaces}"


def _weapon_ability_grant(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    kws = (
        " and ".join(bracket_keyword(a) for a in m["abilities"])
        if isinstance(m.get("abilities"), list)
        else "[?]"
    )
    increment = (
        " (a weapon that already has that ability adds the ratings together)"
        if m.get("if_present") == "increment"
        else ""
    )
    if m.get("incoming") is True:
        return f"{_incoming_lead(m, subj)}the attacking weapon has {kws}{increment}"
    if has_weapon(m):
        noun = weapon_noun(m)
        gain = "gain" if re.search(r"weapons\b", noun) else "gains"
        return f"{noun} equipped by {weapon_holder(e.get('target'), ctx)} {gain} {kws}{increment}"
    return f"{of_or_possessive(subj, 'weapons')} gain {kws}{increment}"


_ASPECTS = {
    "uses": "number of uses",
    "range": "range",
    "targets": "number of targets",
    "recipients": "recipients",
    "selections": "number of selections",
    "concurrent": "number that can apply at once",
    "duration": "duration",
    "start-round": "first battle round",
    "end-round": "last battle round",
    "threshold": "threshold",
    "options": "options",
}


def _modified_ability(ref: Any, subj: str, ctx: Ctx) -> str:
    """The ability an ability-modifier changes: named, the one a trigger used, or an audience's."""
    if isinstance(ref, dict):
        if ref.get("event") == "used":
            return "that ability"
        if isinstance(ref.get("keyword"), str):
            return f"each {ref['keyword']} ability of {subj}"
        audience = re.sub(r"^all ", "", effect_subject(ref.get("affecting"), ctx))
        return f"each ability of {subj} that affects {audience}"
    return of_or_possessive(subj, f"{ability_label(ref)} ability")


def _ability_modifier(m: dict[str, Any], subj: str, ctx: Ctx, inline: Inline) -> str:
    whose = _modified_ability(m.get("ability"), subj, ctx)
    aspect = _ASPECTS.get(jstr(m.get("aspect")), jstr(m.get("aspect")))
    raw = m.get("value")
    if m.get("aspect") == "range" and is_num(raw):
        value = f'{jstr(raw)}"'
    elif isinstance(raw, str):
        value = dekebab(raw)
    else:
        value = jstr(raw)
    cap = f" (to a maximum of {jstr(m['cap'])})" if m.get("cap") is not None else ""
    opt = m.get("add_option")
    recipients = effect_subject(m["recipients"], ctx) if m.get("recipients") is not None else None
    option = None
    if opt is not None:
        o = opt if isinstance(opt, dict) else {}
        option = f"the option {title_case(jstr(o.get('name')))} ({inline(o.get('effect'), ctx)})"
    op = m.get("operation")
    # An add with no value only widens the ability: it names the new recipients or option
    # instead of a count.
    if raw is None and op not in ("set", "lift-limit") and (recipients or option):
        parts = [
            p
            for p in (
                recipients and f"{whose} can also affect {recipients}",
                option and f"{whose} gains {option}",
            )
            if p
        ]
        return "; ".join(parts) + cap
    if op == "lift-limit":
        s = f"{whose} has no limit on its {aspect}"
    elif op == "set":
        s = (
            f"the {aspect} of {whose} "
            f"{'are' if m.get('aspect') in ('options', 'recipients') else 'is'} {value}"
        )
    elif op == "subtract":
        s = f"decrease the {aspect} of {whose} by {value}"
    else:
        s = f"increase the {aspect} of {whose} by {value}"
    if recipients:
        s += f"; it can also affect {recipients}"
    if option:
        s += f"; add {option}"
    return s + cap + ability_limits(m)


def _counts_as(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    if m.get("in_region") is not None:
        region = m["in_region"] if isinstance(m["in_region"], dict) else {}
        return f"{subj} {v(subj, 'counts')} as being within {region_phrase(region)}"
    of = effect_subject(m["of"], ctx) if m.get("of") is not None else "this model"
    return f"{subj} {v(subj, 'counts')} as being within {range_phrase(m.get('within'))} of {of}"


_CORE_RULES = {
    "benefit-of-cover": ("has the Benefit of Cover", "cannot benefit from Cover"),
    "charge": ("can charge", "cannot charge"),
    "advance": ("can Advance", "cannot Advance"),
    "fall-back": ("can Fall Back", "cannot Fall Back"),
    "ordered-retreat": (
        "is not affected by Desperate Escape tests",
        "must take Desperate Escape tests",
    ),
    "fire-overwatch": ("can fire Overwatch", "cannot fire Overwatch"),
    "desperate-escape": (
        "must take Desperate Escape tests",
        "is not affected by Desperate Escape tests",
    ),
    "attacking-ends-hidden": (
        "stops being hidden when it attacks",
        "does not stop being hidden when it attacks",
    ),
    "engaged-shooting-hit-penalty": (
        "suffers the -1 to Hit for shooting while within Engagement Range",
        "does not suffer the -1 to Hit for shooting while within Engagement Range",
    ),
    "charge-bonus": ("receives the Charge bonus", "does not receive the Charge bonus"),
    "hidden": ("can become hidden", "cannot become hidden"),
    "orders-end-on-battle-shock": (
        "loses its Orders when it becomes Battle-shocked",
        "keeps its Orders when it becomes Battle-shocked",
    ),
}


def _rule_state(m: dict[str, Any], subj: str) -> str:
    granted = m.get("direction") == "granted"
    rule = jstr(m.get("rule"))
    if m.get("rule_kind") == "faction-rule":
        return (
            f"{subj} {v(subj, 'gains')} {ability_label(rule)}"
            if granted
            else f"{subj} cannot use {ability_label(rule)}"
        )
    if rule == "overwatch-against-bearer":
        return f"your opponent {'can' if granted else 'cannot'} target {subj} with Overwatch"
    core = _CORE_RULES.get(rule)
    if m.get("rule_kind") == "core-rule" and core:
        phrase = core[0] if granted else core[1]
        if phrase.startswith("cannot "):
            return f"{none_of(subj)} {phrase}"
        phrase = re.sub(
            r"^(has|is|stops|does|suffers|receives|loses|keeps) ",
            lambda w: f"{v(subj, w.group(0).strip())} ",
            phrase,
            count=1,
        )
        if is_plural(subj):
            phrase = re.sub(r"\bits\b", "their", phrase)
        return f"{subj} {phrase}"
    kind = m.get("rule_kind")
    noun = "keyword" if kind == "keyword" else "rule" if kind == "core-rule" else "ability"
    verb = "gains" if granted else "loses"
    label = ability_label(rule) if kind == "ability" else title_case(rule)
    return f"{subj} {v(subj, verb)} the {label} {noun}"


def _weapon_grant(m: dict[str, Any], subj: str) -> str:
    n = num(m.get("count", 1) if m.get("count") is not None else 1)
    count = 1 if math.isnan(n) or n == 0 else n
    return (
        f"{subj} {v(subj, 'gains')} {num_str(count)} {weapon_label(m.get('weapon_id'))} "
        f"weapon{'' if count == 1 else 's'}"
    )


def describe_leaf(e: Leaf, ctx: Ctx, inline: Inline) -> str:
    """One single effect as a lowercase-initial clause."""
    m = e.get("modifier")
    m = m if isinstance(m, dict) else {}
    subj = effect_subject(e.get("target"), ctx)
    t = e.get("type")
    if t == "stat-modifier":
        return _stat_modifier(e, m, subj, ctx)
    if t == "ignore-modifiers":
        return _ignore_modifiers(m, subj)
    if t == "roll-modifier":
        return _roll_modifier(m, subj)
    if t == "re-roll":
        return _re_roll(e, m, subj, ctx)
    if t == "roll-result":
        return _roll_result(m, subj)
    if t == "end-attack-sequence":
        return "the attack sequence ends"
    if t == "ability-grant":
        return _ability_grant(m, subj)
    if t == "keyword-grant":
        return _keyword_grant(m, subj)
    if t == "weapon-ability-grant":
        return _weapon_ability_grant(e, m, subj, ctx)
    if t == "weapon-grant":
        return _weapon_grant(m, subj)
    if t == "ability-modifier":
        return _ability_modifier(m, subj, ctx, inline)
    if t == "ability-activate":
        return ability_activate(m, subj)
    if t == "permission":
        return permission(m, subj, ctx)
    if t == "targeting":
        return targeting(m, subj, ctx)
    if t == "counts-as":
        return _counts_as(m, subj, ctx)
    if t == "rule-state":
        return _rule_state(m, subj)
    shaped = describe_shape_leaf(e, m, subj, ctx)
    return shaped if shaped is not None else describe_board_leaf(e, m, subj, ctx, inline)
