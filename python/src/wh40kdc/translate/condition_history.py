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
    _with_window,
    dekebab,
    move_kinds,
    title_case,
    unit_ref_phrase,
)


def _describe_happened(p: P, negated: bool) -> str:
    neg = "not " if negated else ""
    f = _obj(p.get("filter"))
    event = _str(p.get("event"))
    who = _subject_of(p)
    n = p["count_min"] if _is_num(p.get("count_min")) else 1
    window = p.get("window")

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
        return _with_window(f"{who} {'was not' if negated else 'was'} set up", window)
    if event == "targets-selected":
        has = "has not" if negated else "has"
        what = (
            f"{unit_ref_phrase(p['object'])} as a target"
            if p.get("object") is not None
            else "targets"
        )
        return _with_window(f"{who} {has} selected {what}", window)
    if event == "disembarked":
        return _with_window(f"{who} {did_not('disembark')} from a Transport", window)
    if event == "after-roll":
        obj = unit_ref_phrase(p.get("object"), "the unit")
        target = "the target" if obj == "the target unit" else obj
        atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
        keyword = (
            f"[{dekebab(_str(f['weapon_keyword'])).upper()}]"
            if _truthy(f.get("weapon_keyword"))
            else ""
        )
        if _truthy(f.get("weapon_name")):
            raw_name = _str(f["weapon_name"])
            name = (
                title_case(raw_name)
                if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", raw_name)
                else raw_name
            )
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
        if f.get("roll") == "hit" and f.get("result") == "success":
            if _is_num(n) and n > 1:
                hits = f"{_str(n)}+ {atk}attacks"
            elif atk == "":
                hits = "an attack"
            else:
                hits = f"a {atk}attack"
            return f"{neg}{target} was hit by {hits}{weapon}{by}{when}"
        result = f"was a {_str(f['result'])} " if _truthy(f.get("result")) else "was made "
        return f"{neg}a {_str(f.get('roll'))} roll {result}{_window_phrase(window)}".rstrip()
    if event == "damage-allocated":
        obj = unit_ref_phrase(p.get("object"), "the unit")
        atk = f"{_str(f['attack_type'])} " if _truthy(f.get("attack_type")) else ""
        tail = " from the triggering attacks" if window == "event" else f" {_window_phrase(window)}"
        return f"{neg}{obj} lost one or more wounds from {atk}attacks{tail}"
    if event in ("destroyed", "model-destroyed"):
        noun = "model" if event == "model-destroyed" else "unit"
        if p.get("object") == "event-object" and window == "event":
            if _truthy(f.get("attack_type")):
                made = (
                    f" made with {_str(f['weapon_name'])}" if _truthy(f.get("weapon_name")) else ""
                )
                return f"{neg}destroyed by a {_str(f['attack_type'])} attack{made}"
            return f"{neg}destroyed by any attack"
        victim = _obj(p.get("object"))
        kws = (
            f"{' '.join(_str(k) for k in victim['all_of'])} "
            if isinstance(victim.get("all_of"), list)
            else ""
        )
        owner = f"{_str(victim['owner'])} " if victim.get("owner") is not None else ""
        if f.get("by") is not None:
            when = "with its just-resolved attacks" if window == "event" else _window_phrase(window)
            killer = unit_ref_phrase(f["by"])
            return f"{neg}{killer} has destroyed {_str(n)}+ {owner}{kws}{noun}s {when}".rstrip()
        tagged = (
            f" {_designation_phrase(_str(victim['designated']))}"
            if victim.get("designated") is not None
            else ""
        )
        return f"{neg}{_with_window(f'{_str(n)}+ {owner}{kws}{noun}s{tagged} destroyed', window)}"
    if event == "used":
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
        what = f"the {title_case(_str(f['id']))} " if f.get("id") is not None else "a "
        kind = f.get("kind") if f.get("kind") is not None else "ability"
        return f"{neg}{_with_window(f'{who} used {what}{dekebab(_str(kind))}', window)}"
    if event == "objective-gained":
        return f"{neg}you newly control {_str(n)}+ objectives {_window_phrase(window)}".rstrip()
    if event == "designation-changed":
        units = unit_ref_phrase(p.get("object"), "units")
        became = _designation_phrase(_str(f.get("tag")))
        return f"{neg}{_with_window(f'{_str(n)}+ {units} became {became}', window)}"
    return f"{neg}{_with_window(f'{dekebab(event)} happened', window)}"


def _destroyed_count(side: P) -> str:
    o = _obj(side.get("object"))
    return f"{_str(o.get('owner'))} units {_window_phrase(side.get('window'))}".rstrip()
