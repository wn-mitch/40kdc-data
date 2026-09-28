"""Single effects on the permission and targeting axes: what a unit is eligible to do
("eligible to shoot in a turn in which it Fell Back") and whom it may, must or cannot
target, including a redirected target. One lowercase-initial clause, no period.

Python mirror of the permission and targeting arms of ``tools/src/translate/effect-leaf.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.effect_leaf_shapes import redirect_targeting
from wh40kdc.translate.effect_quantity import moved_phrase
from wh40kdc.translate.effect_words import (
    Ctx,
    effect_subject,
    has_weapon,
    is_plural,
    jstr,
    none_of,
    or_list,
    range_phrase,
    title_case,
    v,
    weapon_noun,
)

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


def permission(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
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
    if m.get("counts_as_move") is not None:
        does, counts = ("do", "count") if it == "they" else ("does", "counts")
        s += (
            f"; if {it} {does}, {it} {counts} as having made "
            f"{moved_phrase(m['counts_as_move'])} this turn"
        )
    if m.get("consumes_shared_use") is False:
        s += (
            "; this use does not count toward that Stratagem's once-per-phase limit for other units"
        )
    return s


_TARGET_KINDS = {
    "attack": " with attacks",
    "shoot": " with ranged attacks",
    "fight": " with melee attacks",
    "charge": " with a charge",
    "stratagem": " with Stratagems",
    "ability": " with abilities",
}


def targeting(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
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
    if may == "redirect":
        return redirect_targeting(m, who, whom, ctx)
    except_ = (
        " (Core Stratagems can still target it)" if m.get("except") == "core-stratagems" else ""
    )
    return f"{who} {verb} {whom}{kind}{rng}{unless}{except_}"
