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
    is_event_object,
    move_kinds,
    named_use_phrase,
    place_ref_phrase,
    range_phrase,
    roll_word,
    title_case,
    unit_filter_phrase,
    unit_ref_phrase,
    used_ability_phrase,
    with_article,
)
from wh40kdc.translate.condition_refs import _window_phrase as _base_window_phrase
from wh40kdc.translate.effect_words import bracket_keyword, weapon_noun

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



def _articled(name: str) -> str:
    """"an Advance", "a Normal": the indefinite article for a printed move name."""
    return f"{'an' if name[:1].upper() in 'AEIOU' and name else 'a'} {name}"

def _describe_happened_core(p: P, negated: bool) -> str:
    neg = "not " if negated else ""
    f = _obj(p.get("filter"))
    event = _str(p.get("event"))
    bounds = _obj(p.get("count"))
    amount = count_phrase(p.get("count"))
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
            done = did_not(f"make {_articled(move_kinds(types))} move" if types else "move")
        # A charge with an object: the unit the charge was made against ("was charged this turn").
        if p.get("object") is not None and types == ["charge"]:
            return _with_window(f"{who} {done} {unit_ref_phrase(p['object'])}", window)
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
        # A charge's targets: "selected the unit as a charge target", apart from an attack's.
        charge = _str(f.get("kind")) == "charge"
        if p.get("object") is not None and f.get("all_attacks") is True:
            what = f"{unit_ref_phrase(p['object'])} as the target of all of its " + (
                f"{atk} attacks" if atk else "attacks"
            )
        elif p.get("object") is not None:
            noun = "a charge target" if charge else "a target"
            what = f"{unit_ref_phrase(p['object'])} as {noun}" + (
                f" of its {atk} attacks" if atk else ""
            )
        else:
            what = ("charge targets" if charge else "targets") + (
                f" for its {atk} attacks" if atk else ""
            )
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
        weapons = _obj(f.get("weapons"))
        kw = weapons.get("keyword")
        keyword = (
            bracket_keyword(kw) if kw is not None and not isinstance(kw, list) else ""
        )
        raw_name = _str(weapons.get("name"))
        weapon_name = (
            title_case(raw_name)
            if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", raw_name)
            else raw_name
        )
        simple = all(key in ("name", "keyword") for key in weapons) and not isinstance(
            weapons.get("keyword"), list
        )
        if not simple:
            weapon = f" made with {weapon_noun({'weapons': weapons})}"
        elif _truthy(weapons.get("name")):
            weapon = f" by {weapon_name}" + (f" (with {keyword})" if keyword else "")
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
            " during that shooting sequence"
            if window == "event"
            else f" {_window_phrase(window)}"
        )
        # Who made the attacks, when it is not the unit being checked.
        subj = p.get("subject")
        attacker = (
            f" made by {unit_ref_phrase(subj)}" if subj is not None and subj != "this-unit" else ""
        )
        if f.get("roll") == "hit" and f.get("result") == "success":
            if (bounds.get("min") is not None and bounds.get("min") != 1) or bounds.get(
                "max"
            ) is not None:
                hits = f"{amount} {atk}attacks"
            elif atk == "":
                hits = "an attack"
            else:
                hits = f"a {atk}attack"
            return f"{neg}{target} was hit by {hits}{attacker}{weapon}{by}{when}"
        # Whose roll it was, when the subject names one:
        # "this unit made a battle-shock roll and failed it".
        times = f" ({amount} times)" if p.get("count") is not None else ""
        roll_phrase = with_article(f"{roll_word(f.get('roll'))} roll")
        if subj is not None:
            outcome = (
                " and failed it"
                if f.get("result") == "failure"
                else " and passed it"
                if f.get("result") == "success"
                else ""
            )
            made = f"{neg}{who} made {roll_phrase}{outcome}"
            return f"{made} {_window_phrase(window)}{times}".rstrip()
        result = f"was a {_str(f['result'])} " if _truthy(f.get("result")) else "was made "
        return f"{neg}{roll_phrase} {result}{_window_phrase(window)}{times}".rstrip()
    if event == "damage-allocated":
        obj = unit_ref_phrase(p.get("object"), "this unit")
        atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
        if window == "event":
            return f"{neg}{obj} lost one or more wounds from the triggering {atk}attacks"
        win = _window_phrase(window)
        return f"{neg}{obj} lost one or more wounds from {atk}attacks {win}".rstrip()
    if event in ("destroyed", "model-destroyed"):
        noun = "model" if event == "model-destroyed" else "unit"
        if is_event_object(p.get("object")) and window == "event":
            made = (
                f" made with {weapon_noun({'weapons': f['weapons']})}"
                if f.get("weapons") is not None
                else ""
            )
            if _truthy(f.get("attack_type")):
                attack_type = _str(f["attack_type"])
                return f"{neg}destroyed by {with_article(f'{attack_type} attack')}{made}"
            return f"{neg}destroyed by any attack{made}"
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
        # "this unit lost one or more models to those attacks": the victims are one unit's
        # models (a selection's candidate).
        if event == "model-destroyed" and victim.get("member_of") is not None and window == "event":
            member = victim["member_of"]
            who = "this unit" if member == "selected-unit" else unit_ref_phrase(member)
            atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
            return f"{neg}{who} lost {amount} models to those {atk}attacks"
        # "the enemy WARLORD": one designated model, named as itself rather than counted.
        warlord = not extended and kws == "" and victim.get("designated") == "warlord"
        victims = f"the {owner}Warlord" if warlord else f"{amount} {objects}"
        # Who destroyed them: the filter's attacker, else the event's subject.
        killer_ref = f["by"] if f.get("by") is not None else p.get("subject")
        if killer_ref is not None:
            # A destruction by one attack type says it: "with those melee attacks".
            atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
            if window == "event":
                when = f"with those {atk}attacks"
            else:
                when = (f"with {atk}attacks " if atk else "") + _window_phrase(window)
            killer = unit_ref_phrase(killer_ref)
            return f"{neg}{killer} has destroyed {victims} {when}".rstrip()
        if warlord:
            was = "was not" if negated else "was"
            return _with_window(f"{victims} {was} destroyed", window)
        tagged = (
            f" {_designation_phrase(_str(victim['designated']))}"
            if not extended and victim.get("designated") is not None
            else ""
        )
        return f"{neg}{_with_window(f'{amount} {objects}{tagged} destroyed', window)}"
    if event == "used":
        # A Ritual is attempted with a Psychic test: the bound test is for the Ritual the unit
        # attempts.
        if window == "event" and f.get("kind") == "ritual" and f.get("same_rule_as") is not None:
            return f"that test is {'not ' if negated else ''}for a Ritual {who} is attempting"
        # The use being resolved now: "the unit is performing the Swift as the Wind Agile
        # Manoeuvre".
        if window == "event" and f.get("ability_keyword") is None and f.get("same_rule_as") is None:
            kind = _str(f.get("kind") if f.get("kind") is not None else "ability")
            rule = named_use_phrase(f) or _IN_PROGRESS.get(kind, f"a {dekebab(kind)}")
            verb = "using" if kind in ("ability", "stratagem") else "performing"
            return f"{who} is {'not ' if negated else ''}{verb} {rule}"
        if f.get("kind") == "action":
            s = f"{neg}{amount} actions completed"
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
        used_kind = _str(f["kind"]) if f.get("kind") is not None else "ability"
        used_phrase = (
            f"the {id_label(f['id'])} {dekebab(used_kind)}"
            if f.get("id") is not None
            else with_article(dekebab(used_kind))
        )
        return f"{neg}{_with_window(f'{who} used {used_phrase}', window)}"
    if event == "state-changed":
        # "cause it to become Below Half-strength": the unit's strength fell past a threshold.
        # With no subject, any unit: "a unit became Below Half-strength".
        unit = "a unit" if p.get("subject") is None else who
        if f.get("strength") == "below-half":
            became = "did not become" if negated else "became"
            return _with_window(f"{unit} {became} Below Half-strength", window)
        if f.get("strength") == "below-starting":
            fell = "did not fall" if negated else "fell"
            return _with_window(f"{unit} {fell} below its Starting Strength", window)
        return f"{neg}{_with_window(f'{unit} changed state', window)}"
    if event == "objective-gained":
        return f"{neg}you newly control {amount} objectives {_window_phrase(window)}".rstrip()
    if event == "designation-changed":
        units = unit_ref_phrase(p.get("object"), "units")
        became = _designation_phrase(_str(f.get("tag")))
        return f"{neg}{_with_window(f'{amount} {units} became {became}', window)}"
    if event == "resource-spent":
        pool = _str(f.get("pool"))
        what = {"yp-pool": "YP"}.get(pool, dekebab(pool))
        spent = f"you spent no {what}" if negated else f"you spent {what}"
        return _with_window(spent, window)
    return f"{neg}{_with_window(f'{dekebab(event)} happened', window)}"


def _describe_happened(p: P, negated: bool) -> str:
    phrase = _describe_happened_core(p, negated)
    event = _str(p.get("event"))
    filt = _obj(p.get("filter"))
    if (
        event in ("destroyed", "model-destroyed")
        and filt.get("weapons") is not None
        and not (is_event_object(p.get("object")) and p.get("window") == "event")
    ):
        phrase += f" made with {weapon_noun({'weapons': filt['weapons']})}"
    if (
        p.get("count") is not None
        and event in ("destroyed", "model-destroyed")
        and (
            p.get("object") == "this-model"
            or (is_event_object(p.get("object")) and p.get("window") == "event")
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
