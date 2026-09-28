"""Humanize a reactive trigger: an event family, who acted (``subject``), what it was
aimed at (``object``), which one (``filter``), a spatial gate and a condition.
ASCII-only, pinned across the ports by the conformance corpus like the condition
describer.

Python mirror of ``tools/src/translate/trigger.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition import (
    Condition,
    _and_list,
    _cap_word,
    _obj,
    _or_list,
    _str,
    _truthy,
    dekebab,
    describe_condition,
    move_kinds,
    range_phrase,
    title_case,
    unit_filter_phrase,
)

AbilityTrigger = dict[str, Any]

_MISSING: Any = object()


def normalize_triggers(t: Any) -> list[AbilityTrigger]:
    """Normalize the polymorphic trigger field to a flat list (empty when absent)."""
    if t is None:
        return []
    return list(t) if isinstance(t, list) else [t]


def _typeof_object(t: AbilityTrigger, key: str) -> bool:
    """JS ``typeof t[key] === "object"``: true for a record, an array, or an explicit null."""
    if key not in t:
        return False
    v = t[key]
    return v is None or isinstance(v, (dict, list))


def _article(s: str) -> str:
    return "an" if s[:1].lower() in ("a", "e", "i", "o", "u") and s[:1] != "" else "a"


# Whose turn, as a trigger window names it.
_TURN_OWNERS: dict[str, str] = {"your-turn": "your", "opponent-turn": "your opponent's"}


def _actor(ref: Any) -> str:
    """The actor of a trigger: "the unit", "an enemy unit", "this model"."""
    if ref is None or ref == "this-unit":
        return "the unit"
    if ref == "this-model":
        return "this model"
    if ref == "model-in-this-unit":
        return "a model in this unit"
    if isinstance(ref, (dict, list)):
        f = _obj(ref)
        if isinstance(f.get("event_var"), str):
            return "that unit"
        # Keywords on the actor read as a trailing requirement, as the event names them.
        owner = (
            "a friendly"
            if f.get("owner") == "friendly"
            else "an enemy"
            if f.get("owner") == "enemy"
            else "a"
        )
        return f"{owner} {'model' if f.get('level') == 'model' else 'unit'}"
    return dekebab(_str(ref))


def _actor_keywords(ref: Any) -> str:
    """Keyword requirements on a filter actor: " (the triggering unit must have A and B)"."""
    if not isinstance(ref, dict):
        return ""
    noun = "model" if ref.get("level") == "model" else "unit"
    s = ""
    if isinstance(ref.get("all_of"), list):
        s += f" (the triggering {noun} must have {_and_list([_str(k) for k in ref['all_of']])})"
    if isinstance(ref.get("none_of"), list):
        s += f" (the triggering {noun} must not have {_or_list([_str(k) for k in ref['none_of']])})"
    return s


def _object_phrase(ref: Any) -> str:
    """An object phrase: "this unit", "an enemy unit"."""
    if ref is None or ref == "this-unit":
        return "this unit"
    if ref == "this-model":
        return "this model"
    if ref == "model-in-this-unit":
        return "a model in this unit"
    if isinstance(ref, (dict, list)):
        return unit_filter_phrase(ref)
    return dekebab(_str(ref))


_ROLL_NOUN: dict[str, str] = {
    "hit": "Hit roll",
    "wound": "Wound roll",
    "save": "saving throw",
    "damage": "Damage roll",
    "charge": "Charge roll",
    "advance": "Advance roll",
    "battle-shock": "Battle-shock test",
    "leadership": "Leadership test",
    "hazard": "Hazard roll",
    "psychic": "Psychic test",
    "desperate-escape": "Desperate Escape test",
    "dark-pact": "Dark Pact Leadership test",
    "blessings-of-khorne": "Blessings of Khorne roll",
}
_TEST_ROLLS = {"battle-shock", "leadership", "desperate-escape"}

_ATTACK_MODELS: dict[str, str] = {
    "this-model": "this model",
    "this-unit": "a model in this unit",
    "model-in-this-unit": "a model in this unit",
}


def _roll_clause(t: AbilityTrigger, f: dict[str, Any]) -> str:
    roll = _str(f.get("roll"))
    noun = _ROLL_NOUN.get(roll, f"{dekebab(roll)} roll")
    subject = t.get("subject")
    anyone = isinstance(subject, dict) and subject.get("owner") == "any" and len(subject) == 1
    subject_key = _str(subject if subject is not None else "this-unit")
    if t.get("event") == "before-roll":
        if roll in _TEST_ROLLS and not anyone:
            return f"when {_actor(subject)} takes a {noun}"
        by: str | None = None
        if not anyone and roll in ("hit", "wound", "damage"):
            by = (
                _ATTACK_MODELS.get(subject_key)
                if isinstance(subject, str) or subject is None
                else None
            )
            if by is None and _typeof_object(t, "subject"):
                by = f"a model in {_actor(subject)}"
        suffix = f" for an attack made by {by}" if by else ""
        return f"before {_article(noun)} {noun} is made{suffix}"
    if f.get("result") == "success" and roll == "hit":
        return "after scoring a hit"
    if f.get("result") == "success" and roll == "wound":
        if anyone:
            made = ""
        else:
            model = (
                _ATTACK_MODELS.get(subject_key)
                if isinstance(subject, str) or subject is None
                else None
            )
            made = f" made by {model if model is not None else f'a model in {_actor(subject)}'}"
        return f"each time an attack{made} scores a wound"
    if f.get("result") == "success" and roll == "dark-pact":
        return "each time the unit makes a Dark Pact and passes its Leadership test"
    if roll == "psychic":
        return "after a Psychic test is taken"
    if roll == "blessings-of-khorne":
        return "each time you make a Blessings of Khorne roll"
    return f"after {_article(noun)} {noun} is made"


_USED: dict[str, str] = {
    "dark-pact": "makes a Dark Pact",
    "act-of-faith": "performs an Act of Faith",
    "manoeuvre": "performs an Agile Manoeuvre",
    "ritual": "attempts a Ritual",
    "order": "issues an Order",
    "doctrine": "selects a Combat Doctrine",
    "contract": "invokes its contract",
}

_SET_UP_FROM: dict[str, str] = {
    "deep-strike": "is set up by Deep Strike",
    "strategic-reserves": "arrives from Strategic Reserves",
    "cult-ambush": "is set up using Cult Ambush",
    "transport": "is set up from a Transport",
}

_FIXED_EVENTS: dict[str, str] = {
    "battle-started": "at the start of the battle",
    "battle-formations-declared": "when declaring Battle Formations",
    "deployment-ended": "after deployment",
    "round-started": "at the start of the battle round",
    "round-ended": "at the end of the battle round",
    "turn-started": "at the start of the turn",
    "turn-ended": "at the end of the turn",
}


def _event_phrase(t: AbilityTrigger) -> str:
    """The event family's own clause, before proximity, condition and options."""
    f = _obj(t.get("filter"))
    who = _actor(t.get("subject"))
    event = t.get("event")
    obj = t.get("object")
    subject_obj = _typeof_object(t, "subject")
    if isinstance(event, str) and event in _FIXED_EVENTS:
        return _FIXED_EVENTS[event]
    if event == "step-started":
        return f"at the start of the {title_case(_str(f.get('step')))} step"
    if event == "selected":
        to = f.get("to")
        if to is None:
            return f"when {who} is selected"
        if to == "observe":
            return f"each time {who} is selected as an Observer unit"
        if to == "move" and isinstance(f.get("move_types"), list):
            return f"when {who} is selected to {move_kinds(f['move_types'])}"
        verb = "shoot or fight" if to == "attack" else dekebab(_str(to))
        return f"when {who} is selected to {verb}"
    if event == "targets-selected":
        kind = f.get("kind")
        if kind == "stratagem":
            target = (
                "this model's unit"
                if obj is None or obj in ("this-unit", "this-model")
                else _object_phrase(obj)
            )
            return f"when {target} is targeted with a Stratagem"
        source = t.get("source_ability")
        if kind == "ability" and _truthy(source):
            s = _obj(source)
            keywords = " ".join(_str(k) for k in (s.get("keywords") or []))
            phrase = (
                f"when {_actor(t.get('subject'))} is selected by the "
                f"{title_case(_str(s.get('ability_id')))} ability of a {_str(s.get('owner'))} "
                f"{keywords} unit"
            )
            return re.sub(r"\s+unit$", " unit", phrase, count=1)
        if kind == "charge":
            if obj is not None:
                return f"when {who} selects {_object_phrase(obj)} as a charge target"
            if subject_obj:
                return (
                    f"after {who} selects targets for its charge but before it makes a Charge move"
                )
            return "when a Charge is declared"
        if obj is not None:
            return f"when {who} targets {_object_phrase(obj)}"
        return f"when {who} selects its targets"
    if event == "move-ended":
        if f.get("through") == "tall-terrain":
            return f'when {who} moves through terrain over 4" tall'
        if f.get("through") == "terrain":
            return f"when {who} moves through terrain"
        kinds = move_kinds(f["move_types"]) if isinstance(f.get("move_types"), list) else ""
        # Another unit's move is a reaction window: "each time an enemy unit ends a move".
        if subject_obj and kinds == "Fall Back" and obj is None:
            return f"each time {who} Falls Back"
        tail = f" from {_object_phrase(obj)}" if obj is not None else ""
        move = f"{f'{_article(kinds)} {kinds}' if kinds else 'a'} move{tail}"
        return f"each time {who} ends {move}" if subject_obj else f"when {who} ends {move}"
    if event == "set-up":
        return f"when {who} {_SET_UP_FROM.get(_str(f.get('from')), 'is set up')}"
    if event == "disembarked":
        return f"when {who} disembarks from a Transport"
    if event in ("before-roll", "after-roll"):
        return _roll_clause(t, f)
    if event == "damage-allocated":
        if obj is not None and obj != "this-unit":
            return f"when damage is allocated to {_object_phrase(obj)}"
        return "when damage is allocated"
    if event == "attacks-resolved":
        if subject_obj:
            if obj is not None:
                return f"after {who} has shot and targeted {_object_phrase(obj)}"
            return f"after {who} {'fights' if f.get('kind') == 'fight' else 'shoots'}"
        return f"after {who} resolves its attacks"
    if event == "destroyed":
        melee = " in melee" if f.get("attack_type") == "melee" else ""
        if obj is None or obj == "this-unit":
            return f"when the unit is destroyed{melee}"
        if isinstance(obj, dict) and obj.get("designated") is not None and len(obj) == 1:
            return "each time your quarry is destroyed"
        return f"{'when' if melee else 'each time'} {_object_phrase(obj)} is destroyed{melee}"
    if event == "model-destroyed":
        if f.get("timing") == "before-removal":
            return "before this model is removed from play"
        if f.get("first") is True:
            return "the first time a model in the unit is destroyed"
        if obj == "this-model":
            return "when this model is destroyed"
        # A model of this unit dying: the object names the model's unit, never the whole
        # unit's destruction.
        if obj in ("model-in-this-unit", "this-unit") or obj is None:
            return "when a model in the unit is destroyed"
        return f"when {_object_phrase(obj)} is destroyed"
    if event == "used":
        kind = f.get("kind")
        if kind == "stratagem":
            return "each time you use a Stratagem"
        if kind == "ability" and f.get("id") is not None:
            return f"when you use {title_case(_str(f['id']))}"
        if kind == "ritual" and f.get("result") == "success":
            return f"each time {who} manifests a Ritual"
        if kind == "act-of-faith":
            if f.get("result") == "success":
                return "after an Act of Faith is completed"
            return "when an Act of Faith is performed"
        if kind == "order" and obj is not None:
            return "each time an Order is issued to the unit"
        if kind == "contract" and f.get("result") == "success":
            return "each time you complete a Contract"
        return f"each time {who} {_USED.get(_str(kind), f'uses {dekebab(_str(kind))}')}"
    if event == "state-changed":
        return f"when {who} becomes {_cap_word(_str(f.get('state')))}"
    if event == "designation-changed":
        if f.get("tag") == "EMPOWERED":
            return f"each time {who} is Empowered"
        return f"each time {who} becomes {_str(f.get('tag'))}"
    if event == "designation-resolved":
        if f.get("tag") == "OATH OF MOMENT TARGET":
            return "when you fulfil an Oath"
        return f"when a {_str(f.get('tag'))} designation is resolved"
    if event == "marker-removed":
        return f"each time one of your {title_case(_str(f.get('marker')))} markers is removed"
    if event == "objective-gained":
        return "when you gain control of an objective"
    if event == "resource-gained":
        pool = f.get("pool")
        if pool == "miracle-dice":
            return "when a Miracle die is generated"
        if pool == "cp":
            subject = t.get("subject")
            enemy = isinstance(subject, dict) and subject.get("owner") == "enemy"
            return f"each time {'your opponent gains' if enemy else 'you gain'} a CP"
        return f"each time {dekebab(_str(pool))} is gained"
    if event == "resource-spent":
        pool = f.get("pool")
        if pool == "flux":
            return "each time a Flux token is spent"
        if pool == "yield-points":
            return "each time you spend Yield points"
        return f"each time {dekebab(_str(pool))} is spent"
    return f"when {dekebab(_str(event))}"


def _condition_operands(condition: Any) -> list[Condition]:
    if not _truthy(condition):
        return []
    c = _obj(condition)
    if c.get("operator") == "and":
        return list(c.get("operands") or [])
    return [c]


def _param(operands: list[Condition], ctype: str, key: str) -> Any:
    """``operands.find(type)?.parameters?.[key]`` with ``_MISSING`` for undefined."""
    for c in operands:
        if c.get("type") == ctype:
            params = c.get("parameters")
            return params.get(key, _MISSING) if isinstance(params, dict) else _MISSING
    return _MISSING


def _phase_boundary(t: AbilityTrigger) -> str | None:
    """ "At the start of your Command phase": a phase boundary narrowed only by phase and
    whose turn."""
    event = t.get("event")
    if event not in ("phase-started", "phase-ended"):
        return None
    operands = _condition_operands(t.get("condition"))
    for c in operands:
        if _truthy(c.get("operator")) or c.get("type") not in ("phase-is", "player-turn-is"):
            return None
    phase = _param(operands, "phase-is", "phase")
    turn = _param(operands, "player-turn-is", "turn")
    if not isinstance(phase, str) or len(operands) != (1 if turn is _MISSING else 2):
        return None
    if turn is not _MISSING and _str(turn) not in _TURN_OWNERS:
        return None
    owner = "the" if turn is _MISSING else _TURN_OWNERS[_str(turn)]
    edge = "start" if event == "phase-started" else "end"
    return f"at the {edge} of {owner} {_cap_word(phase)} phase"


def _turn_boundary(t: AbilityTrigger) -> str | None:
    """ "At the start of your turn": a turn boundary narrowed only by whose turn."""
    event = t.get("event")
    if event not in ("turn-started", "turn-ended"):
        return None
    c = t.get("condition")
    if not _truthy(c) or not isinstance(c, dict) or c.get("type") != "player-turn-is":
        return None
    owner = _TURN_OWNERS.get(_str(_obj(c.get("parameters")).get("turn")))
    if not owner:
        return None
    return f"at the {'start' if event == 'turn-started' else 'end'} of {owner} turn"


def phase_window(condition: Condition) -> dict[str, Any]:
    """A trigger condition's phase and whose turn, as a phrase on the moment ("during your
    Shooting phase", "in your opponent's turn"), and whatever else the condition says. Only a
    plain phase-is and player-turn-is (at most one each, joined by "and") make a window.
    Returns ``{"window", "rest"}`` plus ``"phase"``/``"owner"`` when present."""
    if condition.get("operator") == "and":
        operands = list(condition.get("operands") or [])
    elif _truthy(condition.get("operator")):
        operands = []
    else:
        operands = [condition]
    phases = [c for c in operands if c.get("type") == "phase-is"]
    turns = [c for c in operands if c.get("type") == "player-turn-is"]
    owner = _TURN_OWNERS.get(_str(_obj(turns[0].get("parameters")).get("turn"))) if turns else None
    phase = _obj(phases[0].get("parameters")).get("phase") if phases else None
    if (
        len(phases) > 1
        or len(turns) > 1
        or (len(turns) == 1 and not owner)
        or (len(phases) == 1 and not isinstance(phase, str))
        or len(phases) + len(turns) == 0
    ):
        return {"window": "", "rest": condition}
    window = (
        f"during {owner or 'the'} {_cap_word(phase)} phase"
        if phases and isinstance(phase, str)
        else f"in {owner} turn"
    )
    others = [
        c for c in operands if not any(c is x for x in phases) and not any(c is x for x in turns)
    ]
    rest: Condition | None
    if not others:
        rest = None
    elif len(others) == 1:
        rest = others[0]
    else:
        rest = {"operator": "and", "operands": others}
    out: dict[str, Any] = {"window": window, "rest": rest}
    if phases:
        out["phase"] = phase
    if owner:
        out["owner"] = owner
    return out


def _disembark_battle_shock(c: Any) -> bool:
    """``phase-ended`` with "disembarked this turn and battle-shocked": the one boundary that
    reads as an if."""
    if not isinstance(c, dict) or c.get("operator") != "and":
        return False
    operands = c.get("operands")
    if not isinstance(operands, list) or len(operands) != 2:
        return False
    first, second = _obj(operands[0]), _obj(operands[1])
    return (
        first.get("type") == "happened"
        and _obj(first.get("parameters")).get("event") == "disembarked"
        and second.get("type") == "unit-state"
        and _obj(second.get("parameters")).get("state") == "battle-shocked"
    )


def describe_trigger(t: AbilityTrigger) -> str:
    """Reactive trigger -> front-of-sentence lead clause ("an enemy unit ends a move within
    9\\" of this model")."""
    event = t.get("event")
    clock = event in ("phase-started", "phase-ended")
    subject = t.get("subject")
    plain = (
        not _truthy(t.get("proximity"))
        and not _truthy(t.get("binds_die_variable"))
        and not _truthy(t.get("binds_selected_die_variable"))
        and (subject is None or subject == "this-unit")
    )
    boundary = (_phase_boundary(t) or _turn_boundary(t)) if plain else None
    if boundary:
        return f"{boundary}, you may use this ability" if _truthy(t.get("optional")) else boundary
    edge = "start" if event == "phase-started" else "end" if event == "phase-ended" else None
    condition = t.get("condition")
    disembark_shock = event == "phase-ended" and _disembark_battle_shock(condition)
    split = (
        phase_window(condition)
        if _truthy(condition) and isinstance(condition, dict) and not disembark_shock
        else None
    )
    if not clock:
        s = _event_phrase(t)
    elif split is not None and _truthy(split.get("phase")):
        s = f"at the {edge} of {split.get('owner') or 'the'} {_cap_word(split['phase'])} phase"
    else:
        s = f"at the {edge} of each phase"
    s += _actor_keywords(subject)
    f = _obj(t.get("filter"))
    if f.get("by") is not None:
        source = "this model" if f["by"] == "this-model" else "this unit"
        atype = (
            f"{_str(f['attack_type'])} "
            if _truthy(f.get("attack_type")) and event != "destroyed"
            else ""
        )
        weapon = (
            f" with [{_str(f['weapon_keyword']).upper()}] weapons"
            if _truthy(f.get("weapon_keyword"))
            else ""
        )
        s += f" by {atype}attacks made by {source}{weapon}" if atype or weapon else f" by {source}"
    prox = t.get("proximity")
    if isinstance(prox, dict) and prox.get("range") is not None:
        of = "this model" if prox.get("of") == "this-model" else "this unit"
        s += f" within {range_phrase(prox['range'])} of {of}"
    if disembark_shock:
        s += ", if the unit disembarked from a Transport this turn and is Battle-shocked"
    elif split is not None:
        if edge and not _truthy(split.get("phase")) and _truthy(split.get("owner")):
            s += f" in {split['owner']} turn"
        elif not edge and split["window"]:
            s += f" {split['window']}"
        if _truthy(split["rest"]):
            s += f", if {describe_condition(split['rest'])}"
    if _truthy(t.get("binds_die_variable")):
        binding = _str(t["binds_die_variable"]).replace("_", "-")
        s += f" (binding the generated die as {dekebab(binding)})"
    if _truthy(t.get("binds_selected_die_variable")):
        binding = _str(t["binds_selected_die_variable"]).replace("_", "-")
        s += f" (binding one chosen die used in that Act of Faith as {dekebab(binding)})"
    if _truthy(t.get("optional")):
        s += ", you may use this ability"
    return s
