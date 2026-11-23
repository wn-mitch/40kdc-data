"""Humanize a reactive trigger: an event family, who acted (``subject``), what it was
aimed at (``object``), which one (``filter``), a spatial gate and a condition.
ASCII-only, pinned across the ports by the conformance corpus like the condition
describer.

Python mirror of ``tools/src/translate/trigger.ts``.
"""

from __future__ import annotations

import re
from typing import Any, cast

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
    step_window,
    title_case,
    unit_filter_phrase,
)
from wh40kdc.translate.condition_refs import (
    _battle_round_ord,
    _state_phrase,
    alternative_filters,
    event_relation_phrase,
    keyword_alternatives,
    named_use_phrase,
    place_ref_phrase,
    roll_word,
    unit_ref_phrase,
    used_ability_phrase,
    with_article,
)
from wh40kdc.translate.effect_words import resource_noun, weapon_noun

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

_SIMPLE_ACTOR_KEYS = frozenset(
    {
        "owner",
        "level",
        "state",
        "not_states",
        "all_of",
        "any_of",
        "none_of",
        "not_all_of",
        "any_of_filters",
    }
)


def _transport_phrase(ref: Any) -> str:
    """ "a Transport within 6\" of this model": the Transports a disembarked filter allows."""
    if isinstance(ref, dict) and len(ref) == 1 and isinstance(ref.get("within"), dict):
        within = ref["within"]
        return (
            f"a Transport within {range_phrase(within.get('range'))}"
            f" of {_object_phrase(within.get('of'))}"
        )
    return _object_phrase(ref)


def _actor(ref: Any) -> str:
    """The actor of a trigger: "this unit", "an enemy unit", "a friendly EXORCIST unit"."""
    if ref is None or ref == "this-unit":
        return "this unit"
    if ref == "this-model":
        return "this model"
    if ref == "model-in-this-unit":
        return "a model in this unit"
    # A moment nested in an attack's: the unit making that attack.
    if ref == "attacker":
        return "the attacking unit"
    if ref == "selected-unit":
        return "the selected unit"
    # A moment nested in a triggered effect: the unit that triggered it.
    if ref == "event-subject":
        return "the triggering unit"
    if ref == "event-subject-model":
        return "the triggering model"
    if isinstance(ref, (dict, list)):
        f = _obj(ref)
        # The unit an aura reaches, as the effect's aura names it (effect_aura.with_aura_recipient).
        if isinstance(f.get("aura_recipient"), str):
            return str(f["aura_recipient"])
        if isinstance(f.get("event_var"), str):
            return "that unit"
        if f.get("selection_var") is not None or f.get("stratagem_target") is not None:
            return unit_ref_phrase(f)
        if any(key not in _SIMPLE_ACTOR_KEYS for key in f):
            return unit_filter_phrase(f)
        owner = (
            "friendly "
            if f.get("owner") == "friendly"
            else "enemy "
            if f.get("owner") == "enemy"
            else ""
        )
        noun = "model" if f.get("level") == "model" else "unit"
        all_ = (
            f"{' '.join(_str(k) for k in f['all_of'])} "
            if isinstance(f.get("all_of"), list)
            else ""
        )
        compact = keyword_alternatives(f)
        any_multi = (
            f"{_or_list([_str(k) for k in f['any_of']])} "
            if not all_
            and compact is None
            and isinstance(f.get("any_of"), list)
            and len(f["any_of"]) > 1
            else ""
        )
        s = with_article(
            f"{owner}{_or_list(compact)} {noun}"
            if compact is not None
            else f"{owner}{all_}{any_multi}{noun}"
        )
        if isinstance(f.get("any_of_filters"), list) and compact is None:
            s += f" that is {_or_list([unit_filter_phrase(a) for a in alternative_filters(f)])}"
        if isinstance(f.get("any_of"), list) and not any_multi:
            s += f" with the {_or_list([_str(k) for k in f['any_of']])} keyword"
        if isinstance(f.get("none_of"), list):
            s += f" (excluding {_or_list([_str(k) for k in f['none_of']])} {noun}s)"
        if isinstance(f.get("not_all_of"), list):
            s += f" (excluding {' '.join(_str(k) for k in f['not_all_of'])} {noun}s)"
        states = ([_state_phrase(_str(f["state"]))] if f.get("state") is not None else []) + (
            [_state_phrase(_str(x), True) for x in f["not_states"]]
            if isinstance(f.get("not_states"), list)
            else []
        )
        if states:
            s += f" that is {_and_list(states)}"
        return s
    return dekebab(_str(ref))


def _stratagem_target(ref: Any) -> str:
    """The unit a used Stratagem targets: "this unit" for the holder's own role, else the object
    filter."""
    return _object_phrase(ref) if isinstance(ref, dict) else "this unit"


def _actor_keywords(ref: Any) -> str:
    """No-op helper; keyword requirements are now folded directly into `_actor`."""
    return ""


def _last_model_phrase(ref: Any) -> str:
    """The model a last-model destruction names: "GUARDIAN DEFENDER model in this unit"."""
    o = ref if isinstance(ref, dict) else {}
    if isinstance(o.get("all_of"), list):
        keywords = " ".join(o["all_of"])
    elif isinstance(o.get("any_of"), list):
        keywords = _or_list(o["any_of"])
    else:
        keywords = ""
    model = f"{keywords} model" if keywords else "model"
    if o.get("member_of") == "this-unit":
        return f"{model} in this unit"
    return f"{model} in {_object_phrase(ref)}"


def _object_phrase(ref: Any) -> str:
    """An object phrase: "this unit", "an enemy unit"."""
    if ref is None or ref == "this-unit":
        return "this unit"
    if ref == "this-model":
        return "this model"
    if ref == "model-in-this-unit":
        return "a model in this unit"
    if isinstance(ref, (dict, list)):
        return unit_ref_phrase(ref)
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
    "manoeuvre": "Agile Manoeuvre roll",
    "channelling": "Channel the Warp roll",
    "deadly-demise": "Deadly Demise roll",
    "attacks": "roll to determine the number of attacks",
}
_TEST_ROLLS = {"battle-shock", "leadership", "desperate-escape"}

_ATTACK_MODELS: dict[str, str] = {
    "this-model": "this model",
    "this-unit": "a model in this unit",
    "model-in-this-unit": "a model in this unit",
}


def _with_unmodified(t: AbilityTrigger, f: dict[str, Any], clause: str) -> str:
    """An after-roll moment narrowed to unmodified faces: ", on an unmodified 6"."""
    faces = f.get("unmodified")
    if t.get("event") != "after-roll" or not isinstance(faces, dict):
        return clause
    low, high = int(faces.get("from", 0)), int(faces.get("to", 0))
    span = f"{low}" if low == high else f"{low}+" if high == 6 else f"{low}-{high}"
    return f"{clause}, on an unmodified {span}"


def _roll_clause(t: AbilityTrigger, f: dict[str, Any]) -> str:
    # An ability's own dice ({of_ability}) read "Reanimation Protocols roll".
    roll = "" if isinstance(f.get("roll"), dict) else _str(f.get("roll"))
    noun = _ROLL_NOUN.get(roll, f"{roll_word(f.get('roll'))} roll")
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
        # A bound unit's hits: "each time an attack made by that unit scores a hit".
        if isinstance(subject, dict) and isinstance(subject.get("event_var"), str):
            return "each time an attack made by that unit scores a hit"
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
    # Whose roll it was and how it came out: "when the unit fails a Battle-shock test",
    # "after a saving throw made for this model is failed".
    article = _article(noun)
    named = subject is not None and not anyone
    if f.get("result") in ("failure", "success"):
        passed = f.get("result") == "success"
        if roll in _TEST_ROLLS:
            return f"when {_actor(subject)} {'passes' if passed else 'fails'} {article} {noun}"
        made_for = f" made for {_actor(subject)}" if named else ""
        if passed:
            return f"after a successful {noun}{made_for}"
        return f"after {article} {noun}{made_for} is failed"
    if named:
        verb = "takes" if roll in _TEST_ROLLS else "makes"
        return f"after {_actor(subject)} {verb} {article} {noun}"
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
    "army-selected": "when selecting your army",
    "battle-started": "at the start of the battle",
    "battle-formations-declared": "when declaring Battle Formations",
    "deployment-ended": "after deployment",
    "round-started": "at the start of the battle round",
    "round-ended": "at the end of the battle round",
    "turn-started": "at the start of each turn",
    "turn-ended": "at the end of the turn",
}


def _allocated_attack_type(t: AbilityTrigger) -> str | None:
    """The attack type a damage-allocated trigger's whole condition names ("each time a ranged
    attack is allocated"), which the moment's own clause then says; None for any other condition."""
    c = t.get("condition")
    if t.get("event") != "damage-allocated" or not isinstance(c, dict) or not c:
        return None
    if _truthy(c.get("operator")) or c.get("type") != "attack-is":
        return None
    params = c.get("parameters")
    params = params if isinstance(params, dict) else {}
    kind = params.get("attack_type")
    return kind if len(params) == 1 and kind in ("ranged", "melee", "psychic") else None


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
            # "selected to make a Normal move", "selected to make an Advance or Fall Back move".
            kinds = move_kinds(f["move_types"])
            move = f"{_article(kinds)} {kinds} move" if kinds else "a move"
            return f"when {who} is selected to make {move}{_selected_mode(f)}"
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
            every = " with all of its attacks" if f.get("all_attacks") is True else ""
            return f"when {who} targets {_object_phrase(obj)}{every}"
        return f"when {who} selects its targets"
    if event == "move-started":
        # "at the start of this unit's move", "just before it Consolidates": the move is about to
        # be made.
        kinds = move_kinds(f["move_types"]) if isinstance(f.get("move_types"), list) else ""
        article = f"{_article(kinds)} {kinds}" if kinds else "a"
        move = f"{article} move"
        return f"each time {who} starts {move}" if subject_obj else f"when {who} starts {move}"
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
        article = f"{_article(kinds)} {kinds}" if kinds else "a"
        move = f"{article} move{tail}"
        return f"each time {who} ends {move}" if subject_obj else f"when {who} ends {move}"
    if event == "set-up":
        return f"when {who} {_SET_UP_FROM.get(_str(f.get('from')), 'is set up')}"
    if event == "disembarked":
        transport = f.get("transport")
        if transport is None:
            source = "a Transport"
        elif transport in ("this-unit", "this-model"):
            source = "this Transport"
        else:
            source = _transport_phrase(transport)
        timing = ", after it has been set up" if f.get("timing") == "after-set-up" else ""
        return f"when {who} disembarks from {source}{timing}"
    if event in ("before-roll", "after-roll"):
        return _with_unmodified(t, f, _roll_clause(t, f))
    if event == "damage-allocated":
        kind = _allocated_attack_type(t)
        allocated = f"when a {kind} attack is allocated" if kind else "when damage is allocated"
        if obj is not None and obj != "this-unit":
            return f"{allocated} to {_object_phrase(obj)}"
        return allocated
    if event == "attacks-resolved":
        if subject_obj:
            if obj is not None:
                return f"after {who} has shot and targeted {_object_phrase(obj)}"
            verbs = {"fight": "fights", "attack": "resolves its attacks"}
            verb = verbs.get(_str(f.get("kind")), "shoots")
            return f"after {who} {verb}"
        if f.get("kind") == "fight":
            return f"after {who} resolves its attacks in a fight"
        return f"after {who} resolves its attacks"
    if event == "destroyed":
        melee = " in melee" if f.get("attack_type") == "melee" else ""
        # A subject names who destroyed the object: "each time the unit destroys an enemy unit".
        if t.get("subject") is not None:
            target = "a unit" if obj is None else _object_phrase(obj)
            return f"each time {who} destroys {target}{melee}"
        if obj is None or obj == "this-unit":
            return f"when this unit is destroyed{melee}"
        if isinstance(obj, dict) and obj.get("designated") is not None and len(obj) == 1:
            return "each time your quarry is destroyed"
        return f"{'when' if melee else 'each time'} {_object_phrase(obj)} is destroyed{melee}"
    if event == "model-destroyed":
        if f.get("timing") == "before-removal":
            return "before this model is removed from play"
        # Resolved once the units embarked within the destroyed model have disembarked.
        if f.get("timing") == "after-emergency-disembark":
            kept = {k: v for k, v in f.items() if k != "timing"}
            rest = cast(AbilityTrigger, {**t, "filter": kept})
            after = "after the units embarked within it have made their emergency disembark moves"
            return f"{_event_phrase(rest)}, {after}"
        if f.get("first") is True:
            return "the first time a model in this unit is destroyed"
        # "When the last Guardian Defender model in this unit is destroyed".
        if f.get("last") is True:
            return f"when the last {_last_model_phrase(obj)} is destroyed"
        # A subject names who destroyed the model: "each time this unit destroys an enemy
        # CHARACTER model".
        if t.get("subject") is not None:
            if obj == "this-model":
                return f"when this model is destroyed by {who}"
            if obj in ("model-in-this-unit", "this-unit") or obj is None:
                return f"when a model in this unit is destroyed by {who}"
            return f"each time {who} destroys {_object_phrase(obj)}"
        if obj == "this-model":
            return "when this model is destroyed"
        # A model of this unit dying: the object names the model's unit, never the whole
        # unit's destruction.
        if obj in ("model-in-this-unit", "this-unit") or obj is None:
            return "when a model in this unit is destroyed"
        return f"when {_object_phrase(obj)} is destroyed"
    if event == "used":
        # A rule your opponent used: the subject names only the enemy owner.
        subj = t.get("subject")
        opponent = isinstance(subj, dict) and subj.get("owner") == "enemy" and len(subj) == 1
        which = used_ability_phrase(f)
        if which is not None:
            return f"each time {'your opponent' if opponent else who} uses {which}"
        kind = f.get("kind")
        # One named rule: who used it, else you (the holder) for an ability or Stratagem.
        named = named_use_phrase(f)
        if named is not None:
            verb = "performs" if kind == "manoeuvre" else "uses"
            if kind == "stratagem" and obj is not None:
                if opponent:
                    return f"each time your opponent targets {_stratagem_target(obj)} with {named}"
                return f"when you target {_stratagem_target(obj)} with {named}"
            if opponent:
                return f"each time your opponent {verb} {named}"
            if t.get("subject") is None and kind in ("ability", "stratagem"):
                return f"when you use {named}"
            return f"each time {who} {verb} {named}"
        # "When its unit is targeted with a Stratagem": the object is the unit it is aimed at.
        if kind == "stratagem" and obj is not None:
            if opponent:
                return f"each time your opponent targets {_stratagem_target(obj)} with a Stratagem"
            return f"each time you target {_stratagem_target(obj)} with a Stratagem"
        if kind == "stratagem":
            if opponent:
                return "each time your opponent uses a Stratagem"
            return "each time you use a Stratagem"
        if opponent and kind == "ability" and f.get("id") is None:
            return "each time your opponent uses an ability"
        if kind == "ritual" and f.get("result") == "success":
            return f"each time {who} manifests a Ritual"
        if kind == "act-of-faith":
            if f.get("result") == "success":
                return "after an Act of Faith is completed"
            return "when an Act of Faith is performed"
        # "after the bearer issues an Order to a SQUADRON unit": who issued it, and to which unit.
        if kind == "order" and isinstance(obj, dict):
            return f"each time {who} issues an Order to {_object_phrase(obj)}"
        if kind == "order" and obj is not None:
            return "each time an Order is issued to the unit"
        if kind == "contract" and f.get("result") == "success":
            return "each time you complete a Contract"
        return f"each time {who} {_USED.get(_str(kind), f'uses {dekebab(_str(kind))}')}"
    if event == "state-changed":
        # "Caused an enemy unit that was not Below Half-strength to become Below Half-strength".
        if f.get("by") is not None and f.get("strength") is not None:
            by = "this unit" if f["by"] == "this-unit" else unit_ref_phrase(f["by"])
            change = (
                "become Below Half-strength"
                if f["strength"] == "below-half"
                else "fall below its Starting Strength"
            )
            return f"when {by} causes {who} to {change}"
        if f.get("strength") == "below-half":
            return f"when {who} becomes Below Half-strength"
        if f.get("strength") == "below-starting":
            return f"when {who} falls below its Starting Strength"
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
        if pool in ("cp", "command-point"):
            subject = t.get("subject")
            enemy = isinstance(subject, dict) and subject.get("owner") == "enemy"
            via = " as the result of an ability" if f.get("via") == "ability" else ""
            return f"each time {'your opponent gains' if enemy else 'you gain'} a CP{via}"
        return f"each time {dekebab(_str(pool))} is gained"
    if event == "resource-spent":
        pool = f.get("pool")
        if pool == "flux":
            return "each time a Flux token is spent"
        if pool == "yield-points":
            return "each time you spend Yield points"
        # "When you spend 1 Pain token to Empower that friendly unit": the unit the spend Empowers.
        if f.get("tag") == "empowered":
            obj = t.get("object")
            target = _object_phrase(obj) if obj is not None else "a unit"
            return f"each time you spend {resource_noun(pool, None)} to Empower {target}"
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
        if _obj(c.get("parameters")).get("step") is not None:
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
    # A step narrows the phase ("during the Reinforcements step of your opponent's Movement
    # phase"); it is no phase boundary.
    step = bool(phases) and _obj(phases[0].get("parameters")).get("step") is not None
    if step:
        window = step_window(_obj(phases[0].get("parameters")), owner or "the")
    elif phases and isinstance(phase, str):
        window = f"during {owner or 'the'} {_cap_word(phase)} phase"
    else:
        window = f"in {owner} turn"
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
    if phases and not step:
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


def _destroy_attack_phrase(t: AbilityTrigger, f: dict[str, Any]) -> str:
    """The canonical weapons scope on a destruction filter."""
    if t.get("event") not in ("destroyed", "model-destroyed"):
        return ""
    weapons = f.get("weapons")
    if isinstance(weapons, dict):
        name = weapons.get("name")
        if _truthy(name):
            return f" with a {_str(name)} attack"
        keyword = weapons.get("keyword")
        if isinstance(keyword, dict):
            keyword = keyword.get("keyword_id")
        if _truthy(keyword):
            return f" with a [{_str(keyword).upper()}] weapon"
    if t.get("event") == "model-destroyed" and _truthy(f.get("attack_type")):
        if f["attack_type"] == "melee":
            return " in melee"
        return f" with a {_str(f['attack_type'])} attack"
    return ""


def _round_boundary(t: AbilityTrigger) -> str | None:
    """'At the start of the first battle round': a round boundary narrowed to one battle round."""
    event = t.get("event")
    if event not in ("round-started", "round-ended"):
        return None
    c = t.get("condition")
    if not isinstance(c, dict) or _truthy(c.get("operator")) or c.get("type") != "battle-round":
        return None
    p = _obj(c.get("parameters"))
    if p.get("min") is not None and p.get("max") is not None and int(p["min"]) == int(p["max"]):
        edge = "start" if event == "round-started" else "end"
        return f"at the {edge} of the {_battle_round_ord(int(p['min']))} battle round"
    return None


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
    boundary = (_phase_boundary(t) or _turn_boundary(t) or _round_boundary(t)) if plain else None
    if boundary:
        return f"{boundary}, you can use this ability" if _truthy(t.get("optional")) else boundary
    edge = "start" if event == "phase-started" else "end" if event == "phase-ended" else None
    condition = t.get("condition")
    disembark_shock = event == "phase-ended" and _disembark_battle_shock(condition)
    split = (
        phase_window(condition)
        if _truthy(condition)
        and isinstance(condition, dict)
        and not disembark_shock
        and _allocated_attack_type(t) is None
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
    s += _destroy_attack_phrase(t, f)
    # A moment's weapons ("a roll to determine the number of attacks made with a flamer"); a
    # destruction names its own.
    if (
        f.get("weapons") is not None
        and event not in ("destroyed", "model-destroyed")
        and f.get("by") is None
    ):
        s += f" with {weapon_noun({'weapons': f['weapons']})}"
    if f.get("by") is not None and not (event == "state-changed" and f.get("strength") is not None):
        source = "this model" if f["by"] == "this-model" else "this unit"
        atype = (
            f"{_str(f['attack_type'])} "
            if _truthy(f.get("attack_type")) and event != "destroyed"
            else ""
        )
        weapons = f.get("weapons")
        keyword = weapons.get("keyword") if isinstance(weapons, dict) else None
        if isinstance(keyword, dict):
            keyword = keyword.get("keyword_id")
        weapon = f" with [{_str(keyword).upper()}] weapons" if _truthy(keyword) else ""
        s += f" by {atype}attacks made by {source}{weapon}" if atype or weapon else f" by {source}"
    s += event_relation_phrase(f)
    if f.get("phase") is not None:
        s += f" in the {_cap_word(_str(f['phase']))} phase"
    # A destruction resolved once its attacker is done.
    if f.get("timing") == "after-attacks":
        s += ", after the attacking unit has resolved its attacks"
    # "Just after … is destroyed, before making its Deadly Demise roll".
    if f.get("timing") == "before-deadly-demise":
        s += ", before its Deadly Demise roll is made"
    # "Ends a move within 8 inches of your markers, before removing those markers".
    if f.get("timing") == "before-marker-removal":
        s += ", before those markers are removed"
    prox = t.get("proximity")
    if isinstance(prox, dict) and prox.get("range") is not None:
        of = (
            "this unit"
            if prox.get("of") is None or prox.get("of") == "this-unit"
            else place_ref_phrase(prox["of"])
        )
        s += f" within {range_phrase(prox['range'])} of {of}"
    if disembark_shock:
        s += ", if this unit disembarked from a Transport this turn and is Battle-shocked"
    elif split is not None:
        if edge and not _truthy(split.get("phase")) and _truthy(split.get("owner")):
            s += f" in {split['owner']} turn"
        elif not edge and split["window"]:
            s += f" {split['window']}"
        if _truthy(split["rest"]):
            s += f", if {describe_condition(split['rest'])}"
    if _truthy(t.get("optional")):
        s += ", you can use this ability"
    return s


def _selected_mode(f: dict[str, Any]) -> str:
    """' using the Tactical Disembarkation rules': the named mode of the move a unit is selected to
    make."""
    if f.get("mode") is None:
        return ""
    mode = title_case(_str(f["mode"]))
    named = f"{mode} Disembarkation" if "disembark" in f["move_types"] else mode
    return f" using the {named} rules"
