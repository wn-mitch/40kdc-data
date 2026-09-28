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

from wh40kdc.translate.effect_leaf_board import describe_board_leaf
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
    jstr,
    none_of,
    num,
    num_str,
    of_or_possessive,
    or_list,
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
    if cnt is not None:
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
    if m.get("incoming") is True:
        return f"{_incoming_lead(m, subj)}the attacking player can re-roll {which}{pool}"
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
    return f"you can re-roll {which}{owner}{weapon_roll_scope(m)}{pool}"


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
    return f"{lead}{whose}{counts} as {jstr(result)}"


def _ability_grant(m: dict[str, Any], subj: str) -> str:
    # Cover is a state a unit has, not an ability it gains.
    if m.get("ability") == "benefit-of-cover":
        return f"{subj} {v(subj, 'has')} the Benefit of Cover"
    inch = '"' if m.get("ability") in ("scouts", "deep-strike") else ""
    value = f" {jstr(m['value'])}{inch}" if m.get("value") is not None else ""
    noun = "rules" if m.get("rules_bundle") is True else "ability"
    return f"{subj} {v(subj, 'gains')} the {ability_label(m.get('ability'))}{value} {noun}"


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
        return (
            f"{weapon_noun(m)} equipped by {weapon_holder(e.get('target'), ctx)} gain "
            f"{kws}{increment}"
        )
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
    return s + cap


_ACTIVITIES = {
    "shoot": "shoot",
    "declare-charge": "declare a charge",
    "fight": "fight",
    "start-action": "start an Action",
    "embark": "embark",
    "disembark": "disembark",
    "fall-back": "Fall Back",
    "advance": "Advance",
    "use-stratagem": "be targeted with Stratagems",
    "issue-order": "issue Orders",
    "attempt-ritual": "attempt Rituals",
    "use-enhancement": "use Enhancements",
    "move": "move",
    "observe": "act as an Observer",
}
_AFTER = {
    "advance": "Advanced",
    "fall-back": "Fell Back",
    "disembark": "disembarked",
    "normal-move": "made a Normal move",
    "charge": "made a Charge move",
    "remain-stationary": "Remained Stationary",
    "set-up": "was set up",
}
_DESPITE = {
    "engaged": "within Engagement Range of enemy units",
    "battle-shocked": "Battle-shocked",
    "shot-this-phase": "has already shot this phase",
    "fought-this-phase": "has already fought this phase",
    "disembarked-this-turn": "disembarked this turn",
    "stratagem-used-this-phase": "has already been targeted with that Stratagem this phase",
    "performing-action": "performing an Action",
    "advanced": "Advanced this turn",
    "fell-back": "Fell Back this turn",
}
_IS_STATE = frozenset({"engaged", "battle-shocked", "performing-action"})
_AS_IF = {
    "shooting-phase": " as if it were your Shooting phase",
    "fight-phase": " as if it were the Fight phase",
    "snap-shooting": " using the Snap Shooting rules",
}


def _permission(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    it = "they" if subj.startswith("all ") or re.search(r" units\b", subj) else "it"
    activity = m.get("activity")
    if activity == "use-stratagem" and m.get("stratagem") is not None:
        act = f"be targeted with the {title_case(jstr(m['stratagem']))} Stratagem"
    else:
        act = _ACTIVITIES.get(jstr(activity), jstr(activity))
    into = ""
    if m.get("into") is not None:
        prep = (
            "at" if activity == "shoot" else "against" if activity == "declare-charge" else "into"
        )
        into = f" {prep} {none_of(effect_subject(m['into'], ctx))}"
    reach = f' from up to {jstr(m["reach"])}" away' if m.get("reach") is not None else ""
    if m.get("allow") is False:
        s = f"{none_of(subj)} cannot {act}{into}"
    else:
        s = f"{subj} {v(subj, 'is')} eligible to {act}{into}{reach}"
    if isinstance(m.get("after"), list):
        s += (
            f" in a turn in which {it} "
            f"{or_list([_AFTER.get(jstr(a), jstr(a)) for a in m['after']])}"
        )
    if isinstance(m.get("despite"), list):
        clauses = []
        for d in m["despite"]:
            phrase = _DESPITE.get(jstr(d), jstr(d))
            if jstr(d) in _IS_STATE:
                clauses.append(f"{'they are' if it == 'they' else 'it is'} {phrase}")
            else:
                # "they has already shot" → "they have already shot".
                clauses.append(
                    f"{it} {re.sub(r'^has ', 'have ', phrase) if it == 'they' else phrase}"
                )
        s += f" even if {or_list(clauses)}"
    if m.get("as_if") is not None:
        s += _AS_IF.get(jstr(m["as_if"]), f" as if {jstr(m['as_if'])}")
    if m.get("next") is True:
        s += f", and must be the next unit selected to {act}"
    return s


_TARGET_KINDS = {
    "attack": " with attacks",
    "shoot": " with ranged attacks",
    "fight": " with melee attacks",
    "charge": " with a charge",
    "stratagem": " with Stratagems",
    "ability": " with abilities",
}


def _targeting(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    if m.get("by") is not None:
        who = effect_subject(m["by"], ctx)
    else:
        who = subj if m.get("target") is not None else "units"
    who = re.sub(r"^all ", "", who)
    if isinstance(m.get("by"), dict) or who == "units" or is_plural(who):
        attacking = "the attacking model" if re.search(r"\bmodels\b", who) else "the attacking unit"
    else:
        attacking = who
    if m.get("target") == "every-eligible":
        whom = "every eligible target"
    elif m.get("target") is not None:
        whom = effect_subject(m["target"], ctx)
    else:
        whom = subj
    may = m.get("may")
    verb = (
        "cannot target"
        if may == "cannot-target"
        else "must target"
        if may == "must-target"
        else "can target"
    )
    if m.get("kind") == "stratagem" and m.get("stratagem") is not None:
        kind = f" with the {title_case(jstr(m['stratagem']))} Stratagem"
    elif has_weapon(m):
        kind = f" with {weapon_noun(m)}"
    else:
        kind = _TARGET_KINDS.get(jstr(m.get("kind")), "")
    if m.get("range") is None:
        rng = ""
    elif may == "cannot-target":
        rng = f" unless {attacking} is within {range_phrase(m['range'])}"
    else:
        rng = f" within {range_phrase(m['range'])}"
    unless = ""
    if m.get("only_if_none") is not None:
        other = re.sub(
            r" units\b",
            " unit",
            re.sub(r"^all ", "", effect_subject(m["only_if_none"], ctx)),
            count=1,
        )
        unless = f", unless there is no other eligible {other}"
    return f"{who} {verb} {whom}{kind}{rng}{unless}"


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
}


def _rule_state(m: dict[str, Any], subj: str) -> str:
    granted = m.get("direction") == "granted"
    rule = jstr(m.get("rule"))
    if m.get("rule_kind") == "faction-rule":
        return (
            f"{subj} {v(subj, 'gains')} {title_case(rule)}"
            if granted
            else f"{subj} cannot use {title_case(rule)}"
        )
    if rule == "overwatch-against-bearer":
        return f"your opponent {'can' if granted else 'cannot'} target {subj} with Overwatch"
    core = _CORE_RULES.get(rule)
    if m.get("rule_kind") == "core-rule" and core:
        phrase = core[0] if granted else core[1]
        if phrase.startswith("cannot "):
            return f"{none_of(subj)} {phrase}"
        phrase = re.sub(
            r"^(has|is|stops|does) ", lambda w: f"{v(subj, w.group(0).strip())} ", phrase, count=1
        )
        return f"{subj} {phrase}"
    kind = m.get("rule_kind")
    noun = "keyword" if kind == "keyword" else "rule" if kind == "core-rule" else "ability"
    verb = "gains" if granted else "loses"
    return f"{subj} {v(subj, verb)} the {title_case(rule)} {noun}"


def _weapon_grant(m: dict[str, Any], subj: str) -> str:
    n = num(m.get("count", 1) if m.get("count") is not None else 1)
    count = 1 if math.isnan(n) or n == 0 else n
    return (
        f"{subj} {v(subj, 'gains')} {num_str(count)} {weapon_label(m.get('weapon_id'))} "
        f"weapon{'' if count == 1 else 's'}"
    )


def _ability_activate(m: dict[str, Any], subj: str) -> str:
    label = ability_label(m.get("ability"))
    if m.get("option") is None:
        return f"{subj} {v(subj, 'resolves')} the {label} ability now"
    exclusive = " (and no other option is)" if m.get("exclusive") is True else ""
    return f"the {title_case(jstr(m['option']))} option of {label} is active for {subj}{exclusive}"


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
        return _ability_activate(m, subj)
    if t == "permission":
        return _permission(m, subj, ctx)
    if t == "targeting":
        return _targeting(m, subj, ctx)
    if t == "counts-as":
        return _counts_as(m, subj, ctx)
    if t == "rule-state":
        return _rule_state(m, subj)
    return describe_board_leaf(e, m, subj, ctx, inline)
