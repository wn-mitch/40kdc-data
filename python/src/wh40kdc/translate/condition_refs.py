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

def event_relation_phrase(filter_: P) -> str:
    """Render causal links to an exact bound event, never mere actor equality."""
    phrase = ""
    if filter_.get("caused_by") is not None:
        phrase += " as a result of the exact bound event"
    if filter_.get("causes") is not None:
        phrase += " and causing the exact bound event"
    return phrase


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

def count_phrase(value: Any, default_min: Any = 1) -> str:
    """Render inclusive count bounds exactly as the TypeScript describer."""
    count = value if isinstance(value, dict) else {}
    minimum = count.get("min")
    maximum = count.get("max")
    if minimum is not None and maximum is not None:
        if minimum == maximum:
            from wh40kdc.translate.effect_words import dice_case

            return f"exactly {dice_case(minimum)}"
        from wh40kdc.translate.effect_words import dice_case

        if _is_num(minimum) and _is_num(maximum):
            return f"{minimum}-{maximum}"
        return f"between {dice_case(minimum)} and {dice_case(maximum)}"
    if maximum is not None:
        from wh40kdc.translate.effect_words import dice_case

        return f"at most {dice_case(maximum)}"
    minimum = default_min if minimum is None else minimum
    if _is_num(minimum):
        return f"{minimum}+"
    from wh40kdc.translate.effect_words import dice_case

    return f"at least {dice_case(minimum)}"


def rule_ref_phrase(value: Any) -> str:
    if isinstance(value, dict):
        if value.get("definition_id") is not None:
            definition = id_label(value.get("definition_id"))
            return f"{definition} ability of {id_label(value.get('ability_id'))}"
        return f"{id_label(value.get('option_id'))} option of {id_label(value.get('ability_id'))}"
    return id_label(value)

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


def keyword_alternatives(f: Any) -> list[str] | None:
    """A filter's ``any_of_filters`` as keyword spellings when each alternative is only its
    keywords and the filter requires none of its own, so "an A or B C unit" says it; else None."""
    f = _obj(f)
    alts = f.get("any_of_filters")
    if not isinstance(alts, list) or isinstance(f.get("all_of"), list):
        return None
    out: list[str] = []
    for a in alts:
        if not isinstance(a, dict):
            return None
        all_of = a.get("all_of")
        if not isinstance(all_of, list) or not all_of or any(k != "all_of" for k in a):
            return None
        out.append(" ".join(_str(k) for k in all_of))
    return out


def alternative_filters(f: Any) -> list[P]:
    """Each alternative of ``any_of_filters`` as a filter of the outer filter's level."""
    f = _obj(f)
    level = f.get("level")
    return [
        {**_obj(a), "level": level} if level is not None else _obj(a) for a in f["any_of_filters"]
    ]


def unit_filter_phrase(f: Any) -> str:
    """A unit filter as a noun phrase: "a friendly ADEPTUS MECHANICUS BATTLELINE unit"."""
    f = _obj(f)
    owner = {
        "friendly": "friendly ",
        "enemy": "enemy ",
    }.get(f.get("owner"), "")
    all_of = f.get("all_of")
    all_ = f"{' '.join(_str(k) for k in all_of)} " if isinstance(all_of, list) else ""
    noun = (
        f"{_str(f.get('attachment_role'))} model"
        if f.get("level") == "model" and f.get("attachment_role") is not None
        else "model"
        if f.get("level") == "model"
        else "unit"
    )
    compact = keyword_alternatives(f)
    s = f"{owner}{_or_list(compact)} {noun}" if compact is not None else f"{owner}{all_}{noun}"
    article = "an" if re.match(r"(?:[aeio]|u(?!ni))", s, re.IGNORECASE) else "a"
    s = f"{article} {s}"
    if isinstance(f.get("any_of_filters"), list) and compact is None:
        s += f" that is {_or_list([unit_filter_phrase(a) for a in alternative_filters(f)])}"
    if isinstance(f.get("any_of"), list):
        s += f" with the {_or_list([_str(k) for k in f['any_of']])} keyword"
    if isinstance(f.get("none_of"), list):
        s += f" (excluding {_or_list([_str(k) for k in f['none_of']])} {noun}s)"
    if isinstance(f.get("not_all_of"), list):
        s += f" (excluding {' '.join(_str(k) for k in f['not_all_of'])} {noun}s)"
    if isinstance(f.get("has_ability"), list):
        s += f" with the {_and_list([id_label(a) for a in f['has_ability']])} ability"
    if isinstance(f.get("lacks_ability"), list):
        s += f" without the {_or_list([id_label(a) for a in f['lacks_ability']])} ability"
    if isinstance(f.get("model_names"), list):
        s += f" named {_or_list([_str(name) for name in f['model_names']])}"
    if isinstance(f.get("unit_ids"), list) and f["unit_ids"]:
        s += f" with unit ID {_or_list([_str(unit_id) for unit_id in f['unit_ids']])}"
    if f.get("embarked_in") is not None:
        s += f" embarked within {unit_ref_phrase(f['embarked_in'])}"
    if f.get("member_of") is not None:
        s += f" in {unit_ref_phrase(f['member_of'])}"
    if f.get("engaged_with") is not None:
        s += f" within Engagement Range of {unit_ref_phrase(f['engaged_with'])}"
    if f.get("not_engaged_with") is not None:
        reference = f["not_engaged_with"]
        exact = isinstance(reference, str) or (
            isinstance(reference, dict)
            and any(key in reference for key in ("selection_var", "event_var", "stratagem_target"))
        )
        target = unit_ref_phrase(reference)
        if not exact:
            target = f"any {target.removeprefix('a ').removeprefix('an ')}"
        s += f" not within Engagement Range of {target}"
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
    if isinstance(f.get("not_states"), list):
        s += f" that is {_and_list([_state_phrase(_str(x), True) for x in f['not_states']] )}"
    visible = f.get("visible")
    if isinstance(visible, dict) and visible.get("to") is not None:
        s += f" that is visible to {unit_ref_phrase(visible['to'])}"
    within = f.get("within")
    if within is not None:
        w = _obj(within)
        of = f" of {place_ref_phrase(w['of'])}" if w.get("of") is not None else ""
        wholly = "wholly " if w.get("wholly") is True else ""
        s += f" {wholly}within {range_phrase(w.get('range'))}{of}"
    if f.get("excluding") is not None:
        excluded = (
            "this unit"
            if f["excluding"] == "this-unit"
            else unit_ref_phrase(f["excluding"])
        )
        s += f" other than {excluded}"
    return s


def unit_ref_phrase(ref: Any, fallback: str = "the unit") -> str:
    """A unit/place ref as a noun phrase; fallback names the default subject."""
    if ref is None:
        return fallback
    if isinstance(ref, str):
        return _ROLE_PHRASES.get(ref, dekebab(ref))
    if isinstance(ref, dict):
        if isinstance(ref.get("objective"), dict):
            return _objective_phrase(ref["objective"])
        if isinstance(ref.get("marker"), dict):
            marker = ref["marker"]
            marker_id = marker.get("id") or marker.get("marker_id")
            return f"the {dekebab(_str(marker_id))} marker"
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


def place_ref_phrase(ref: Any) -> str:
    if ref == "battlefield-edge":
        return "a battlefield edge"
    if ref == "battlefield-centre":
        return "the centre of the battlefield"
    if isinstance(ref, dict):
        if ref.get("objective") is not None:
            objective = _obj(ref["objective"])
            if objective.get("selection_var") is not None:
                return "that objective marker"
            phrase = _objective_phrase(objective, False, "objective marker")
            return f"{_article(phrase)} {phrase}"
        if ref.get("marker") is not None:
            marker = ref["marker"]
            marker_text = _str(marker)
            return f"{_article(marker_text)} {dekebab(marker_text)} marker"
    return unit_ref_phrase(ref)


def _subject_of(p: P, fallback: str = "the unit") -> str:
    return unit_ref_phrase(p.get("subject"), fallback)


_AURA_RANGES: dict[str, str] = {
    "nurgles-gift-death-guard": "Contagion Range",
    "synapse-tyranids": "Synapse Range",
}

_RANGE_WORDS: dict[str, str] = {
    "engagement": "Engagement Range",
    "aura": "its aura range",
    "weapon": "the attacking weapon's range",
    "half-weapon": "half the attacking weapon's range",
    "detection": "detection range",
    "objective-control": "range",
}


def range_phrase(r: Any) -> str:
    """A range-ref as a distance phrase, including per-battle-round tiers."""
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
    tiers = o.get("per_battle_round")
    if isinstance(tiers, list) and tiers:
        rendered = ", ".join(range_phrase(value) for value in tiers)
        rounds = ", ".join(str(index + 1) for index in range(len(tiers)))
        return (
            f"{rendered} in battle rounds {rounds} respectively "
            "(using the final range in later battle rounds)"
        )
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
        s += f" in {territory_phrase(_str(f['territory']))}"
    if role_v == "non-home":
        s += " (excluding home)"
    within = _obj(f.get("within"))
    # Your control, within this unit's own range of it: the unit itself is controlling it.
    unit_controls = (
        f.get("controlled_by") == "friendly"
        and within.get("range") == "objective-control"
        and within.get("of") == "this-unit"
    )
    if unit_controls:
        s += " your unit controls"
    elif f.get("controlled_by") == "friendly":
        s += " you control"
    if f.get("controlled_by") == "enemy":
        s += " your opponent controls"
    if f.get("designated") is not None:
        s += f" tagged {dekebab(_str(f['designated']))}"
    if f.get("within") is not None and not unit_controls:
        s += f" within {range_phrase(within.get('range'))} of {place_ref_phrase(within.get('of'))}"
    # "that your unit was controlling when it was destroyed": the unit's control when the rule was
    # triggered.
    if f.get("controlled_by_unit") is not None:
        unit = unit_ref_phrase(f["controlled_by_unit"])
        s += f" that {unit} was controlling when the rule was triggered"
    if f.get("clear_of") is not None:
        bare = re.sub(r"^an? ", "", unit_filter_phrase(f["clear_of"]))
        clear = re.sub(r"\bunit\b", "units", bare, count=1)
        s += f", with no {clear} within range of it"
    return s


_STATE_PHRASES: dict[str, str] = {
    "engaged": "engaged",
    "battle-shocked": "Battle-shocked",
    "embarked": "embarked",
    "in-strategic-reserves": "in Strategic Reserves",
    "in-cult-ambush": "in Cult Ambush",
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


# Kinds of rule a ``used`` filter can name one member of, as "the X <noun>" (an ability is its
# name alone).
_NAMED_USE_NOUNS: dict[str, str] = {
    "manoeuvre": "Agile Manoeuvre",
    "stratagem": "Stratagem",
    "action": "action",
}


def named_use_phrase(f: P) -> str | None:
    """One named rule a ``used`` filter names by id ("Reanimation Protocols", "the Swift as
    the Wind Agile Manoeuvre"), or None."""
    if f.get("id") is None:
        return None
    if f.get("kind") == "ability":
        return id_label(f["id"])
    noun = _NAMED_USE_NOUNS.get(_str(f.get("kind")))
    return None if noun is None else f"the {id_label(f['id'])} {noun}"


def used_ability_phrase(f: P) -> str | None:
    """Which ability a ``used`` filter names, including source and usage limits."""
    if f.get("ability_keyword") is not None:
        base = f"a {title_case(_str(f['ability_keyword']).lower())} ability"
    elif f.get("same_rule_as") is not None:
        base = f"that same {'Stratagem' if f.get('kind') == 'stratagem' else 'ability'}"
    elif f.get("source") is not None or f.get("usage") is not None:
        base = named_use_phrase(f) or "an ability"
    else:
        return None
    sources = f.get("source")
    if isinstance(sources, list) and sources:
        labels = [
            (
                "its datasheet"
                if source == "unit"
                else "an Enhancement"
                if source == "enhancement"
                else dekebab(_str(source))
            )
            for source in sources
        ]
        base += f" from {_or_list(labels)}"
    usage = f.get("usage")
    if isinstance(usage, dict):
        from wh40kdc.translate.effect_inline import usage_clause

        base += f" that can be used {usage_clause(usage)}"
    return base


# "your opponent's deployment zone": a deployment zone is named by whose it is; other territories
# by their words.
_TERRITORY_PHRASES = {
    "your-deployment-zone": "your deployment zone",
    "enemy-deployment-zone": "your opponent's deployment zone",
    "no-mans-land": "no man's land",
}


def territory_phrase(territory: str) -> str:
    return _TERRITORY_PHRASES.get(territory, dekebab(territory))
