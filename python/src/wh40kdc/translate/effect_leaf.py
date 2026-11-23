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

from wh40kdc.translate.condition_refs import _obj
from wh40kdc.translate.effect_leaf_access import permission, targeting
from wh40kdc.translate.effect_leaf_board import describe_board_leaf
from wh40kdc.translate.effect_leaf_shapes import (
    ability_activate,
    ability_class_state,
    ability_limits,
    describe_shape_leaf,
)
from wh40kdc.translate.effect_orders import added_option_recipients, order_share, orders_modifier
from wh40kdc.translate.effect_select import (
    select_units_subject,
    selection_binding,
    selector_subject,
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
from wh40kdc.translate.expiry import expiry_trail

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
        "weapon-ability-range",
        "weapon-grant",
        "ability-modifier",
        "oath-modifier",
        "orders-modifier",
        "order-share",
        "reserves-schedule",
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
        "resource-gain-cap",
        "resource-spend",
        "resource-die",
        "objective-sticky",
        "region-extend",
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
    scope = _obj(m.get("weapons"))
    attack = f"a {jstr(scope['type'])} attack" if scope.get("type") else "an attack"
    return f"each time {attack} targets {subj}, "


def _stat_change(m: dict[str, Any], what: str) -> str:
    """A stat change as a verb phrase over ``what``."""
    op = jstr(m.get("operation"))
    if op == "set":
        # A Range is printed in inches ("a Range characteristic of 18\"").
        inches = '"' if m.get("stat") == "Range" else ""
        return f"set {what} to {dice_case(m.get('value'))}{inches}"
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


# Characteristics a model rolls against, where a better value is a lower number ("3+").
_ROLL_TARGET_STATS = frozenset({"Sv", "WS", "BS", "Ld"})
# Characteristics measured in inches.
_DISTANCE_STATS = frozenset({"M", "Range", "detection-range"})


def _bounds(m: dict[str, Any]) -> str:
    # An improved roll target is capped from below ("cannot improve a Save to better than 3+").
    if (
        m.get("operation") == "improve"
        and str(m.get("stat")) in _ROLL_TARGET_STATS
        and m.get("minimum") is not None
        and m.get("maximum") is None
    ):
        return f", to no better than {jstr(m['minimum'])}+"
    lo = f", to a minimum of {jstr(m['minimum'])}" if m.get("minimum") is not None else ""
    hi = f", to a maximum of {jstr(m['maximum'])}" if m.get("maximum") is not None else ""
    return lo + hi


# The characteristics an attack has: under an `attackers-of-target` designation, each attack's.
_ATTACK_STATS = frozenset({"S", "WS", "BS", "AP", "D"})
_REF_KEYS = ("selection_var", "event_var", "stratagem_target", "aura_recipient", "role")


def _attack_maker(target: Any, m: dict[str, Any], subj: str) -> str:
    """Which attacks against the target a per-attack change covers: " if it is made with ranged
    weapons by a friendly ASTRA MILITARUM unit". A target that is any friendly unit or model, or the
    attacking unit, adds nothing: every such attack already qualifies."""
    with_weapons = f" with {weapon_noun(m)}" if has_weapon(m) else ""
    f = target if isinstance(target, dict) else None
    # A null field is an absent one.
    is_filter = f is not None and not any(f.get(k) is not None for k in _REF_KEYS)
    any_attacker = (
        target is None
        or target == "attacker"
        or (
            f is not None
            and is_filter
            and all(
                f[k] is None or (k == "owner" and f[k] == "friendly") or k == "level" for k in f
            )
        )
    )
    if any_attacker:
        by = ""
    elif f is not None and is_filter:
        maker = selector_subject({"filter": f}, False)
        article = "an" if maker[:1].lower() in "aeiou" and maker else "a"
        by = f" by {article} {maker}"
    else:
        by = f" by {subj}"
    return f" if it is made{with_weapons}{by}" if with_weapons or by else ""


def _not_cumulative_trail(m: dict[str, Any], of: str) -> str:
    """ " (this is not cumulative with ...)": what a modifier does not stack with."""
    nc = m.get("not_cumulative")
    if nc == "negative-modifiers":
        return f" (this is not cumulative with any other negative modifiers to that {of})"
    if isinstance(nc, dict) and nc.get("ability") is not None:
        return f" (this is not cumulative with the {ability_label(nc['ability'])} ability)"
    return ""


def _stat_modifier(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    stat_key = jstr(m.get("stat"))
    # AP is printed negative; the DSL stores its magnitude.
    if (
        stat_key == "AP"
        and m.get("operation") == "set"
        and is_num(m.get("value"))
        and m["value"] > 0
    ):
        m = {**m, "value": f"-{jstr(m['value'])}"}
    # Roll-target stats (Sv, WS, BS, Ld) set to a number print with a trailing "+" ("2+").
    if stat_key in _ROLL_TARGET_STATS and m.get("operation") == "set" and is_num(m.get("value")):
        m = {**m, "value": f"{jstr(m['value'])}+"}
    # Distance stats (M, Range, detection-range) print with inches on add/subtract/set.
    val = m.get("value")
    if (
        stat_key in _DISTANCE_STATS
        and m.get("operation") in ("add", "subtract", "set")
        and (is_num(val) or (isinstance(val, str) and not val.endswith('"')))
    ):
        m = {**m, "value": f'{dice_case(val)}"'}
    stat = (
        "detection range"
        if stat_key == "detection-range"
        else f"{stat_name(m.get('stat'))} characteristic"
    )
    if m.get("incoming") is True:
        return (
            f"{_incoming_lead(m, subj)}{_stat_change(m, f'the {stat} of that attack')}{_bounds(m)}"
        )
    if ctx.get("attack_on_target") and stat_key in _ATTACK_STATS:
        change = _stat_change(m, f"the {stat} of that attack")
        return f"{change}{_bounds(m)}{_attack_maker(e.get('target'), m, subj)}"
    if has_weapon(m):
        holder = weapon_holder(e.get("target"), ctx)
        what = f"the {stat} of {weapon_noun(m)} equipped by {holder}"
        return f"{_stat_change(m, what)}{_bounds(m)}"
    if e.get("target") == "attacker" and stat_key in _ATTACK_STATS:
        what = f"the {stat} of the attacking unit's attacks"
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
    # "any roll (excluding modifiers to saving throws)": the rolls whose modifiers still apply.
    except_rolls = m.get("except_rolls")
    exc = (
        f" (except {and_list([roll_name(r) for r in except_rolls])} rolls)"
        if m.get("what") == "rolls" and isinstance(except_rolls, list) and except_rolls
        else ""
    )
    # "you can ignore any or all modifiers to …": the player picks which modifiers to ignore.
    any_or_all = m.get("choice") == "any-or-all"
    which = "any or all" if any_or_all else "any"
    if m.get("incoming") is True:
        lead = _incoming_lead(m, subj)
        return f"{lead}ignore {which} {kind}modifiers to that attack's {things}{exc}"
    if any_or_all:
        return (
            f"you can ignore any or all {kind}modifiers to {of_or_possessive(subj, things)}"
            f"{exc}{weapon_roll_scope(m)}"
        )
    return (
        f"{subj} {v(subj, 'ignores')} any {kind}modifiers to {pronoun(subj)} "
        f"{things}{exc}{weapon_roll_scope(m)}"
    )


_ATTACK_ROLLS = frozenset({"hit", "wound", "damage"})


def _suppressed_weapon_scope(m: dict[str, Any], ctx: Ctx) -> str:
    """Whether a weapon filter only restates an enclosing ``while making <type> attacks``."""
    if not has_weapon(m):
        return ""
    w = _obj(m.get("weapons"))
    if (
        ctx.get("suppress_weapon_type")
        and w.get("type") == ctx.get("suppress_weapon_type")
        and len(w) == 1
    ):
        return ""
    return weapon_roll_scope(m)


def _roll_modifier(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    # A bound roll's result as the value ("add 1 for each of those mortal wounds").
    raw = m.get("value")
    bound = (
        isinstance(raw, dict)
        and isinstance(raw.get("roll_var"), str)
        and raw.get("successes_on") is None
    )
    from_roll = m.get("value_from") == "previous-roll" or bound
    bound_value = "the result of that roll" if from_roll else None
    cap = (
        f", to a maximum of {signed(m.get('operation'), m['cap'])}"
        if m.get("cap") is not None
        else ""
    )
    rolls = f"{roll_name(m.get('roll'))} rolls"
    scope = _suppressed_weapon_scope(m, ctx)
    # "Halve Advance and Charge rolls made for that unit": the result is halved, with no value.
    if m.get("operation") == "halve":
        return f"halve {of_or_possessive(subj, rolls)}{scope}"
    sub = m.get("operation") in ("subtract", "worsen")
    raw_val: Any = raw
    n = num(raw_val)
    if not bound_value and not math.isnan(n) and n < 0:
        sub = not sub
        raw_val = num_str(abs(n))
    verb = "subtract" if sub else "add"
    prep = "from" if sub else "to"
    val = bound_value if bound_value is not None else dice_case(raw_val)
    if m.get("incoming") is True:
        lead = _incoming_lead(m, subj)
        return f"{lead}{verb} {val} {prep} the {roll_name(m.get('roll'))} roll{cap}"
    return f"{verb} {val} {prep} {of_or_possessive(subj, rolls)}{scope}{cap}"


def _re_roll(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    rn = jstr(m.get("roll"))
    noun = "roll" if rn == "any" else f"{roll_name(m.get('roll'))} roll"
    is_attack_roll = rn in _ATTACK_ROLLS
    cnt = m.get("count") if is_num(m.get("count")) else None
    failed = "failed " if m.get("subset") == "all-failures" else ""
    if isinstance(m.get("count"), (dict, list)):
        # A counted allowance ("one for each model equipped with …") reads as a number of rolls.
        which = f"a number of {_failed_noun(m, noun)}s equal to {dice_case(m['count'])}"
    elif cnt is not None:
        which = (
            f"{'one' if cnt == 1 else f'up to {jstr(cnt)}'} {failed}{noun}{'' if cnt == 1 else 's'}"
            f"{_subset_suffix(m)}"
        )
    elif is_attack_roll:
        if m.get("subset") == "ones":
            which = f"{noun}s of 1"
        elif m.get("subset") == "ones-and-twos":
            which = f"{noun}s of 1 or 2"
        elif m.get("subset") == "all-failures":
            which = f"failed {noun}s"
        else:
            which = f"{noun}s"
    elif m.get("subset") in ("ones", "ones-and-twos"):
        which = f"{'any' if rn == 'any' else 'a'} {noun}{_subset_suffix(m)}"
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
    scope = _suppressed_weapon_scope(m, ctx)
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
        attacks = "attacks made by " if is_attack_roll else ""
        owner = f" for {attacks}{holder}"
    return f"you {can} re-roll {which}{owner}{scope}{pool}"


def _failed_noun(m: dict[str, Any], noun: str) -> str:
    if m.get("subset") == "all-failures":
        return f"failed {noun}"
    return f"{noun}{_subset_suffix(m)}" if m.get("subset") in ("ones", "ones-and-twos") else noun


def _subset_suffix(m: dict[str, Any]) -> str:
    """The face a ``ones`` or ``ones-and-twos`` re-roll takes, as `` of 1`` or `` of 1 or 2``."""
    return {"ones": " of 1", "ones-and-twos": " of 1 or 2"}.get(jstr(m.get("subset")), "")


def _roll_result(m: dict[str, Any], subj: str) -> str:
    roll = roll_name(m.get("roll"))
    lead = _incoming_lead(m, subj) if m.get("incoming") is True else ""
    # A cap: "if the result is greater than 6 (after modifiers), change it to 6".
    if m.get("at_most") is not None:
        cap = jstr(m["at_most"])
        return (
            f"{of_or_possessive(subj, f'{roll} rolls')}{weapon_roll_scope(m)}"
            f" count as {cap} if the result is greater than {cap} after modifiers"
        )
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
    # count 1: one roll the player picks ("change the result of one Hit roll … to an unmodified 6").
    if m.get("count") == 1 and not isinstance(m.get("count"), bool) and not lead:
        if m.get("result") == "pass":
            outcome = "automatically succeeds"
        elif m.get("result") == "fail":
            outcome = "automatically fails"
        else:
            unmod = "an unmodified " if m.get("unmodified") is True else ""
            outcome = f"counts as {unmod}{jstr(m.get('result'))}"
        return f"one of {of_or_possessive(subj, f'{roll} rolls')}{weapon_roll_scope(m)} {outcome}"
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


def is_defined_grant(e: Any) -> bool:
    """A grant that prints the ability it gives (``modifier.definition``)."""
    m = e.get("modifier") if isinstance(e, dict) else None
    return (
        isinstance(e, dict)
        and e.get("type") == "ability-grant"
        and isinstance(m, dict)
        and isinstance(m.get("definition"), dict)
    )


def defined_grant_head(e: Leaf, ctx: Ctx) -> str:
    """Who holds a printed ability and its name, or the unnamed grant's rules."""
    m = e.get("modifier") or {}
    definition = m.get("definition") or {}
    subj = effect_subject(e.get("target"), ctx)
    name = definition.get("name")
    if not isinstance(name, str):
        name = ability_label(m.get("ability")) if m.get("ability") is not None else None
    if name is None:
        return f"{subj} {v(subj, 'gains')} the following rules"
    return f"{subj} {v(subj, 'gains')} the {name} ability"


def definition_part(e: Leaf) -> dict[str, Any]:
    """The printed ability as a part without its name, which the grant's head already says."""
    definition = (e.get("modifier") or {}).get("definition") or {}
    return {k: val for k, val in definition.items() if k != "name"}


def _ability_grant(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx, inline: Inline) -> str:
    if is_defined_grant(e):
        return f"{defined_grant_head(e, ctx)} ({inline(definition_part(e), ctx)})"
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
    """Render catalog-backed weapon keyword grants and selectors."""
    gained = (
        " and ".join(bracket_keyword(keyword) for keyword in m["keywords"])
        if isinstance(m.get("keywords"), list)
        else ""
    )
    lost = (
        " and ".join(bracket_keyword(keyword) for keyword in m["removes"])
        if isinstance(m.get("removes"), list)
        else ""
    )
    increment = (
        " (a weapon that already has that ability adds the ratings together)"
        if m.get("if_present") == "increment"
        else ""
    )
    if m.get("incoming") is True:
        return f"{_incoming_lead(m, subj)}the attacking weapon has {gained or '[?]'}{increment}"
    if has_weapon(m):
        noun = f"{weapon_noun(m)} equipped by {weapon_holder(e.get('target'), ctx)}"
    else:
        noun = of_or_possessive(subj, "weapons")
    plural = not has_weapon(m) or re.search(r"weapons\b", weapon_noun(m)) is not None
    gain, lose = ("gain", "lose") if plural else ("gains", "loses")
    changes = []
    if gained:
        changes.append(f"{gain} {gained}{increment}")
    if lost:
        changes.append(f"{lose} {lost}")
    if not changes:
        changes.append(f"{gain} [?]")
    return f"{noun} {' and '.join(changes)}"


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
    "amount": "amount",
}


def _times_word(value: Any) -> str:
    """"once", "twice", "3 times"."""
    if is_num(value) and value == 1:
        return "once"
    if is_num(value) and value == 2:
        return "twice"
    return f"{jstr(value)} times"


def _modified_ability(ref: Any, subj: str, ctx: Ctx) -> str:
    """The ability an ability-modifier changes: named, the one a trigger used, or an audience's."""
    # A stance option or a definition inside another record is named like a record.
    if isinstance(ref, dict) and "ability_id" not in ref:
        if ref.get("event") == "used":
            return "that ability"
        if isinstance(ref.get("keyword"), str):
            return f"each {ref['keyword']} ability of {subj}"
        audience = re.sub(r"^all ", "", effect_subject(ref.get("affecting"), ctx))
        return f"each ability of {subj} that affects {audience}"
    return of_or_possessive(subj, f"{ability_label(ref)} ability")


def _ability_modifier(m: dict[str, Any], subj: str, ctx: Ctx, inline: Inline) -> str:
    # "The bearer's unit can be regenerated up to twice per phase": times one unit can be affected.
    if m.get("aspect") == "received":
        label = ability_label(m.get("ability"))
        times = _times_word(m.get("value"))
        return f"{subj} can be affected by {label} up to {times}, in place of its usual limit"
    whose = _modified_ability(m.get("ability"), subj, ctx)
    # "If it suffers one or more mortal wounds as a result of that Dark Pact, add 1 to the
    # number of mortal wounds it suffers."
    if m.get("aspect") == "mortal-wounds":
        amount = jstr(m.get("value"))
        subtract = m.get("operation") == "subtract"
        change = f"subtract {amount} from" if subtract else f"add {amount} to"
        return (
            f"if {whose} inflicts one or more mortal wounds on {subj}, "
            f"{change} the number of mortal wounds it suffers"
        )
    aspect = _ASPECTS.get(jstr(m.get("aspect")), jstr(m.get("aspect")))
    raw = m.get("value")
    if (
        m.get("aspect") == "selection"
        and isinstance(m.get("selection"), dict)
        and m.get("operation") == "set"
        and isinstance(m.get("ability"), dict)
        and m["ability"].get("event") == "used"
    ):
        selector = m["selection"]
        duration = expiry_trail(m.get("recipient_duration"))
        return (
            f"replace {whose}'s selection with {select_units_subject(selector)}"
            f"{selection_binding(selector)}; those recipients are affected by "
            f"that same ability{' ' + duration if duration else ''}"
        )
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
        option = (
            f"the option {title_case(jstr(o.get('name')))} "
            f"({added_option_recipients(o, ctx)}{inline(o.get('effect'), ctx)})"
        )
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


def _weapon_ability_range(m: dict[str, Any], subj: str) -> str:
    """A weapon ability's test out to the attacking weapon's full range, not half of it
    (Rapid Fire)."""
    return (
        f"{of_or_possessive(subj, 'attacks')} benefit from {bracket_keyword(m.get('keyword'))} "
        "when the target is within the weapon's range"
    )


def _counts_as(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    # "Treated as containing fewer than five models for the purpose of the [BLAST] ability".
    if m.get("model_count") is not None:
        below = jstr(_obj(m["model_count"]).get("below"))
        rule = dekebab(jstr(m.get("for_weapon_ability"))).upper()
        return (
            f"{subj} {v(subj, 'counts')} as containing fewer than {below} models "
            f"for the purpose of the [{rule}] ability"
        )
    if m.get("in_region") is not None:
        region = m["in_region"] if isinstance(m["in_region"], dict) else {}
        return f"{subj} {v(subj, 'counts')} as being within {region_phrase(region)}"
    of = effect_subject(m["of"], ctx) if m.get("of") is not None else "this model"
    # "for the purposes of the Psychic Guidance and Spirit Guides abilities".
    purposes = ""
    if isinstance(m.get("for_abilities"), list):
        labels = list(dict.fromkeys(ability_label(i) for i in m["for_abilities"]))
        purposes = f" for the purposes of the {and_list(labels)} abilities"
    within = range_phrase(m.get("within"))
    return f"{subj} {v(subj, 'counts')} as being within {within} of {of}{purposes}"


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
    "reserves-destruction": (
        "is destroyed if still in Strategic Reserves at the end of the third battle round",
        "is not destroyed for still being in Strategic Reserves at the end of the third "
        "battle round",
    ),
}


def _rule_state(m: dict[str, Any], subj: str) -> str:
    direction = m.get("direction")
    rule = m.get("rule")
    if direction == "exchanged":
        first = ability_label(rule)
        second = ability_label(m.get("exchange_with"))
        return (
            f"if {subj} {v(subj, 'has')} exactly one of the {first} and "
            f"{second} abilities, {subj} simultaneously {v(subj, 'loses')} "
            f"that ability and {v(subj, 'gains')} the other"
        )
    if direction == "suppressed" and m.get("except_from") == "this-ability":
        return (
            f"{subj} {v(subj, 'loses')} the {ability_label(rule)} ability "
            f"and cannot gain it except from this ability"
        )
    granted = direction == "granted"
    rule = jstr(rule)
    # "no mortal wounds are inflicted by your army's Daemonic Terror rule": one aspect of a
    # section of the rule is off.
    if m.get("sub_rule") is not None:
        section = title_case(jstr(m["sub_rule"]))
        return f"your army's {section} rule inflicts no mortal wounds on {subj}"
    if m.get("rule_kind") == "faction-rule":
        # any_army_faction: the granted faction rule works whatever the army's faction is.
        any_faction = ", whatever your Army Faction is" if m.get("any_army_faction") is True else ""
        return (
            f"{subj} {v(subj, 'gains')} {ability_label(m.get('rule'))}{any_faction}"
            if granted
            else f"{subj} cannot use {ability_label(m.get('rule'))}"
        )
    if rule == "overwatch-against-bearer":
        return f"your opponent {'can' if granted else 'cannot'} target {subj} with Overwatch"
    # The attacks of a bound shooting event never count against Hidden (schema: suppressed only).
    if m.get("attacks") is not None and rule == "attacking-ends-hidden":
        return f"those attacks do not stop {subj} from being hidden"
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


def _oath_modifier(m: dict[str, Any], subj: str, ctx: Ctx, inline: Inline) -> str:
    label = ability_label(m.get("ability"))
    aspect = m.get("aspect")
    if aspect == "quality-persistence":
        duration = expiry_trail(m.get("duration"))
        return (
            f"{subj} {v(subj, 'retains')} qualities from {jstr(m.get('from'))} "
            f"{label} Oaths{' ' + duration if duration else ''}"
        )
    if aspect == "deed-reward":
        method = (
            "randomly determined "
            if m.get("selection_method") == "random"
            else "chosen "
            if m.get("selection_method") == "chosen"
            else ""
        )
        any_method = (
            ", regardless of how those deeds were selected"
            if m.get("selection_method") == "any"
            else ""
        )
        return (
            f"for {subj}, on completion of {jstr(m.get('applies_to'))} "
            f"{method}{label} deeds{any_method}, replace their reward with: "
            f"{inline(m.get('effect'), ctx)}"
        )
    domains = m.get("domains")
    domain_text = (
        and_list(
            [
                "qualities" if domain == "quality" else f"{jstr(domain)}s"
                for domain in domains
            ]
        )
        if isinstance(domains, list)
        else ""
    )
    clauses = [f"when selecting {domain_text} for {label} for {subj}"]
    if m.get("exclude_previously_selected") is True:
        clauses.append(f"exclude previously selected {domain_text}")
    if m.get("duplicate_roll") == "choose-unselected":
        clauses.append("if a duplicate is rolled, choose an unselected result in that domain")
    if m.get("stop_when") == "all-domains-exhausted":
        clauses.append("stop when every domain is exhausted")
    return "; ".join(clauses)


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
        return _stat_modifier(e, m, subj, ctx) + _not_cumulative_trail(m, "characteristic")
    if t == "ignore-modifiers":
        return _ignore_modifiers(m, subj)
    if t == "roll-modifier":
        return _roll_modifier(m, subj, ctx) + _not_cumulative_trail(m, "roll")
    if t == "re-roll":
        return _re_roll(e, m, subj, ctx)
    if t == "roll-result":
        return _roll_result(m, subj)
    if t == "end-attack-sequence":
        return "the attack sequence ends"
    if t == "ability-grant":
        return _ability_grant(e, m, subj, ctx, inline)
    if t == "keyword-grant":
        return _keyword_grant(m, subj)
    if t == "weapon-ability-grant":
        return _weapon_ability_grant(e, m, subj, ctx)
    if t == "weapon-grant":
        return _weapon_grant(m, subj)
    if t == "ability-modifier":
        return _ability_modifier(m, subj, ctx, inline)
    if t == "oath-modifier":
        return _oath_modifier(m, subj, ctx, inline)
    if t == "ability-activate":
        return ability_activate(m, subj)
    if t == "permission":
        return permission(m, subj, ctx)
    if t == "targeting":
        return targeting(e, m, subj, ctx)
    if t == "weapon-ability-range":
        return _weapon_ability_range(m, subj)
    if t == "counts-as":
        return _counts_as(m, subj, ctx)
    if t == "rule-state":
        ability_class = ability_class_state(e.get("target"), m, subj)
        return ability_class if ability_class is not None else _rule_state(m, subj)
    if t == "orders-modifier":
        return orders_modifier(m, subj, ctx)
    if t == "order-share":
        return order_share(m, subj, ctx)
    shaped = describe_shape_leaf(e, m, subj, ctx)
    return shaped if shaped is not None else describe_board_leaf(e, m, subj, ctx, inline)
