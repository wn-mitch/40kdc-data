"""Single effects on the board axes: protection, models, moves, placement, tests,
resources, designation and army construction. One lowercase-initial clause, no period.

Python mirror of ``tools/src/translate/effect-leaf-board.ts``.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import Any

from wh40kdc.translate.condition import describe_condition
from wh40kdc.translate.condition_leadin import condition_lead_in
from wh40kdc.translate.condition_refs import _objective_phrase
from wh40kdc.translate.effect_leaf_army import (
    army_rule,
    cost_modifier,
    cp_gain,
    resource_die,
    resource_gain,
    resource_spend,
    transport_capacity,
)
from wh40kdc.translate.effect_placement import place_phrase, placement_limits, placement_phrase
from wh40kdc.translate.effect_quantity import amount_of, is_literal, moved_phrase
from wh40kdc.translate.effect_words import (
    Ctx,
    and_list,
    dekebab,
    designation_for,
    dice_case,
    effect_subject,
    format_comparison,
    is_rating_ref,
    jstr,
    none_of,
    num,
    num_str,
    of_or_possessive,
    pronoun,
    range_phrase,
    region_phrase,
    signed,
    test_name,
    title_case,
    v,
    weapon_noun,
)
from wh40kdc.translate.expiry import expiry_trail

Leaf = dict[str, Any]
Inline = Callable[[Any, Ctx], str]


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _wounds(n: str, noun: str = "mortal wound") -> str:
    return noun if n == "1" else f"{noun}s"


def _mortal_wounds(m: dict[str, Any], subj: str) -> str:
    count = dice_case(m.get("count"))
    suffered = (
        f"{count} {_wounds(count)}"
        if is_literal(m.get("count"))
        else amount_of(m.get("count"), "mortal wound", "mortal wounds")
    )
    psychic = " (Psychic Attack)" if m.get("psychic") is True else ""
    # A range the target filter already states is not repeated ('within 9" within 9"').
    rng = ""
    if m.get("range") is not None and f" within {range_phrase(m['range'])}" not in subj:
        rng = f" within {range_phrase(m['range'])}"
    who = f"{subj}{rng}"
    roll = m.get("roll")
    if roll is not None:
        roll = _obj(roll)
        per_model = roll.get("per_model")
        each = (
            " for each model in the target unit"
            if per_model == "target"
            else " for each model in this unit"
            if per_model == "this"
            else ""
        )
        dice = f"one {dice_case(roll.get('dice'))}" if each else dice_case(roll.get("dice"))
        return (
            f"roll {dice}{each}: for each {jstr(roll.get('threshold'))}+, {who} "
            f"{v(who, 'suffers')} "
            f"{suffered}{psychic}"
        )
    per = (
        f" for each model in {'them' if pronoun(who) == 'their' else 'it'}"
        if m.get("per") == "model"
        else ""
    )
    return f"{who} {v(who, 'suffers')} {suffered}{per}{psychic}"


_FNP_AGAINST = {
    "mortal": " against mortal wounds",
    "psychic": " against Psychic Attacks",
    "psychic-and-mortal": " against Psychic Attacks and mortal wounds",
}


def _return_models(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    wr = m.get("wounds_remaining")
    if wr is None or wr == "full":
        w = "its full wounds"
    elif is_literal(wr):
        w = f"{dice_case(wr)} {_wounds(dice_case(wr), 'wound')}"
    else:
        w = amount_of(wr, "wound", "wounds")
    where = f"{placement_phrase(m)}{placement_limits(m, ctx)}"
    detach = ""
    if m.get("detach") is True:
        strength = (
            f" with a Starting Strength of {jstr(m['starting_strength'])}"
            if m.get("starting_strength") is not None
            else ""
        )
        detach = f", as a separate unit{strength} (it is no longer part of its attached unit)"
    if e.get("target") == "this-model":
        return f"{subj} is set up again{where} with {w} remaining{detach}"
    if m.get("model_keyword") is not None:
        kw = f"{jstr(m['model_keyword'])} "
    elif m.get("bodyguard_only") is True:
        kw = "Bodyguard "
    else:
        kw = ""
    kind = f"destroyed {kw}model"
    what = (
        f"all {kind}s" if m.get("count") == "all" else amount_of(m.get("count"), kind, f"{kind}s")
    )
    excluded = m.get("exclude_model_keyword")
    excl = (
        f" (excluding {and_list([jstr(k) for k in excluded])} models)"
        if isinstance(excluded, list)
        else ""
    )
    return f"return {what}{excl} to {subj}{where}, each with {w} remaining{detach}"


def _destroy_models(m: dict[str, Any], subj: str) -> str:
    kind = f"{jstr(m['model_keyword'])} model" if m.get("model_keyword") is not None else "model"
    if m.get("count") == "all":
        what = f"every {kind} in {subj}"
    else:
        c = dice_case(m.get("count"))
        what = f"{c} {kind if c == '1' else f'{kind}s'} in {subj}"
    leader = " (excluding Leader models)" if m.get("exclude_leader") is True else ""
    remove = m.get("remove_from_play") is True
    verb = "remove" if remove else "destroy"
    tail = " from play" if remove else ""
    triggers = (
        ", ignoring any rules triggered by their destruction"
        if m.get("ignore_death_triggers") is True
        else ""
    )
    return f"{verb} {what}{leader}{tail}{triggers}"


def _act_on_death(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    act = "shoot" if m.get("act") == "shoot" else "fight"
    if e.get("target") == "event-object":
        model = "a model in this unit"
    elif subj == "this model":
        model = "this model"
    else:
        model = f"a model in {subj}"
    gate = m.get("gate")
    if gate is not None:
        gate = _obj(gate)
        elig = m.get("eligibility")
        before = f" {condition_lead_in(elig)}" if elig is not None else ""
        adds = "".join(
            f", adding {jstr(_obj(g).get('value'))} "
            f"{condition_lead_in(_obj(g).get('condition') or {})}"
            for g in (gate.get("modifiers") or [])
        )
        if m.get("removal") == "after-destroyed-model-fights":
            removal = f". Remove it after it has {'shot' if act == 'shoot' else 'fought'}"
        else:
            removal = (
                ". Remove it after this unit has fought or at the end of the phase, whichever "
                "comes first"
            )
        comparison = jstr(gate.get("comparison") if gate.get("comparison") is not None else "gte")
        # Under a destroyed trigger the ability's lead-in already names the death: one lead-in only.
        if ctx.get("destroyed_trigger"):
            lead = f"{before.strip()}, " if before else ""
        else:
            lead = f"each time {model} is destroyed{f',{before}' if before else ''}, "
        return (
            f"{lead}roll one {dice_case(gate.get('dice'))}{adds}. "
            f"On {format_comparison(comparison, gate.get('threshold'))}, leave that model on "
            "the battlefield; "
            f"it can {act}{removal}"
        )
    if m.get("resolution") == "when-unit-fights":
        return (
            f"do not remove {subj} yet; when its unit is selected to fight, it can {act}; "
            "remove it after its unit "
            "has finished fighting or at the end of the phase, whichever happens first"
        )
    if m.get("resolution") == "after-attacking-unit-finishes":
        return (
            f"do not remove {subj} yet; after the attacking unit has finished making its attacks, "
            f"it can {act}; then remove it"
        )
    if ctx.get("destroyed_trigger"):
        return (
            f"{'this model' if model == 'this model' else 'that model'} can {act} before being "
            "removed from play"
        )
    return f"each time {model} is destroyed, it can {act} before being removed from play"


def _add_unit(m: dict[str, Any], ctx: Ctx) -> str:
    where = f"{placement_phrase(m)}{placement_limits(m, ctx)}"
    engage = (
        f"; it can be set up within Engagement Range of "
        f"{effect_subject(m['allow_engagement_with'], ctx)}"
        if m.get("allow_engagement_with") is not None
        else ""
    )
    models = (
        f" containing {amount_of(m['model_count'], 'model', 'models')}"
        if m.get("model_count") is not None
        else ""
    )
    strength = (
        f" with a Starting Strength of {jstr(m['starting_strength'])}"
        if m.get("starting_strength") is not None
        else ""
    )
    sheet = title_case(jstr(m.get("datasheet")))
    # New models that join an existing unit rather than forming their own.
    if m.get("join") is not None:
        size = next((m[k] for k in ("model_count", "count") if m.get(k) is not None), 1)
        added = amount_of(size, f"{sheet} model", f"{sheet} models")
        return f"add {added} to {effect_subject(m['join'], ctx)}{where}{engage}"
    literal = is_literal(m.get("count"))
    n = num(m.get("count") if m.get("count") is not None else 1) if literal else math.nan
    if m.get("copy_of") is not None:
        if n == 1:
            units = "a new unit"
        elif literal:
            units = f"{num_str(n)} new units"
        else:
            units = amount_of(m.get("count"), "new unit", "new units")
        what = f"{units} identical to {effect_subject(m['copy_of'], ctx)}"
    elif n == 1:
        what = f"a {sheet} unit"
    elif literal:
        what = f"{num_str(n)} {sheet} units"
    else:
        what = amount_of(m.get("count"), f"{sheet} unit", f"{sheet} units")
    return f"add {what}{models}{strength} to your army{where}{engage}"


_MOVE_VERBS = {
    "normal": "make a Normal move",
    "advance": "Advance",
    "fall-back": "Fall Back",
    "charge": "declare a charge",
    "pile-in": "Pile In",
    "consolidation": "Consolidate",
    "surge": "make a Surge move",
    "scout": "make a Scout move",
    "ingress": "make an Ingress move",
    "disembark": "disembark",
    "embark": "embark",
    "pulse-jet": "make a Pulse Jet move",
}
_MOVE_NOUNS = {
    "normal": "Normal",
    "advance": "Advance",
    "fall-back": "Fall Back",
    "charge": "Charge",
    "pile-in": "Pile-in",
    "consolidation": "Consolidation",
    "surge": "Surge",
    "scout": "Scout",
    "ingress": "Ingress",
    "disembark": "Disembark",
    "embark": "Embark",
    "pulse-jet": "Pulse Jet",
}
_PASSTHROUGH = {
    "non-titanic-models": "non-Titanic models",
    "friendly-vehicles": "friendly Vehicle models",
    "friendly-monsters": "friendly Monster models",
    "terrain-le-4": 'terrain features 4" or lower',
    "tall-terrain": 'terrain features over 4"',
    "all-terrain": "terrain features",
    "enemy-models": "enemy models",
}


def _passthrough(p: Any) -> str:
    return and_list(
        [
            _pass_item(x) if isinstance(x, dict) else _PASSTHROUGH.get(jstr(x), dekebab(jstr(x)))
            for x in p
        ]
    )


def _pass_item(x: dict[str, Any]) -> str:
    """A typed pass-through item: "models (excluding MONSTER and VEHICLE models)"."""
    if x.get("kind") == "terrain":
        if x.get("height") == "up-to-4":
            return 'terrain features 4" or lower'
        return 'terrain features over 4"' if x.get("height") == "over-4" else "terrain features"
    owner = {"friendly": "friendly ", "enemy": "enemy "}.get(x.get("owner"), "")  # type: ignore[arg-type]
    all_of = x.get("all_of")
    all_s = (
        f"{' '.join(title_case(jstr(k).lower()) for k in all_of)} "
        if isinstance(all_of, list)
        else ""
    )
    excluding = x.get("excluding")
    excl = (
        f" (excluding {and_list([jstr(k) for k in excluding])} models)"
        if isinstance(excluding, list)
        else ""
    )
    return f"{owner}{all_s}models{excl}"


def _ends_of(of: Any, ctx: Ctx) -> str:
    """A unit-ref keeps its effect-subject phrase; markers, objectives and edges read as places."""
    if of is None:
        return "this model"
    if isinstance(of, str):
        place = of.startswith("battlefield-")
    else:
        place = isinstance(of, dict) and (
            of.get("marker") is not None or of.get("objective") is not None
        )
    return place_phrase(of, ctx) if place else effect_subject(of, ctx)


def _mode_clause(m: dict[str, Any]) -> str:
    """ " using the Rapid Disembarkation rules", " using the Desperate Escape rules"."""
    if m.get("mode") is None:
        return ""
    mode = title_case(jstr(m["mode"]))
    disembark = m.get("move_type") == "disembark" or m.get("from") == "transport"
    return f" using the {f'{mode} Disembarkation' if disembark else mode} rules"


def _move(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    verb = _MOVE_VERBS.get(
        jstr(m.get("move_type")), f"make a {dekebab(jstr(m.get('move_type')))} move"
    )
    up_to = ""
    if m.get("distance") is not None:
        d = dice_case(m["distance"])
        up_to = f' of up to {d}"' if verb.startswith("make ") else f' up to {d}"'
    s = f"{subj} can {verb}{up_to}{_mode_clause(m)}"
    if isinstance(m.get("passthrough"), list):
        s += f", moving over {_passthrough(m['passthrough'])} as though they were not there"
    ends = m.get("ends_within")
    if ends is not None:
        ends = _obj(ends)
        of = _ends_of(ends.get("of"), ctx)
        wholly = "wholly " if ends.get("wholly") is True else ""
        s += f", ending that move {wholly}within {range_phrase(ends.get('range'))} of {of}"
    if m.get("ends_when") is not None:
        s += f"; it must end that move where {describe_condition(_obj(m['ends_when']))}"
    if m.get("allow_engagement") is True:
        s += "; it can end that move within Engagement Range of enemy units"
    if m.get("counts_as_move") is not None:
        s += f"; that move counts as {moved_phrase(m['counts_as_move'])}"
    if m.get("keeps_eligible") is True:
        s += "; doing so does not change what it is eligible to do this turn"
    return s


def _move_modifier(m: dict[str, Any], subj: str) -> str:
    kinds = (
        and_list([_MOVE_NOUNS.get(jstr(x), dekebab(jstr(x))) for x in m["applies_to_moves"]])
        if isinstance(m.get("applies_to_moves"), list)
        else None
    )
    clauses: list[str] = []
    if m.get("distance_bonus") is not None:
        n = num(m["distance_bonus"])
        moves = f"{kinds} moves" if kinds else "Move characteristic"
        if not math.isnan(n) and n < 0:
            clauses.append(f'subtract {num_str(abs(n))}" from {of_or_possessive(subj, moves)}')
        else:
            clauses.append(
                f'add {dice_case(m["distance_bonus"])}" to {of_or_possessive(subj, moves)}'
            )
    if m.get("advance") == "fixed-6":
        clauses.append(
            f'{subj} {v(subj, "does")} not make an Advance roll; add 6" to {pronoun(subj)} '
            "Move characteristic instead"
        )
    if isinstance(m.get("passthrough"), list):
        clauses.append(
            f"{subj} can move over {_passthrough(m['passthrough'])} as though they were not there"
        )
    if m.get("no_end_in_engagement") is True:
        clauses.append(f"{subj} cannot end a move within Engagement Range of any enemy unit")
    if m.get("end_on_terrain") is True:
        clauses.append(f"{subj} can end {pronoun(subj)} moves on top of terrain features")
    if m.get("ignore_vertical") is True:
        moves_verb = "they move" if pronoun(subj) == "their" else "it moves"
        clauses.append(f"{subj} {v(subj, 'ignores')} vertical distances when {moves_verb}")
    s = "; ".join(clauses)
    return (
        f"{s}, during {pronoun(subj)} {kinds} moves"
        if kinds and m.get("distance_bonus") is None
        else s
    )


_ORD = ["", "first", "second", "third", "fourth", "fifth"]


def _turn_ord(t: Any) -> str:
    if isinstance(t, int) and not isinstance(t, bool) and 0 <= t < len(_ORD):
        return _ORD[t]
    return f"{jstr(t)}th"


def _set_up(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    if m.get("subject") == "models-on-this-model":
        who = "the models on this model"
    elif m.get("subject") is not None:
        who = effect_subject(m["subject"], ctx)
    else:
        who = subj
    limits = (
        ", ignoring any limits on units in Strategic Reserves"
        if m.get("ignore_limits") is True
        else ""
    )
    denied = m.get("allow") is False
    can = "cannot" if denied else "must" if m.get("mandatory") is True else "can"
    if m.get("to") == "strategic-reserves":
        return f"{none_of(who) if denied else who} {can} be placed into Strategic Reserves{limits}"
    frm = m.get("from")
    source = (
        " from Strategic Reserves"
        if frm == "strategic-reserves"
        else " from its Transport"
        if frm == "transport"
        else ""
    )
    who_can = none_of(who) if denied else who
    if frm == "battlefield":
        s = f"{who_can} {can} be removed from the battlefield and set up again"
    else:
        s = f"{who_can} {can} be set up on the battlefield{source}"
    if m.get("via") == "deep-strike":
        s += " using the Deep Strike rules"
    s += _mode_clause(m)
    if isinstance(m.get("turns"), list):
        turns = re.sub(r", ([^,]*)$", r" or \1", ", ".join(_turn_ord(t) for t in m["turns"]))
        s += f" in the Reinforcements step of your {turns} Movement phase"
    if m.get("arrives") == "next-movement-phase":
        first = " (even in the first battle round)" if m.get("allow_first_round") is True else ""
        s += f" in the Reinforcements step of your next Movement phase{first}"
    if m.get("sections") is not None:
        s += f" as {jstr(m['sections'])} separate sections"
    s += placement_phrase(m) + placement_limits(m, ctx)
    if m.get("within_edge") is not None:
        s += f' wholly within {jstr(m["within_edge"])}" of a battlefield edge'
    if m.get("min_enemy_distance") is not None:
        s += f' more than {jstr(m["min_enemy_distance"])}" away from all enemy models'
    md = m.get("min_distance_from")
    if md is not None:
        md = _obj(md)
        of = effect_subject(md["of"], ctx) if md.get("of") is not None else "this model"
        s += (
            f" {'within' if denied else 'more than'} "
            f"{range_phrase(md.get('range'))}{' of' if denied else ' away from'} {of}"
        )
    if m.get("round_offset") is not None:
        off = num(m["round_offset"])
        s += (
            f", treating the battle round as {num_str(abs(off))} "
            f"{'lower' if off < 0 else 'higher'} than it is"
        )
    if m.get("allow_engagement") is True:
        s += "; it can be set up within Engagement Range of enemy units"
    if m.get("counts_as_move") is not None:
        s += f"; it counts as having made {moved_phrase(m['counts_as_move'])} this turn"
    return s + limits


def _marker(m: dict[str, Any]) -> str:
    # A label that already ends in "marker" ("cult-ambush-marker") must not read "marker marker".
    label = re.sub(r" marker$", "", dekebab(jstr(m.get("label"))), flags=re.IGNORECASE)
    consume = "; using the marker consumes it" if m.get("consume") == "on-use" else ""
    if m.get("operation") == "relocate":
        dist = f' up to {jstr(m["distance"])}"' if m.get("distance") is not None else ""
        return f"move the {label} marker{dist}{consume}"
    where = f" {dekebab(jstr(m['placement']))}" if m.get("placement") is not None else ""
    article = "an" if re.match(r"[aeiou]", label, re.IGNORECASE) else "a"
    return f"place {article} {label} marker{where}{consume}"


def _test(m: dict[str, Any], subj: str) -> str:
    n = num(m.get("count") if m.get("count") is not None else 1)
    tests = (
        f"a {test_name(m.get('test'))} test"
        if n == 1
        else f"{num_str(n)} {test_name(m.get('test'))} tests"
    )
    per = f" for each {dekebab(jstr(m['per']))}" if m.get("per") is not None else ""
    mod = ""
    if m.get("modifier") is not None:
        those = "that test" if n == 1 and per == "" else "those tests"
        mod = f", applying {signed('add', m['modifier'])} to {those}"
    return f"{subj} must take {tests}{per}{mod}"


def _designate(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    s = m.get("subject")
    if s is None:
        what = subj
    elif isinstance(s, dict) and s.get("objective") is not None:
        if _obj(s["objective"]).get("selection_var") is not None:
            what = "that objective marker"
        else:
            what = f"the {_objective_phrase(_obj(s['objective']))}"
    elif isinstance(s, dict) and s.get("terrain_area") is not None:
        what = region_phrase({"terrain_area": s["terrain_area"]})
    else:
        what = effect_subject(s, ctx)
    tag = designation_for(jstr(m.get("tag")))
    clears = m.get("clears_on")
    legacy = (
        " until the end of the turn"
        if clears == "turn-rollover"
        else " until the end of the phase"
        if clears == "phase-end"
        else ""
    )
    trail = expiry_trail(clears)
    until = legacy or (f" {trail}" if trail and clears != "battle" else "")
    by = f" by {effect_subject(m['by'], ctx)}" if m.get("by") is not None else ""
    if m.get("clear") is True:
        return f"{what} {v(what, 'is')} no longer {tag}"
    return f"{what} {v(what, 'is')} {tag}{by}{until}"


def _damage_reduction(m: dict[str, Any], subj: str) -> str:
    r = jstr(m.get("reduction"))
    if r == "half":
        how = "halve the Damage of that attack"
    elif r == "to-zero":
        how = "change the Damage of that attack to 0"
    else:
        how = f"subtract {r} from the Damage characteristic of that attack"
    weapon = (
        m.get("weapon_type") is not None
        or m.get("weapon_name") is not None
        or m.get("weapon_keyword") is not None
    )
    attack = f"an attack with {weapon_noun(m)}" if weapon else "an attack"
    return f"each time {attack} is allocated to {subj}, {how}"


def _heal(m: dict[str, Any], subj: str) -> str:
    who = f"each model in {subj}" if m.get("per") == "model" else subj
    if m.get("amount") == "full":
        return f"{who} {v(who, 'regains')} all {pronoun(who)} lost wounds"
    if not is_literal(m.get("amount")):
        lost = amount_of(m.get("amount"), "lost wound", "lost wounds")
        return f"{who} {v(who, 'regains')} up to {lost}"
    amount = dice_case(m.get("amount"))
    return f"{who} {v(who, 'regains')} up to {amount} lost {'wound' if amount == '1' else 'wounds'}"


def _split_unit(m: dict[str, Any], subj: str) -> str:
    if m.get("by") == "model":
        return f"split {subj} into units of one model each"
    by = m.get("by")
    if isinstance(by, dict) and by.get("model_keyword") is not None:
        return (
            f"split {subj} into one unit of each of its "
            f"{and_list([jstr(k) for k in by['model_keyword']])} models"
        )
    counts = [jstr(c) for c in m["model_counts"]] if isinstance(m.get("model_counts"), list) else []
    return f"split {subj} into {len(counts)} units of {and_list(counts)} models"


def describe_board_leaf(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx, inline: Inline) -> str:
    """The board-axis leaves; anything unknown degrades to ``[type]``."""
    t = e.get("type")
    if t == "mortal-wounds":
        return _mortal_wounds(m, subj)
    if t == "damage-reduction":
        return _damage_reduction(m, subj)
    if t == "feel-no-pain":
        rated = is_rating_ref(m.get("threshold"))
        threshold = "X" if rated else jstr(m.get("threshold"))
        against = _FNP_AGAINST.get(jstr(m.get("against")), "")
        tail = ", X being its rating" if rated else ""
        return f"{subj} {v(subj, 'has')} the Feel No Pain {threshold}+ ability{against}{tail}"
    if t == "invulnerable-save":
        vs = (
            f" against {jstr(m['weapon_type'])} attacks" if m.get("weapon_type") is not None else ""
        )
        return f"{subj} {v(subj, 'has')} a {jstr(m.get('invuln_sv'))}+ invulnerable save{vs}"
    if t == "heal":
        return _heal(m, subj)
    if t == "return-models":
        return _return_models(e, m, subj, ctx)
    if t == "destroy-models":
        return _destroy_models(m, subj)
    if t == "act-on-death":
        return _act_on_death(e, m, subj, ctx)
    if t == "split-unit":
        return _split_unit(m, subj)
    if t == "add-unit":
        return _add_unit(m, ctx)
    if t == "destruction-rule":
        return (
            f"{subj} {v(subj, 'is')} not destroyed until {effect_subject(m.get('also'), ctx)} is "
            "also destroyed"
        )
    if t == "move":
        return _move(m, subj, ctx)
    if t == "move-modifier":
        return _move_modifier(m, subj)
    if t == "set-up":
        return _set_up(m, subj, ctx)
    if t == "marker":
        return _marker(m)
    if t == "transport-capacity":
        return transport_capacity(m)
    if t == "test":
        return _test(m, subj)
    if t == "state-change":
        if m.get("set") is False:
            return f"{subj} {v(subj, 'is')} no longer Battle-shocked"
        return f"{subj} {v(subj, 'is')} Battle-shocked"
    if t == "cp-gain":
        return cp_gain(m)
    if t == "cost-modifier":
        return cost_modifier(m, subj)
    if t == "resource-gain":
        return resource_gain(m)
    if t == "resource-spend":
        return resource_spend(m)
    if t == "resource-die":
        return resource_die(m)
    if t == "objective-sticky":
        return (
            f"objective markers {subj} {v(subj, 'controls')} remain under your control until "
            "your opponent's "
            "Level of Control over them is greater than yours at the end of a phase"
        )
    if t == "designate":
        return _designate(m, subj, ctx)
    if t == "army-rule":
        return army_rule(m, subj, ctx)
    return f"[{t if t is not None else 'unknown'}]"
