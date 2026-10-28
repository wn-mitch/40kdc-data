"""Single effects on the permission and targeting axes: what a unit is eligible to do
("eligible to shoot in a turn in which it Fell Back") and whom it may, must or cannot
target, including a redirected target. One lowercase-initial clause, no period.

Python mirror of the permission and targeting arms of ``tools/src/translate/effect-leaf.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition import describe_condition
from wh40kdc.translate.effect_leaf_shapes import redirect_targeting
from wh40kdc.translate.effect_quantity import moved_phrase
from wh40kdc.translate.effect_words import (
    Ctx,
    ability_label,
    effect_subject,
    has_weapon,
    is_plural,
    jstr,
    none_of,
    or_list,
    range_phrase,
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
    "normal": "made a Normal move",
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
    "destroyed": "has just been destroyed",
}
_IS_STATE = frozenset({"engaged", "battle-shocked", "performing-action"})
_AS_IF = {
    "shooting-phase": " as if it were your Shooting phase",
    "fight-phase": " as if it were the Fight phase",
    "snap-shooting": " using the Snap Shooting rules",
    "movement-phase": " as if it were your Movement phase",
    "charge-phase": " as if it were your Charge phase",
    "command-phase": " as if it were your Command phase",
}


def _permission_weapons(m: dict[str, Any], plural: bool) -> str:
    """The weapons a shoot permission allows, any one of them.

    " with its sentry flamer or sentry grenade launcher": bare names read as the model's own
    weapons; any other filter reads as a weapon noun.
    """
    scopes = m.get("weapons")
    if not isinstance(scopes, list):
        return ""
    if all(
        isinstance(sc, dict) and list(sc) == ["name"] and isinstance(sc["name"], str)
        for sc in scopes
    ):
        own = "their" if plural else "its"
        return f" with {own} {or_list([jstr(sc['name']) for sc in scopes])}"
    return f" with {or_list([weapon_noun({'weapons': sc}) for sc in scopes])}"


def _permission_consequences(m: dict[str, Any], it: str) -> str:
    """ "; if it does, it counts as having made a Normal move that phase, and cannot declare a
    charge this turn": what using the permission does to its subject (counts_as_move, its
    counts_as_until window, and the activities then_cannot forbids for the rest of the turn)."""
    they = it == "they"
    lead = f"; if {it} {'do' if they else 'does'}, {it}"
    cannot = None
    if isinstance(m.get("then_cannot"), list):
        acts = [_ACTIVITIES.get(jstr(a), jstr(a)) for a in m["then_cannot"]]
        cannot = f"cannot {or_list(acts)} this turn"
    if m.get("counts_as_move") is not None:
        period = "that phase" if m.get("counts_as_until") == "end-of-phase" else "this turn"
        tail = f", and {cannot}" if cannot else ""
        return (
            f"{lead} {'count' if they else 'counts'} as having made "
            f"{moved_phrase(m['counts_as_move'])} {period}{tail}"
        )
    return f"{lead} {cannot}" if cannot else ""


def permission(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    it = "they" if subj.startswith("all ") or re.search(r" units\b", subj) else "it"
    activity = m.get("activity")
    if activity == "use-stratagem" and m.get("stratagem") is not None:
        act = f"be targeted with the {ability_label(m['stratagem'])} Stratagem"
    else:
        act = _ACTIVITIES.get(jstr(activity), jstr(activity))
    into = ""
    if m.get("into") is not None:
        prep = (
            "at" if activity == "shoot" else "against" if activity == "declare-charge" else "into"
        )
        into = f" {prep} {none_of(effect_subject(m['into'], ctx))}"
    reach = f" from up to {range_phrase(m['reach'])} away" if m.get("reach") is not None else ""
    weapons = _permission_weapons(m, is_plural(subj))
    if m.get("allow") is False:
        s = f"{none_of(subj)} cannot {act}{weapons}{into}"
    else:
        s = f"{subj} {v(subj, 'is')} eligible to {act}{weapons}{into}{reach}"
    if isinstance(m.get("after"), list):
        s += (
            f" in a turn in which {it} "
            f"{or_list([_AFTER.get(jstr(a), jstr(a)) for a in m['after']])}"
        )
    if isinstance(m.get("despite"), list):
        clauses = []
        for d in m["despite"]:
            phrase = _DESPITE.get(jstr(d), jstr(d))
            if jstr(d) == "transport-advanced":
                # The Transport the subject disembarks from Advanced, not the subject.
                clauses.append(f"{'their' if it == 'they' else 'its'} Transport Advanced this turn")
            elif jstr(d) in _IS_STATE:
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
    s += _permission_consequences(m, it)
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
    # "That unit cannot be selected by the Noospheric Transference ability": one named ability's
    # selection, by no named unit.
    if (
        m.get("kind") == "ability"
        and m.get("ability") is not None
        and m.get("by") is None
        and may != "redirect"
    ):
        modal = "cannot" if may == "cannot-target" else "must" if may == "must-target" else "can"
        return f"{whom} {modal} be selected by the {ability_label(m['ability'])} ability"
    verb = (
        "cannot target"
        if may == "cannot-target"
        else "must target"
        if may == "must-target"
        else "can target"
    )
    if m.get("kind") == "stratagem" and m.get("stratagem") is not None:
        kind = f" with the {ability_label(m['stratagem'])} Stratagem"
    elif m.get("kind") == "ability" and m.get("ability") is not None:
        kind = f" with the {ability_label(m['ability'])} ability"
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
    # "cannot target enemy units … if the target unit was engaged with this unit at the start of
    # the turn".
    if m.get("target_condition") is not None:
        condition = describe_condition(_as_target_candidate(m["target_condition"]))
        target = whom[len("all ") :] if whom.startswith("all ") else whom
        return f"{who} {verb} {target}{kind}{rng}{unless}{except_} if {condition}"
    return f"{who} {verb} {whom}{kind}{rng}{unless}{except_}"


def _as_target_candidate(node: Any) -> Any:
    """A target_condition's this-unit is the unit checked as a target: it reads as the target unit
    (defender)."""
    if node == "this-unit":
        return "defender"
    if isinstance(node, list):
        return [_as_target_candidate(item) for item in node]
    if isinstance(node, dict):
        return {key: _as_target_candidate(value) for key, value in node.items()}
    return node
