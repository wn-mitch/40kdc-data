"""Humanize an Ability-DSL / scoring ``condition`` into plain English.

Shared by the effect describer (whose lead-in framing lives in
``condition_leadin``), the trigger describer and the scoring-card translator. Output is
**ASCII-only** with a fixed clause and parameter order: it is pinned
byte-for-byte across the ports by the conformance corpus, so any phrasing
change here is a semantic corpus change (bump ``conformance/SPEC_VERSION``).

A condition node is a predicate (``type`` + ``parameters``) or an and/or/not
over predicates. Python mirror of ``tools/src/translate/condition.ts``; the
shared noun phrases live in ``condition_refs`` and the ``happened`` renderer in
``condition_history``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_equipment import named_equipment_phrase
from wh40kdc.translate.condition_history import _describe_happened, _destroyed_count
from wh40kdc.translate.condition_refs import (
    Condition,
    P,
    _and_list,
    _article,
    _battle_round_ord,
    _cap_word,
    _designation_phrase,
    _list,
    _obj,
    _objective_phrase,
    _or_list,
    _round_number,
    _state_phrase,
    _str,
    _subject_of,
    _truthy,
    _window_phrase,
    count_phrase,
    dekebab,
    id_label,
    move_kinds,
    place_ref_phrase,
    range_phrase,
    roll_word,
    rule_ref_phrase,
    title_case,
    unit_filter_phrase,
    unit_ref_phrase,
)
from wh40kdc.translate.effect_words import dice_case, dice_table_result_label, weapon_noun

# Shared helpers re-exported for the trigger, timing, effect and scoring describers.
__all__ = [
    "Condition",
    "P",
    "_and_list",
    "_cap_word",
    "_obj",
    "_or_list",
    "_str",
    "_truthy",
    "dekebab",
    "describe_condition",
    "move_kinds",
    "negate_phrase",
    "range_phrase",
    "title_case",
    "unit_filter_phrase",
    "unit_ref_phrase",
]
def _count_bounds(p: P) -> tuple[Any, Any]:
    count = p.get("count")
    if isinstance(count, dict):
        return count.get("min"), count.get("max")
    return None, None


def _comparison_phrase(comparison: Any) -> str:
    return {
        "gt": "more than",
        "gte": "at least",
        "eq": "equal to",
        "neq": "not equal to",
        "lt": "less than",
        "lte": "at most",
    }.get(_str(comparison), dekebab(_str(comparison)))


# -- Predicates ---------------------------------------------------------------


def _keyword_noun(keywords: list[Any], joiner: str) -> str:
    """Keywords as the rules name them: "the X keyword", "the X and Y keywords",
    "the X or Y keyword"."""
    words = [_str(k) for k in keywords]
    if joiner == "or" or len(words) == 1:
        return f"the {_or_list(words)} keyword"
    return f"the {_and_list(words)} keywords"


def _keyword_list(p: P) -> str:
    if p.get("chosen_by") is not None:
        return f"the keyword selected for {title_case(_str(p['chosen_by']))}"
    if isinstance(p.get("any_of"), list):
        return _keyword_noun(p["any_of"], "or")
    return _keyword_noun(_list(p.get("all_of")), "and")


def _describe_matches(p: P, negated: bool) -> str:
    f = _obj(p.get("filter"))
    who = "the target" if p.get("subject") == "defender" else _subject_of(p)
    keys = [key for key in f if key != "level"]
    no = "not " if negated else ""
    if len(keys) == 1:
        if f.get("all_of") is not None or f.get("any_of") is not None:
            multiple = isinstance(f.get("all_of"), list) and len(f["all_of"]) > 1
            extra = "all of " if negated and multiple else ""
            verb = "does not have" if negated else "has"
            return f"{who} {verb} {extra}{_keyword_list(f)}"
        if isinstance(f.get("none_of"), list):
            keywords = _keyword_noun(f["none_of"], "or")
            verb = "has" if negated else "does not have"
            return f"{who} {verb} {keywords}"
        if isinstance(f.get("not_all_of"), list):
            keywords = _keyword_noun(f["not_all_of"], "and")
            verb = "has" if negated else "does not have"
            return f"{who} {verb} all of {keywords}"
        if f.get("owner") is not None:
            owners = {
                "enemy": "an enemy unit",
                "friendly": "friendly",
                "any": "a unit of either player",
            }
            return f"{_subject_of(p)} is {no}{owners.get(f['owner'], 'a unit')}"
        if f.get("state") is not None:
            if f["state"] == "fights-first":
                verb = "does not have" if negated else "has"
                return f"{who} {verb} Fights First"
            return f"{who} is {_state_phrase(_str(f['state']), negated)}"
        if isinstance(f.get("not_states"), list):
            if len(f["not_states"]) == 1:
                return f"{who} is {_state_phrase(_str(f['not_states'][0]), not negated)}"
            states = [
                f"{who} is {_state_phrase(_str(state), True)}"
                for state in f["not_states"]
            ]
            grouped = _and_list(states)
            return f"not ({grouped})" if negated else grouped
        if isinstance(f.get("has_ability"), list):
            abilities = _and_list([id_label(a) for a in f["has_ability"]])
            verb = "does not have" if negated else "has"
            return f"{who} {verb} the {abilities} ability"
        if isinstance(f.get("lacks_ability"), list):
            abilities = _or_list([id_label(a) for a in f["lacks_ability"]])
            verb = "has" if negated else "does not have"
            return f"{who} {verb} the {abilities} ability"
        if f.get("designated") is not None or f.get("not_designated") is not None:
            negative = f.get("not_designated") is not None
            tag = f.get("not_designated") if negative else f.get("designated")
            prefix = "not " if negative != negated else ""
            return f"{who} is {prefix}{_designation_phrase(_str(tag))}"
        if f.get("visible") is not None:
            to = _obj(f["visible"]).get("to")
            target = "the attacking model" if to == "attacker" else unit_ref_phrase(to)
            return f"{who} is {no}visible to {target}"
        if f.get("within") is not None:
            within = _obj(f["within"])
            target = (
                ""
                if within.get("range") in ("weapon", "half-weapon")
                else f" of {place_ref_phrase(within.get('of'))}"
            )
            wholly = "wholly " if within.get("wholly") is True else ""
            return (
                f"{who} is {no}{wholly}within "
                f"{range_phrase(within.get('range'))}{target}"
            )
    return f"{who} is {no}{unit_filter_phrase(f)}"


_ELIGIBLE_TO: dict[str, str] = {
    "shoot": "shoot",
    "declare-charge": "declare a charge",
    "fight": "fight",
    "start-action": "start an action",
}


# Predicates whose phrase negates by turning its verb (see ``negate_phrase``).
_VERB_NEGATED = frozenset(
    {
        "strength",
        "model-count",
        "wounds",
        "loadout",
        "equipped-weapon-count",
        "attachment",
        "controls",
        "resource",
        "attack-compare",
        "happened-compare",
        "operation-markers",
        "engagement-fronts",
        "destroyed-while-on-objective",
        "destroyed-in-tagged-terrain",
        "army-faction",
        "battle-size",
    }
)

_NEGATED_OPENERS = (
    ("you control ", "you do not control "),
    ("you hold ", "you do not hold "),
    ("you destroyed ", "you did not destroy "),
    ("you newly control ", "you do not newly control "),
    ("you are ", "you are not "),
    ("your opponent controls ", "your opponent does not control "),
)
_NEGATE_SPLIT = re.compile(r"^(.*?) (is|was|contains|has) (.*)$")
_PERFECT_REST = re.compile(r"^(\w+ed|lost|been|fought) ", re.ASCII)


def negate_phrase(phrase: str) -> str:
    """ "X is Y" -> "X is not Y", "X has Y" -> "X does not have Y", "you control" -> "you do not
    control"; else a leading "not"."""
    for frm, to in _NEGATED_OPENERS:
        if phrase.startswith(frm):
            return to + phrase[len(frm) :]
    if phrase.startswith("1+ "):
        return f"no {phrase[3:]}"
    m = _NEGATE_SPLIT.match(phrase)
    if m:
        who, verb, rest = m.group(1), m.group(2), m.group(3)
        if verb in ("is", "was"):
            return f"{who} {verb} not {rest}"
        if verb == "contains":
            return f"{who} does not contain {rest}"
        if _PERFECT_REST.match(rest):
            return f"{who} has not {rest}"
        return f"{who} does not have {rest}"
    return f"not {phrase}"


def _describe_predicate(c: Condition, negated: bool) -> str:
    """The predicate phrase, optionally negated ("the unit is not below starting strength")."""
    neg = "not " if negated else ""
    nt = "not " if negated else ""
    p: P = _obj(c.get("parameters"))
    ctype = c.get("type")
    if negated and _str(ctype) in _VERB_NEGATED:
        return negate_phrase(_describe_predicate(c, False))
    if (
        negated
        and ctype == "happened"
        and _str(p.get("event")) not in ("move-ended", "selected", "disembarked")
    ):
        return negate_phrase(_describe_predicate(c, False))
    if (
        negated
        and ctype == "designated"
        and isinstance(p.get("subject"), dict)
        and _truthy(p["subject"].get("objective"))
    ):
        return negate_phrase(_describe_predicate(c, False))
    if ctype == "deployment-window":
        return f"{neg}during deployment"
    if ctype == "phase-is":
        phase = _str(p.get("phase"))
        if phase == "command":
            return f"{neg}during the Command phase"
        return f"{neg}during the {title_case(phase)} phase"
    if ctype == "player-turn-is":
        turn = p.get("turn")
        whose = (
            "your"
            if turn == "your-turn"
            else "the opponent's"
            if turn == "opponent-turn"
            else "either player's"
        )
        return f"{neg}in {whose} turn"
    if ctype == "battle-round":
        lo = _round_number(p["min"]) if p.get("min") is not None else None
        hi = _round_number(p["max"]) if p.get("max") is not None else None
        if lo is not None and hi is not None:
            where = (
                f"the {_battle_round_ord(lo)} battle round"
                if lo == hi
                else f"battle rounds {_str(lo)}-{_str(hi)}"
            )
        elif lo is not None:
            where = f"the {_battle_round_ord(lo)} battle round onward"
        elif hi is not None:
            where = f"the first {_str(hi)} battle rounds"
        else:
            where = "the battle round"
        return f"{neg}during {where}"
    if ctype == "matches":
        return _describe_matches(p, negated)
    if ctype == "rule-active":
        return f"the {rule_ref_phrase(p.get('rule'))} is {nt}active"
    if ctype == "has-keyword":
        who = "the target" if p.get("subject") == "defender" else _subject_of(p)
        return f"{who} {'does not have' if negated else 'has'} {_keyword_list(p)}"
    if ctype == "same-unit":
        other = "this unit" if p.get("as") == "this-unit" else unit_ref_phrase(p.get("as"))
        return f"{_subject_of(p)} is {nt}the same unit as {other}"
    if ctype == "model-profile":
        return (
            f"{_subject_of(p, 'the model')} is {nt}the "
            f"{title_case(_str(p.get('profile')))} model"
        )
    if ctype == "attachment":
        w = _obj(p.get("with"))
        if any(key != "all_of" for key in w):
            if p.get("role") == "leading":
                subject = (
                    "the model"
                    if p.get("subject") in (None, "this-model")
                    else _subject_of(p)
                )
                return f"{neg}{subject} is leading {unit_filter_phrase(w)}"
            if p.get("role") == "led":
                leaders = unit_filter_phrase({**w, "level": "model"})
                return f"{neg}{_subject_of(p, 'this unit')} is being led by {leaders}"
            return f"{neg}{_subject_of(p)} is attached to {unit_filter_phrase(w)}"
        all_of = w.get("all_of")
        kw = f"{' '.join(_str(k) for k in all_of)} " if isinstance(all_of, list) else ""
        if p.get("role") == "leading":
            leader = "the model" if p.get("subject") in (None, "this-model") else _subject_of(p)
            return f"{neg}{leader} is leading a {kw}unit"
        if p.get("role") == "led":
            return f"{neg}{_subject_of(p, 'this unit')} is being led by {_article(kw)} {kw}model"
        if kw:
            return f"{neg}{_subject_of(p)} is attached to {_article(kw)} {kw}unit"
        return f"{neg}{_subject_of(p)} is an attached unit"
    if ctype == "strength":
        below = "half strength" if p.get("below") == "half" else "starting strength"
        return f"{neg}{_subject_of(p)} is below {below}"
    if ctype == "model-count":
        kw = f"{_str(p['keyword'])} " if p.get("keyword") is not None else ""
        if p.get("min") is not None and p.get("max") is not None:
            rng = f"{_str(p['min'])}-{_str(p['max'])}"
        elif p.get("min") is not None:
            rng = f"{_str(p['min'])}+"
        else:
            rng = f"at most {_str(p.get('max'))}"
        return f"{neg}{_subject_of(p)} contains {rng} {kw}models"
    if ctype == "wounds":
        who = (
            "the model"
            if p.get("subject") == "this-model" or p.get("subject") is None
            else _subject_of(p)
        )
        parts: list[str] = []
        if p.get("lost") is True:
            parts.append("has lost wounds")
        if isinstance(p.get("remaining_max"), dict):
            parts.append("has X or fewer wounds remaining, X being its rating")
        elif p.get("remaining_max") is not None:
            parts.append(f"has {_str(_round_number(p['remaining_max']))} or fewer wounds remaining")
        if p.get("damaged") is True:
            parts.append("is Damaged")
        return f"{neg}{who} {_and_list(parts)}"
    if ctype in ("named-weapon", "unit-wargear"):
        return named_equipment_phrase(str(ctype), p, negated)
    if ctype == "equipped-weapon-count":
        scope = _obj(p.get("weapons"))
        bounds = _obj(p.get("count"))
        minimum = bounds.get("min")
        maximum = bounds.get("max")
        if minimum is not None and minimum == maximum:
            quantity = f"exactly {_str(minimum)}"
        elif minimum is not None:
            quantity = f"at least {_str(minimum)}"
        elif maximum is not None:
            quantity = f"at most {_str(maximum)}"
        else:
            quantity = "some"
        noun = weapon_noun({"weapons": scope})
        if minimum == maximum == 1:
            noun = re.sub(r"\bweapons\b", "weapon", noun, count=1)
        return f"{_subject_of(p, 'the model')} is {nt}equipped with {quantity} {noun}"
    if ctype == "loadout":
        mk = f"{_str(p['model_keyword'])} " if _truthy(p.get("model_keyword")) else ""
        return (
            f"{neg}all {_str(p.get('uniform'))} weapons equipped by each {mk}model in the unit "
            "are the same"
        )
    if ctype == "unit-state":
        who = _subject_of(p)
        with_ref = f" with {unit_ref_phrase(p['with'])}" if p.get("with") is not None else ""
        at = p.get("at")
        if at in ("phase-start", "turn-start"):
            was = "was not" if negated else "was"
            span = "phase" if at == "phase-start" else "turn"
            return (
                f"{who} {was} {_state_phrase(_str(p.get('state')))}{with_ref} "
                f"at the start of the {span}"
            )
        if p.get("state") == "fights-first":
            return f"{neg}{who} has Fights First"
        return f"{who} is {_state_phrase(_str(p.get('state')), negated)}{with_ref}"
    if ctype == "eligible":
        if p.get("to") == "embark-within":
            # The candidate being checked (this-unit) reads "that Transport".
            transport = (
                "that Transport" if p.get("transport") == "this-unit"
                else unit_ref_phrase(p.get("transport"), "that Transport")
            )
            return f"{_subject_of(p)} is {nt}able to embark within {transport}"
        if p.get("to") == "be-selected":
            source = _obj(p.get("source_ability")).get("ability_id")
            return (
                f"{neg}the candidate was eligible for the {dekebab(_str(source))} ability "
                "at the end of the opponent's previous turn"
            )
        to = _str(p.get("to"))
        return f"{_subject_of(p)} is {nt}eligible to {_ELIGIBLE_TO.get(to, dekebab(to))}"
    if ctype == "happened":
        return _describe_happened(p, negated)
    if ctype == "happened-compare":
        left = _obj(p.get("left"))
        right = _obj(p.get("right"))
        ge = p.get("comparison") == "gte"
        if right.get("pool") is not None:
            return (
                f"{neg}you destroyed at least as many {_destroyed_count(left)} as your "
                f"{dekebab(_str(right['pool']))}"
            )
        if right.get("value") is not None:
            return (
                f"{neg}you destroyed {'at least' if ge else 'more than'} "
                f"{_str(right['value'])} {_destroyed_count(left)}"
            )
        return (
            f"{neg}you destroyed {'at least as many' if ge else 'more'} {_destroyed_count(left)} "
            f"{'as' if ge else 'than'} {_destroyed_count(right)}"
        )
    if ctype == "within":
        of = p.get("of")
        range_v = p.get("range")
        wholly = "wholly " if p.get("wholly") is True else ""
        every = p.get("models") == "every"
        count_text = f" ({count_phrase(p['count'])} models)" if p.get("count") is not None else ""
        if every:
            who = f"every model in {_subject_of(p)}{count_text}"
        elif p.get("count") is not None:
            who = f"{count_phrase(p['count'])} models in {_subject_of(p)}"
        else:
            who = _subject_of(p)
        plural = not every and p.get("count") is not None
        target = (
            "" if range_v in ("half-weapon", "weapon") else f" of {place_ref_phrase(of)}"
        )
        at = " at the start of the phase" if p.get("at") == "phase-start" else ""
        if p.get("at") == "phase-start":
            verb = "were" if plural else "was"
        else:
            verb = "are" if plural else "is"
        return f"{who} {verb} {nt}{wholly}within {range_phrase(range_v)}{target}{at}"
    if ctype == "in-region":
        r = _obj(p.get("region"))
        wholly = "wholly " if p.get("wholly") is True else ""
        who = f"every model in {_subject_of(p)}" if p.get("models") == "every" else _subject_of(p)
        if _truthy(r.get("rule_region")):
            where = title_case(_str(_obj(r["rule_region"]).get("region_id")))
        elif _truthy(r.get("territory")):
            where = dekebab(_str(r["territory"]))
        else:
            area = _obj(r.get("terrain_area"))
            where = (
                f"the {dekebab(_str(area['footprint']))} terrain area"
                if area.get("footprint") is not None
                else "a terrain area"
            )
            if area.get("designated") is not None:
                where += f" tagged {dekebab(_str(area['designated']))}"
        return f"{who} is {nt}{wholly}within {where}"
    if ctype == "closest":
        who = "the target" if p.get("subject") == "defender" else _subject_of(p)
        within = f" within {range_phrase(p['range'])}" if p.get("range") is not None else ""
        among = (
            "eligible target"
            if p.get("among") == "eligible-targets"
            else re.sub(r"^an? ", "", unit_filter_phrase(p["among"]), count=1)
            if isinstance(p.get("among"), (dict, list))
            else "unit"
        )
        return f"{neg}{who} is the closest {among}{within}"
    if ctype == "controls":
        who = "your opponent controls" if p.get("by") == "enemy" else "you control"
        objective = _objective_phrase(_obj(p.get("objective")), True)
        clauses: list[str] = []
        if p.get("count") is not None or (p.get("compare") is None and p.get("proportion") is None):
            clauses.append(f"{who} {count_phrase(p.get('count'))} {objective}")
        compare = p.get("compare")
        if isinstance(compare, dict):
            other = "you" if compare.get("owner") == "friendly" else "the opponent"
            holder = "your opponent holds" if p.get("by") == "enemy" else "you hold"
            if compare.get("comparison") == "gt":
                clauses.append(f"{holder} more {objective} than {other}")
            else:
                controller = (
                    "your opponent controls" if p.get("by") == "enemy" else "you control"
                )
                compared = (
                    "you control"
                    if compare.get("owner") == "friendly"
                    else "the opponent controls"
                )
                clauses.append(
                    f"the number of {objective} {controller} is "
                    f"{_comparison_phrase(compare.get('comparison'))} the number "
                    f"{compared}"
                )
        proportion = p.get("proportion")
        if isinstance(proportion, dict):
            value = proportion.get("fraction")
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                fraction = "half" if value == 0.5 else f"{value * 100:g}%"
            else:
                fraction = _str(value)
            comparison = _comparison_phrase(proportion.get("comparison"))
            clauses.append(f"{who} {comparison} {fraction} of the {objective}")
        return f"{neg}{' and '.join(clauses)}"
    if ctype == "attack-is":
        atk_t = f"{_str(p['attack_type'])} " if _truthy(p.get("attack_type")) else ""
        if p.get("all_target_same_unit") is True:
            return f"{neg}all of the unit's {atk_t}attacks target the same enemy unit"
        kind_parts = [
            f"{dekebab(_str(p['shooting_type']))} shooting"
            if _truthy(p.get("shooting_type"))
            else "",
            f"{dekebab(_str(p['fight_type']))} fight" if _truthy(p.get("fight_type")) else "",
            _str(p["attack_type"]) if _truthy(p.get("attack_type")) else "",
        ]
        kind = " ".join(k for k in kind_parts if k)
        out = [f"for {kind + ' ' if kind else ''}attacks"]
        weapons = p.get("weapons")
        if isinstance(weapons, dict):
            keyword = weapons.get("keyword")
            if isinstance(keyword, dict):
                keyword = keyword.get("keyword_id")
            if _truthy(keyword):
                out.append(f"made with [{dekebab(_str(keyword)).upper()}] weapons")
            if _truthy(weapons.get("name")):
                out.append(f"made with {_str(weapons['name'])}")
        return f"{neg}{' '.join(out)}"
    if ctype == "attack-compare":

        def compare_side(o: P) -> str:
            if o.get("value") is not None:
                return _str(o["value"])
            whose = "the target's" if o.get("of") == "defender" else "the attack's"
            reduce = o.get("reduce")
            red = "highest " if reduce == "max" else "lowest " if reduce == "min" else ""
            return f"{whose} {red}{_str(o.get('stat'))}"

        cmp = _comparison_phrase(p.get("comparison"))
        lhs = compare_side(_obj(p.get("left")))
        rhs = compare_side(_obj(p.get("right")))
        return f"{neg}{lhs} is {cmp} {rhs}"
    if ctype == "roll-result":
        outcome = "succeeded" if p.get("result") == "success" else f"was a {_str(p.get('result'))}"
        return f"{neg}the triggering {roll_word(p.get('roll'))} roll {outcome}"
    # Generated by the cruncher for one outcome of an ability's dice table; never authored.
    if ctype == "dice-table-result":
        # A run of faces reads "2-6"; any other set "1 or 3".
        label = dice_table_result_label(p.get("results"))
        if "," in label:
            label = _or_list(label.split(", "))
        return f"the {dice_case(p.get('dice'))} roll is {neg}{label}"
    if ctype == "visible":
        who = "the target" if p.get("subject") == "defender" else _subject_of(p)
        to_v = p.get("to")
        to = "the attacking model" if to_v is None or to_v == "attacker" else unit_ref_phrase(to_v)
        fully = "fully " if p.get("fully") is True else ""
        if p.get("blocked_by") is not None:
            blocker = unit_ref_phrase(p["blocked_by"], "this unit")
            if blocker == "the unit":
                blocker = "this unit"
            return (
                f"{who} is {'' if negated else 'not '}{fully}visible to {to} because of {blocker}"
            )
        return f"{who} is {nt}{fully}visible to {to}"
    if ctype == "designated":
        s_v = p.get("subject")
        if isinstance(s_v, dict) and _truthy(s_v.get("objective")):
            minimum, maximum = _count_bounds(p)
            if minimum is not None and maximum is not None and minimum == maximum:
                count = f"exactly {_str(minimum)}"
            elif minimum is not None and maximum is not None:
                count = f"{_str(minimum)}-{_str(maximum)}"
            elif minimum is not None:
                count = f"{_str(minimum)}+"
            else:
                count = f"at most {_str(maximum)}"
            return (
                f"{neg}{count} {_objective_phrase(s_v['objective'], True)} "
                f"tagged {dekebab(_str(p.get('tag')))}"
            )
        if p.get("count") is not None:
            subject = re.sub(
                r"\b(unit|model)\b",
                r"\1s",
                re.sub(r"^an? ", "", unit_ref_phrase(s_v)),
                count=1,
            )
            by = f" by {unit_ref_phrase(p['by'])}" if p.get("by") is not None else ""
            return (
                f"{neg}{count_phrase(p.get('count'))} {subject} "
                f"{_designation_phrase(_str(p.get('tag')))}{by}"
            )
        by = ""
        if p.get("by") is not None:
            by_phrase = unit_ref_phrase(p["by"], "this unit")
            by = f" by {'this unit' if by_phrase == 'the unit' else by_phrase}"
        return f"{_subject_of(p)} is {nt}{_designation_phrase(_str(p.get('tag')))}{by}"
    if ctype == "resource":
        if p.get("below_max") is True:
            source = _obj(p.get("source_ability")).get("ability_id")
            return (
                f"{neg}the {dekebab(_str(source))} ability had unused selection capacity "
                "at the end of the opponent's previous turn"
            )
        bounds = _obj(p.get("count"))
        minimum = bounds.get("min")
        maximum = bounds.get("max")
        amount = (
            f"{_str(minimum)}+"
            if minimum is not None
            else f"at most {_str(maximum)}"
        )
        return f"{neg}the unit has {amount} {dekebab(_str(p.get('pool')))}"
    if ctype == "operation-markers":
        side_s = f"{_str(p['side'])} " if p.get("side") is not None else ""
        lo, hi = _count_bounds(p)
        if hi == 0:
            s = f"no {side_s}operation markers on the battlefield"
        elif lo is not None and hi is not None and lo == hi:
            suffix = "" if lo == 1 else "s"
            s = f"exactly {_str(lo)} {side_s}operation marker{suffix} on the battlefield"
        else:
            s = f"{_str(lo if lo is not None else 1)}+ {side_s}operation markers on the battlefield"
        if p.get("within") is not None:
            within = p["within"]
            within_obj: dict[str, Any] = within if isinstance(within, dict) else {}
            objective_ref = within_obj.get("of")
            marker_objective = _obj(objective_ref).get("objective")
            origin = (
                f"an {_objective_phrase(marker_objective, False, 'objective marker')}"
                if marker_objective is not None
                else place_ref_phrase(objective_ref)
            )
            s += f" within {range_phrase(within_obj.get('range'))} of {origin}"
        if _truthy(p.get("friendly_unit_in_same_terrain_area")):
            s += " with a friendly unit in the same terrain area"
        if _truthy(p.get("no_enemy_in_terrain_area")):
            s += " and no enemy units in that terrain area"
        return f"{neg}{s}"
    if ctype == "engagement-fronts":
        fronts = _count_bounds(p)[0]
        return f"{neg}you are engaged on {_str(fronts if fronts is not None else 1)}+ fronts"
    if ctype == "destroyed-while-on-objective":
        obj = (
            f"a {dekebab(_str(p['objective_role']))} objective"
            if _truthy(p.get("objective_role"))
            else "an objective"
        )
        destroyed_count = _count_bounds(p)[0]
        count = _str(destroyed_count if destroyed_count is not None else 1)
        s = f"{neg}{count}+ enemy units destroyed"
        if _truthy(p.get("destroyer_on_objective")):
            s += f" by a unit on {obj}"
        if _truthy(p.get("victim_on_objective")):
            s += f" while on {obj}"
        if _truthy(p.get("victim_started_turn_on_objective")):
            s += f" that started the turn on {obj}"
        return s
    if ctype == "destroyed-in-tagged-terrain":
        where = "that started the turn in" if _truthy(p.get("at_start_of_turn")) else "while in"
        terrain = (
            f"{dekebab(_str(p['tag']))} terrain" if p.get("tag") is not None else "a terrain area"
        )
        terrain_destroyed_count = _count_bounds(p)[0]
        count = _str(terrain_destroyed_count if terrain_destroyed_count is not None else 1)
        return f"{neg}{count}+ enemy units destroyed {where} {terrain}"
    if ctype == "army-state":
        owner = "your" if p.get("owner") == "friendly" else "your opponent's"
        return f"{owner} army is {'not ' if negated else ''}honoured"
    if ctype == "oath-state":
        return (
            f"the {id_label(p.get('ability'))} oath is "
            f"{'not ' if negated else ''}fulfilled"
        )
    if ctype == "battle-size":
        return f"the battle size is {nt}{title_case(_str(p.get('size')))}"
    if ctype == "army-faction":
        faction = _str(p.get("faction")).replace("-", " ").upper()
        return f"your Army Faction is {nt}{faction}"
    if ctype == "army-includes":
        return _army_includes(p, negated)
    if ctype == "moved-over":
        who = _subject_of(p, "the unit")
        win = p.get("window")
        window = "during that move" if win is None or win == "event" else _window_phrase(win)
        by = unit_ref_phrase(p.get("by"), "this model")
        return f"{who} {'was not' if negated else 'was'} moved over by {by} {window}"
    if ctype == "guided":
        return f"{_subject_of(p, 'the unit')} is {nt}{_designation_phrase('guided')}"
    return f"{neg}{dekebab(ctype if ctype is not None else 'unknown')}"


def describe_condition(c: Condition) -> str:
    """A condition as a predicate phrase ("the unit is below starting strength and ...")."""
    op = c.get("operator")
    operands = c.get("operands")
    if op == "and" and operands is not None:
        return " and ".join(
            f"({describe_condition(o)})" if o.get("operator") == "or" else describe_condition(o)
            for o in operands
        )
    if op == "or" and operands is not None:
        return " or ".join(
            f"({describe_condition(o)})" if o.get("operator") == "and" else describe_condition(o)
            for o in operands
        )
    if op == "not" and operands is not None:
        if (
            len(operands) == 1
            and isinstance(operands[0], dict)
            and not _truthy(operands[0].get("operator"))
        ):
            return _describe_predicate(operands[0], True)
        # not(not(X)) reads as X, never "not (… is not …)".
        only = operands[0] if len(operands) == 1 and isinstance(operands[0], dict) else None
        if (
            only is not None
            and only.get("operator") == "not"
            and isinstance(only.get("operands"), list)
            and len(only["operands"]) == 1
        ):
            return describe_condition(only["operands"][0])
        return f"not ({', '.join(describe_condition(o) for o in operands)})"
    return _describe_predicate(c, False)


def _army_includes(p: P, negated: bool) -> str:
    """"your army includes a CHARACTER unit", "your army includes 2 or more X units", "every
    model in your army has the IMPERIUM keyword". The army is yours, so the filter's owner is
    not repeated."""
    f = dict(p.get("filter") or {})
    f.pop("owner", None)
    noun = "model" if f.get("level") == "model" else "unit"
    if p.get("every") is True:
        all_ = [_str(x) for x in f.get("all_of") or []] if isinstance(f.get("all_of"), list) else []
        any_ = [_str(x) for x in f.get("any_of") or []] if isinstance(f.get("any_of"), list) else []
        words = _or_list(any_) if any_ else _and_list(all_)
        plural = "s" if len(all_) > 1 and not any_ else ""
        not_word = "not " if negated else ""
        return f"{not_word}every {noun} in your army has the {words} keyword{plural}"
    one = unit_filter_phrase(f)
    raw_min = p.get("min")
    minimum = raw_min if raw_min is not None else 1
    if minimum > 1:
        bare = re.sub(r"^an? ", "", one, count=1)
        plural_noun = re.sub(r"\b(unit|model)\b", r"\1s", bare, count=1)
        what = f"{minimum} or more {plural_noun}"
    else:
        what = one
    return f"your army {'does not include' if negated else 'includes'} {what}"
