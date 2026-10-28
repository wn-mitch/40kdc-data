"""The ``happened`` history predicate renderer ("the unit charged this turn",
"2+ enemy units destroyed this phase"). Python mirror of
``tools/src/translate/condition-history.ts``.
"""

from __future__ import annotations

import re

from wh40kdc.translate.condition_refs import (
    _MOVE_VERBS,
    P,
    _designation_phrase,
    _is_num,
    _list,
    _obj,
    _objective_phrase,
    _past_of,
    _str,
    _subject_of,
    _truthy,
    _window_phrase,
    count_phrase,
    dekebab,
    event_relation_phrase,
    id_label,
    move_kinds,
    named_use_phrase,
    place_ref_phrase,
    range_phrase,
    roll_word,
    title_case,
    unit_filter_phrase,
    unit_ref_phrase,
    used_ability_phrase,
)
from wh40kdc.translate.condition_refs import _window_phrase as _base_window_phrase
from wh40kdc.translate.effect_words import weapon_noun

# A rule of one kind being used now, when the filter names none.
_IN_PROGRESS: dict[str, str] = {
    "ability": "an ability",
    "stratagem": "a Stratagem",
    "manoeuvre": "an Agile Manoeuvre",
    "action": "an action",
    "order": "an Order",
    "ritual": "a Ritual",
    "dark-pact": "a Dark Pact",
    "act-of-faith": "an Act of Faith",
    "doctrine": "a Combat Doctrine",
    "contract": "a contract",
}


def _describe_happened_core(p: P, negated: bool) -> str:
    neg = "not " if negated else ""
    f = _obj(p.get("filter"))
    event = _str(p.get("event"))
    bounds = _obj(p.get("count"))
    n = bounds.get("min", 1)
    window = p.get("window")
    who = _subject_of(p)
    # The phase the event happened in leads its window: "in the Fight phase this battle".
    in_phase = f"in the {title_case(_str(f['phase']))} phase" if f.get("phase") is not None else ""

    def _window_phrase(w: object) -> str:
        return " ".join(part for part in (in_phase, _base_window_phrase(w)) if part != "")

    def _with_window(text: str, w: object) -> str:
        phrase = _window_phrase(w)
        return f"{text} {phrase}" if phrase else text

    def did_not(verb: str) -> str:
        return f"did not {verb}" if negated else _past_of(verb)

    if event == "move-ended":
        types = _list(f.get("move_types"))
        if len(types) == 1 and _MOVE_VERBS.get(types[0]):
            done = did_not(_MOVE_VERBS[types[0]])
        else:
            done = did_not(f"make a {move_kinds(types)} move" if types else "move")
        return _with_window(f"{who} {done}", window)
    if event == "selected":
        to = _str(f.get("to"))
        has = "has not" if negated else "has"
        if to == "fight":
            return _with_window(f"{who} {has} fought", window)
        verb = "shoot or fight" if to == "attack" else dekebab(to)
        return _with_window(f"{who} {has} been selected to {verb}", window)
    if event == "set-up":
        source = {
            "deep-strike": " using Deep Strike",
            "strategic-reserves": " from Strategic Reserves",
            "cult-ambush": " from Cult Ambush",
            "transport": " from a Transport",
        }.get(_str(f.get("from")), "")
        return _with_window(f"{who} {'was not' if negated else 'was'} set up{source}", window)
    if event == "targets-selected":
        has = "has not" if negated else "has"
        # A named Stratagem's targeting (compile-opponent-stratagem.ts): the unit targeted, by name.
        if _str(f.get("kind")) == "stratagem" and f.get("id") is not None:
            target = unit_ref_phrase(p["object"]) if p.get("object") is not None else "the unit"
            return _with_window(
                f"{target} {has} been targeted with the {id_label(f['id'])} Stratagem", window
            )
        # Only ranged (or melee, psychic) attacks: "as a target of its ranged attacks".
        atk = _str(f.get("attack_type")) if _truthy(f.get("attack_type")) else ""
        if p.get("object") is not None:
            what = f"{unit_ref_phrase(p['object'])} as a target" + (
                f" of its {atk} attacks" if atk else ""
            )
        else:
            what = "targets" + (f" for its {atk} attacks" if atk else "")
        return _with_window(f"{who} {has} selected {what}", window)
    if event == "disembarked":
        transport = f.get("transport")
        if transport is None:
            source = "a Transport"
        elif transport in ("this-unit", "this-model"):
            source = "this Transport"
        else:
            source = unit_ref_phrase(transport)
        return _with_window(f"{who} {did_not('disembark')} from {source}", window)
    if event == "after-roll":
        obj = unit_ref_phrase(p.get("object"), "the unit")
        target = "the target" if obj == "the target unit" else obj
        atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
        weapons = f.get("weapons")
        keyword = ""
        name = ""
        if isinstance(weapons, dict):
            kw = weapons.get("keyword")
            if isinstance(kw, dict):
                kw = kw.get("keyword_id")
            if _truthy(kw):
                keyword = f"[{dekebab(_str(kw)).upper()}]"
            if _truthy(weapons.get("name")):
                raw_name = _str(weapons["name"])
                name = (
                    title_case(raw_name)
                    if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", raw_name)
                    else raw_name
                )
        if name:
            weapon = f" by {name}" + (f" (with {keyword})" if keyword else "")
        elif keyword:
            weapon = f" made with a {keyword} weapon"
        else:
            weapon = ""
        by_v = f.get("by")
        if _truthy(by_v) and isinstance(by_v, dict) and "event_var" in by_v:
            by = " from the triggering unit"
        elif by_v is not None:
            by = f" from {unit_ref_phrase(by_v)}"
        else:
            by = ""
        when = (
            " during its just-finished shooting sequence"
            if window == "event"
            else f" {_window_phrase(window)}"
        )
        # Who made the attacks, when it is not the unit being checked.
        subj = p.get("subject")
        attacker = (
            f" made by {unit_ref_phrase(subj)}" if subj is not None and subj != "this-unit" else ""
        )
        if f.get("roll") == "hit" and f.get("result") == "success":
            if _is_num(n) and n > 1:
                hits = f"{_str(n)}+ {atk}attacks"
            elif atk == "":
                hits = "an attack"
            else:
                hits = f"a {atk}attack"
            return f"{neg}{target} was hit by {hits}{attacker}{weapon}{by}{when}"
        # Whose roll it was, when the subject names one:
        # "the unit made a battle-shock roll and failed it".
        if subj is not None:
            outcome = (
                " and failed it"
                if f.get("result") == "failure"
                else " and passed it"
                if f.get("result") == "success"
                else ""
            )
            made = f"{neg}{who} made a {roll_word(f.get('roll'))} roll{outcome}"
            return f"{made} {_window_phrase(window)}".rstrip()
        result = f"was a {_str(f['result'])} " if _truthy(f.get("result")) else "was made "
        return f"{neg}a {roll_word(f.get('roll'))} roll {result}{_window_phrase(window)}".rstrip()
    if event == "damage-allocated":
        obj = unit_ref_phrase(p.get("object"), "the unit")
        atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
        tail = " from the triggering attacks" if window == "event" else f" {_window_phrase(window)}"
        return f"{neg}{obj} lost one or more wounds from {atk}attacks{tail}"
    if event in ("destroyed", "model-destroyed"):
        noun = "model" if event == "model-destroyed" else "unit"
        if p.get("object") == "event-object" and window == "event":
            if _truthy(f.get("attack_type")):
                weapons = f.get("weapons")
                weapon_name = weapons.get("name") if isinstance(weapons, dict) else None
                made = f" made with {_str(weapon_name)}" if _truthy(weapon_name) else ""
                return f"{neg}destroyed by a {_str(f['attack_type'])} attack{made}"
            return f"{neg}destroyed by any attack"
        # "this model": the destroyed model is this one, not any model of the unit.
        if p.get("object") == "this-model":
            return _with_window(
                "this model was not destroyed" if negated else "this model was destroyed", window
            )
        victim = _obj(p.get("object"))
        kws = (
            f"{' '.join(_str(k) for k in victim['all_of'])} "
            if isinstance(victim.get("all_of"), list)
            else ""
        )
        owner = f"{_str(victim['owner'])} " if victim.get("owner") is not None else ""
        # A filter beyond keywords and owner ("with the X or Y keyword") reads through
        # the unit-filter phrase.
        extended = any(k not in ("all_of", "owner", "level", "designated") for k in victim)
        objects = f"{owner}{kws}{noun}s"
        if extended:
            phrase = unit_filter_phrase(
                {**victim, "level": "model" if event == "model-destroyed" else "unit"}
            )
            objects = re.sub(r"\b(unit|model)\b", r"\1s", re.sub(r"^an? ", "", phrase), count=1)
        # Who destroyed them: the filter's attacker, else the event's subject.
        killer_ref = f["by"] if f.get("by") is not None else p.get("subject")
        if killer_ref is not None:
            # A destruction by one attack type says it: "with its just-resolved melee attacks".
            atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
            if window == "event":
                when = f"with its just-resolved {atk}attacks"
            else:
                when = (f"with {atk}attacks " if atk else "") + _window_phrase(window)
            killer = unit_ref_phrase(killer_ref)
            return f"{neg}{killer} has destroyed {_str(n)}+ {objects} {when}".rstrip()
        tagged = (
            f" {_designation_phrase(_str(victim['designated']))}"
            if not extended and victim.get("designated") is not None
            else ""
        )
        return f"{neg}{_with_window(f'{_str(n)}+ {objects}{tagged} destroyed', window)}"
    if event == "used":
        # The use being resolved now: "the unit is performing the Swift as the Wind Agile
        # Manoeuvre".
        if window == "event" and f.get("ability_keyword") is None and f.get("same_rule_as") is None:
            kind = _str(f.get("kind") if f.get("kind") is not None else "ability")
            rule = named_use_phrase(f) or _IN_PROGRESS.get(kind, f"a {dekebab(kind)}")
            verb = "using" if kind in ("ability", "stratagem") else "performing"
            return f"{who} is {'not ' if negated else ''}{verb} {rule}"
        if f.get("kind") == "action":
            s = f"{neg}{_str(n)}+ actions completed"
            if f.get("id") is not None:
                s += f" ({dekebab(_str(f['id']))})"
            o = p.get("object")
            if isinstance(o, dict) and _truthy(o.get("objective")):
                s += f" on {_objective_phrase(o['objective'])}"
            elif isinstance(o, dict) and _truthy(o.get("terrain_area")):
                territory = _obj(o["terrain_area"]).get("territory")
                s += " on terrain" + (
                    f" in {dekebab(_str(territory))}" if _truthy(territory) else ""
                )
            elif isinstance(o, dict) and o.get("owner") == "enemy":
                s += " on an enemy unit"
            return _with_window(s, window)
        which = used_ability_phrase(f)
        if which is not None:
            return f"{neg}{_with_window(f'{who} used {which}', window)}"
        what = f"the {id_label(f['id'])} " if f.get("id") is not None else "a "
        used_kind = _str(f["kind"]) if f.get("kind") is not None else "ability"
        return f"{neg}{_with_window(f'{who} used {what}{dekebab(used_kind)}', window)}"
    if event == "objective-gained":
        return f"{neg}you newly control {_str(n)}+ objectives {_window_phrase(window)}".rstrip()
    if event == "designation-changed":
        units = unit_ref_phrase(p.get("object"), "units")
        became = _designation_phrase(_str(f.get("tag")))
        return f"{neg}{_with_window(f'{_str(n)}+ {units} became {became}', window)}"
    return f"{neg}{_with_window(f'{dekebab(event)} happened', window)}"


def _describe_happened(p: P, negated: bool) -> str:
    phrase = _describe_happened_core(p, negated)
    event = _str(p.get("event"))
    filt = _obj(p.get("filter"))
    if (
        event in ("destroyed", "model-destroyed")
        and filt.get("weapons") is not None
        and not (p.get("object") == "event-object" and p.get("window") == "event")
    ):
        phrase += f" made with {weapon_noun({'weapons': filt['weapons']})}"
    if (
        p.get("count") is not None
        and event in ("destroyed", "model-destroyed")
        and (
            p.get("object") == "this-model"
            or (p.get("object") == "event-object" and p.get("window") == "event")
        )
    ):
        phrase += f" ({count_phrase(p['count'])} times)"
    phrase += event_relation_phrase(filt)
    proximity = p.get("proximity")
    if isinstance(proximity, dict):
        distance = range_phrase(proximity.get("range"))
        origin = place_ref_phrase(proximity.get("of"))
        phrase += f" within {distance} of {origin}"
    if (
        p.get("count") is not None
        and event
        not in (
            "after-roll",
            "destroyed",
            "model-destroyed",
            "objective-gained",
            "designation-changed",
        )
        and not (event == "used" and filt.get("kind") == "action")
    ):
        phrase += f" ({count_phrase(p['count'])} times)"
    return phrase


def _destroyed_count(side: P) -> str:
    o = _obj(side.get("object"))
    objects = re.sub(r"^an? ", "", unit_ref_phrase(o))
    objects = re.sub(r"\b(unit|model)\b", lambda m: f"{m.group(1)}s", objects, count=1)
    return f"{objects} {_window_phrase(side.get('window'))}".rstrip()
