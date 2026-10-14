"""Shared noun phrases of the condition describer: unit-refs, unit filters, ranges,
objectives, states, designations, history windows, past tense and move kinds.

Output is **ASCII-only** and pinned byte-for-byte across the ports by the conformance
corpus. Python mirror of ``tools/src/translate/condition-refs.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.designations import designation_label

Condition = dict[str, Any]
P = dict[str, Any]


def dekebab(s: str) -> str:
    """kebab-case → space-separated words (``enemy-territory`` → ``enemy territory``)."""
    return s.replace("-", " ")


# Small words kept lowercase mid-phrase in Title Case (`Benefit of Cover`, not
# `Benefit Of Cover`). Mirrors TS ``TITLE_SMALL`` / Go ``titleSmall``.
_TITLE_SMALL = {"of", "or", "and", "the", "a", "an", "to", "in", "on", "for", "with"}


def title_case(s: str) -> str:
    """kebab-case id → its display name in Title Case.

    Small words stay lowercase mid-phrase, so a faction id reads as its printed
    name: ``adepta-sororitas`` → ``Adepta Sororitas``, ``agents-of-the-imperium``
    → ``Agents of the Imperium`` (mirrors TS ``titleCase`` / Go ``titleCase``).
    Shared with the effect describer (``title_case as _title_case``) and used by
    the army-faction clause; it lives here because ``effect`` imports this module,
    so the shared helper cannot live there."""
    out = []
    for i, w in enumerate(dekebab(s).split(" ")):
        if w == "":
            out.append(w)
        elif i > 0 and w.lower() in _TITLE_SMALL:
            out.append(w.lower())
        else:
            out.append(w[0].upper() + w[1:])
    return " ".join(out)


#: Faction dir slugs an ability or Stratagem id ends with (``<name>-<faction>``), longest
#: first. The suffix is identity, not name, so it never reaches the English.
_FACTION_SUFFIXES: tuple[str, ...] = (
    "agents-of-the-imperium",
    "chaos-space-marines",
    "adeptus-mechanicus",
    "leagues-of-votann",
    "emperors-children",
    "genestealer-cults",
    "adepta-sororitas",
    "imperial-knights",
    "adeptus-custodes",
    "adeptus-astartes",
    "astra-militarum",
    "black-templars",
    "imperial-fists",
    "chaos-knights",
    "thousand-sons",
    "chaos-daemons",
    "blood-angels",
    "ultramarines",
    "space-wolves",
    "grey-knights",
    "world-eaters",
    "white-scars",
    "raven-guard",
    "dark-angels",
    "salamanders",
    "death-guard",
    "iron-hands",
    "tau-empire",
    "deathwatch",
    "drukhari",
    "tyranids",
    "aeldari",
    "necrons",
    "orks",
)


def without_faction_suffix(id_: str) -> str:
    """An ability or Stratagem id without its faction suffix
    (``acts-of-faith-adepta-sororitas`` → ``acts-of-faith``)."""
    for f in _FACTION_SUFFIXES:
        if id_.endswith(f"-{f}") and len(id_) > len(f) + 1:
            return id_[: -len(f) - 1]
    return id_


#: Ids whose name itself ends with the faction (the suffix was never added).
_WHOLE_NAMES: dict[str, str] = {"lord-of-the-death-guard": "Lord of the Death Guard"}


def id_label(id_: Any) -> str:
    """An ability or Stratagem id as a name: its name part in Title Case."""
    s = _str(id_)
    return _WHOLE_NAMES.get(s, title_case(without_faction_suffix(s)))


def _str(v: Any) -> str:
    """TS ``str``: null/undefined → "?", else JS ``String(v)``."""
    if v is None:
        return "?"
    if isinstance(v, str):
        return v
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _round_number(v: Any) -> float | int | None:
    """JS ``Number(v)`` collapsing integral floats to int; None on non-numeric."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


_BATTLE_ROUND_ORDS = ["zeroth", "first", "second", "third", "fourth", "fifth"]


def _battle_round_ord(n: float | int) -> str:
    """Ordinal name for a battle round (``["zeroth"..."fifth"][n] ?? "<n>th"``)."""
    if isinstance(n, int) and 0 <= n < len(_BATTLE_ROUND_ORDS):
        return _BATTLE_ROUND_ORDS[n]
    return f"{_str(n)}th"


def _truthy(v: Any) -> bool:
    """JS truthiness: an empty list or dict is truthy, unlike Python."""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and v == v
    if isinstance(v, str):
        return v != ""
    return True


def _obj(v: Any) -> P:
    """A record view of ``v``: JS property access on a non-object yields undefined."""
    return v if isinstance(v, dict) else {}


def _is_num(v: Any) -> bool:
    """JS ``typeof v === "number"``."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _article(s: str) -> str:
    """``/^[aeiou]/i.test(s) ? "an" : "a"``."""
    return "an" if s[:1].lower() in ("a", "e", "i", "o", "u") and s[:1] != "" else "a"


def _or_list(items: list[str]) -> str:
    if len(items) <= 1:
        return items[0] if items else ""
    if len(items) == 2:
        return f"{items[0]} or {items[1]}"
    return f"{', '.join(items[:-1])} or {items[-1]}"


def _and_list(items: list[str]) -> str:
    if len(items) <= 1:
        return items[0] if items else ""
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _list(v: Any) -> list[Any]:
    """``(v as unknown[]) ?? []`` for array-typed parameters."""
    return v if isinstance(v, list) else []


# -- Shared references --------------------------------------------------------

_ROLE_PHRASES: dict[str, str] = {
    "this-unit": "the unit",
    "this-model": "this model",
    "model-in-this-unit": "a model in this unit",
    "attacker": "the attacking unit",
    "defender": "the target unit",
    "event-subject": "the triggering unit",
    "event-object": "that unit",
    "stratagem-target": "the Stratagem's target",
    "selected-unit": "the selected unit",
    "recipient": "the unit",
    "bearer-transport": "the Transport this unit is embarked within",
    "ability-unit": "this unit",
}


def unit_filter_phrase(f: Any) -> str:
    """A unit filter as a noun phrase: "a friendly ADEPTUS MECHANICUS BATTLELINE unit"."""
    f = _obj(f)
    owner = (
        "friendly "
        if f.get("owner") == "friendly"
        else "enemy "
        if f.get("owner") == "enemy"
        else ""
    )
    all_of = f.get("all_of")
    all_ = f"{' '.join(_str(k) for k in all_of)} " if isinstance(all_of, list) else ""
    noun = "model" if f.get("level") == "model" else "unit"
    s = f"{owner}{all_}{noun}"
    article = "an" if re.match(r"(?:[aeio]|u(?!ni))", s, re.IGNORECASE) else "a"
    s = f"{article} {s}"
    if isinstance(f.get("any_of"), list):
        s += f" with the {_or_list([_str(k) for k in f['any_of']])} keyword"
    if isinstance(f.get("none_of"), list):
        s += f" (excluding {_or_list([_str(k) for k in f['none_of']])} {noun}s)"
    if isinstance(f.get("has_ability"), list):
        s += f" with the {_and_list([id_label(a) for a in f['has_ability']])} ability"
    if isinstance(f.get("lacks_ability"), list):
        s += f" without the {_or_list([id_label(a) for a in f['lacks_ability']])} ability"
    if f.get("embarked_in") is not None:
        s += f" embarked within {unit_ref_phrase(f['embarked_in'])}"
    if f.get("member_of") is not None:
        s += f" in {unit_ref_phrase(f['member_of'])}"
    if f.get("engaged_with") is not None:
        s += f" within Engagement Range of {unit_filter_phrase(f['engaged_with'])}"
    if f.get("not_engaged_with") is not None:
        inner = re.sub(r"^an? ", "", unit_filter_phrase(f["not_engaged_with"]))
        s += f" not within Engagement Range of any {inner}"
    if f.get("designated") is not None:
        by = (
            f" by {unit_ref_phrase(f['designated_by'])}"
            if f.get("designated_by") is not None
            else ""
        )
        s += f" that is {_designation_phrase(_str(f['designated']))}{by}"
    if f.get("not_designated") is not None:
        s += f" that is not {_designation_phrase(_str(f['not_designated']))}"
    if f.get("state") is not None:
        s += f" that is {_state_phrase(_str(f['state']))}"
    if f.get("visible") is True:
        s += " that is visible to it"
    within = f.get("within")
    if within is not None:
        w = _obj(within)
        of = f" of {unit_ref_phrase(w['of'])}" if w.get("of") is not None else ""
        wholly = "wholly " if w.get("wholly") is True else ""
        s += f" {wholly}within {range_phrase(w.get('range'))}{of}"
    if f.get("excluding") is not None:
        excl = f["excluding"]
        s += f" other than {'this unit' if excl == 'this-unit' else unit_ref_phrase(excl)}"
    return s


def unit_ref_phrase(ref: Any, fallback: str = "the unit") -> str:
    """A unit-ref as a noun phrase; ``fallback`` names the default subject."""
    if ref is None:
        return fallback
    if isinstance(ref, str):
        return _ROLE_PHRASES.get(ref, dekebab(ref))
    if isinstance(ref, dict):
        if isinstance(ref.get("event_var"), str):
            return "that unit"
        if isinstance(ref.get("selection_var"), str):
            return f"the bound {_str(ref['selection_var']).replace('_', ' ')}"
        if isinstance(ref.get("stratagem_target"), str):
            return f"the {dekebab(re.sub(r'^the-', '', ref['stratagem_target']))} target"
        return unit_filter_phrase(ref)
    if isinstance(ref, list):
        return unit_filter_phrase({})
    return fallback


def _subject_of(p: P, fallback: str = "the unit") -> str:
    return unit_ref_phrase(p.get("subject"), fallback)


_AURA_RANGES: dict[str, str] = {"nurgles-gift-death-guard": "Contagion Range"}

_RANGE_WORDS: dict[str, str] = {
    "engagement": "Engagement Range",
    "aura": "its aura range",
    "weapon": "the attacking weapon's range",
    "half-weapon": "half the attacking weapon's range",
    "detection": "detection range",
    "objective-control": "range",
}


def range_phrase(r: Any) -> str:
    """A range-ref as a distance phrase ("6\\"", "Engagement Range", "Contagion Range")."""
    if r is None:
        return '?"'
    if isinstance(r, str):
        return _RANGE_WORDS.get(r, dekebab(r))
    o = _obj(r)
    if o.get("inches") is not None:
        return f'{_str(o["inches"])}"'
    if o.get("aura_of") is not None:
        aura = _str(o["aura_of"])
        return _AURA_RANGES.get(aura, f"the {id_label(aura)} range")
    return '?"'


def _objective_phrase(f: Any, plural: bool = False, noun: str = "objective") -> str:
    f = _obj(f)
    role_v = f.get("role")
    role = "" if role_v == "non-home" else f"{dekebab(_str(role_v))} " if role_v is not None else ""
    s = f"{role}{noun}{'s' if plural else ''}"
    if f.get("home_of") == "enemy":
        s += " (opponent home)"
    if f.get("home_of") == "friendly":
        s += " (your home)"
    if f.get("name") is not None:
        s += f" ({dekebab(_str(f['name']))})"
    if f.get("territory") is not None:
        s += f" in {dekebab(_str(f['territory']))}"
    if role_v == "non-home":
        s += " (excluding home)"
    if f.get("controlled_by") == "friendly":
        s += " you control"
    if f.get("controlled_by") == "enemy":
        s += " your opponent controls"
    if f.get("designated") is not None:
        s += f" tagged {dekebab(_str(f['designated']))}"
    return s


_STATE_PHRASES: dict[str, str] = {
    "engaged": "engaged",
    "battle-shocked": "Battle-shocked",
    "embarked": "embarked",
    "in-strategic-reserves": "in Strategic Reserves",
    "on-battlefield": "on the battlefield",
    "hidden": "hidden",
    "fights-first": "a Fights First unit",
    "benefit-of-cover": "receiving the benefit of cover",
}
_NEGATED_STATE: dict[str, str] = {"engaged": "unengaged"}


def _state_phrase(state: str, negated: bool = False) -> str:
    if negated:
        return _NEGATED_STATE.get(state, f"not {_STATE_PHRASES.get(state, dekebab(state))}")
    return _STATE_PHRASES.get(state, dekebab(state))


def _designation_phrase(tag: str, plural: bool = False) -> str:
    """A designation: a registered id prints the rules' term, legacy upper-case tags stay
    as printed, internal ones are spelled out."""
    label = designation_label(tag, plural)
    if label is not None:
        return label
    return tag if tag == tag.upper() else f"tagged {dekebab(tag)}"


_WINDOW_PHRASES: dict[str, str] = {
    "phase": "this phase",
    "turn": "this turn",
    "round": "this battle round",
    "battle": "this battle",
    "previous-turn": "in the previous turn",
    "event": "",
}


def _window_phrase(w: Any) -> str:
    return _WINDOW_PHRASES.get(_str(w), dekebab(_str(w)))


def _with_window(s: str, w: Any) -> str:
    phrase = _window_phrase(w)
    return f"{s} {phrase}" if phrase else s


_MOVE_NAMES: dict[str, str] = {
    "normal": "Normal",
    "advance": "Advance",
    "remain-stationary": "Remain Stationary",
    "fall-back": "Fall Back",
    "charge": "Charge",
    "pile-in": "Pile-in",
    "consolidation": "Consolidation",
    "ingress": "ingress",
    "surge": "Surge",
    "scout": "Scout",
    "disembark": "Disembark",
}


def move_kinds(types: Any) -> str:
    """Move types as an or-list of their printed names ("Normal, Advance or Fall Back")."""
    return _or_list([_MOVE_NAMES.get(_str(t), dekebab(_str(t))) for t in _list(types)])


_MOVE_VERBS: dict[str, str] = {
    "charge": "charge",
    "advance": "advance",
    "fall-back": "fall back",
    "remain-stationary": "remain stationary",
    "ingress": "make an ingress move",
}

# Past tense of the verbs history predicates use.
_PAST: dict[str, str] = {
    "charge": "charged",
    "advance": "advanced",
    "fall back": "fell back",
    "remain stationary": "remained stationary",
    "make an ingress move": "made an ingress move",
    "move": "moved",
    "disembark": "disembarked",
}


def _past_of(verb: str) -> str:
    if verb in _PAST:
        return _PAST[verb]
    return f"made {verb[5:]}" if verb.startswith("make ") else verb


def _cap_word(s: str) -> str:
    """Capitalize the first character and lowercase the rest (``MONSTER`` -> ``Monster``)."""
    return s if s == "" else s[0].upper() + s[1:].lower()


def roll_word(roll: Any) -> str:
    """A roll kind as words: "hit", or the dice a named ability rolls ("Reanimation Protocols")."""
    if isinstance(roll, dict) and roll.get("of_ability") is not None:
        return id_label(roll["of_ability"])
    return dekebab(_str(roll))


def used_ability_phrase(f: P) -> str | None:
    """Which ability a ``used`` filter names: every ability with a bracketed keyword, or
    the same one as a bound use."""
    if f.get("ability_keyword") is not None:
        return f"a {title_case(_str(f['ability_keyword']).lower())} ability"
    if f.get("same_rule_as") is not None:
        return f"that same {'Stratagem' if f.get('kind') == 'stratagem' else 'ability'}"
    return None
