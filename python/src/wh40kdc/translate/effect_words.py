"""The shared words of the effect describer: the rendering context, subject phrases for
effect targets, verb agreement, and the name tables for characteristics, rolls, tests and
pools.

ASCII-only; pinned byte-for-byte across the ports by ``conformance/effect-translation``.
Python mirror of ``tools/src/translate/effect-words.ts``.
"""

from __future__ import annotations

import math
import re
from typing import Any

from wh40kdc.translate.condition_refs import (
    _and_list as and_list,
)
from wh40kdc.translate.condition_refs import (
    _designation_phrase,
    _state_phrase,
    dekebab,
    range_phrase,
    title_case,
)
from wh40kdc.translate.condition_refs import (
    _or_list as or_list,
)
from wh40kdc.translate.designations import designation_label

__all__ = ["and_list", "dekebab", "or_list", "range_phrase", "title_case"]

# Rendering context threaded from the containers to the leaves. Keys:
# ``selectedUnit`` / ``selectedModel`` (inside a selection), ``unitSubject`` (explicit
# beneficiary binding inside a designated attack), ``auraRecipient`` (inside an aura).
Ctx = dict[str, Any]


def jstr(v: Any) -> str:
    """JS-template stringification (numbers print without trailing ``.0``)."""
    if v is None:
        return "?"
    if isinstance(v, list):
        return ", ".join(jstr(x) for x in v)
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def num(v: Any) -> float:
    """JS ``Number(v)``: NaN for non-numeric, 0 for null and blank strings."""
    if v is None:
        return 0.0
    if v is True:
        return 1.0
    if v is False:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0.0
        try:
            return float(s)
        except ValueError:
            return math.nan
    return math.nan


def num_str(n: float) -> str:
    """JS ``String(n)`` for a number."""
    if math.isnan(n):
        return "NaN"
    return str(int(n)) if n.is_integer() else str(n)


def is_num(v: Any) -> bool:
    """JS ``typeof v === "number"``."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def capitalize(s: str) -> str:
    """Uppercase the first character (idempotent; leaves the rest untouched)."""
    return s if s == "" else s[0].upper() + s[1:]


def dice_case(v: Any) -> str:
    """Dice tokens print with a capital ``D`` (``d3`` → ``D3``); a bound or counted
    quantity prints its phrase."""
    if isinstance(v, dict):
        from wh40kdc.translate.effect_quantity import quantity_phrase

        return quantity_phrase(v)
    return re.sub(r"d", "D", jstr(v), flags=re.IGNORECASE)


def bracket_keyword(k: Any) -> str:
    """A GW weapon keyword token → bracketed caps (``lethal-hits`` → ``[LETHAL HITS]``)."""
    raw = jstr(k).strip()
    anti = re.match(r"^anti[\s-]+(.*)$", raw, re.IGNORECASE | re.DOTALL)
    if anti:
        m = re.match(r"^(.*?)[\s-]*(\d+)\s*(?:\+|plus)?$", anti.group(1), re.IGNORECASE | re.DOTALL)
        if m:
            return f"[ANTI-{dekebab(m.group(1)).strip().upper()} {m.group(2)}+]"
        return f"[ANTI-{dekebab(anti.group(1)).strip().upper()}]"
    return f"[{dekebab(raw).upper()}]"


_TEST_NAMES = {"battle-shock": "Battle-shock", "desperate-escape": "Desperate Escape"}


def test_name(test: Any) -> str:
    t = jstr(test)
    return _TEST_NAMES.get(t, title_case(t))


test_name.__test__ = False  # type: ignore[attr-defined]  # not a pytest test


def is_plural(subj: str) -> bool:
    """Does a subject noun phrase take a plural verb?"""
    return (
        bool(re.search(r" (units|models)\b", subj))
        or subj.startswith("all ")
        or subj.startswith("targets ")
    )


_PLURAL_VERBS = {
    "has": "have",
    "is": "are",
    "gets": "get",
    "gains": "gain",
    "suffers": "suffer",
    "retains": "retain",
    "makes": "make",
    "passes": "pass",
    "fails": "fail",
    "treats": "treat",
    "regains": "regain",
    "counts": "count",
    "ignores": "ignore",
    "loses": "lose",
    "scores": "score",
    "takes": "take",
    "resolves": "resolve",
    "does": "do",
    "controls": "control",
    "receives": "receive",
    "keeps": "keep",
}


def v(subj: str, singular: str) -> str:
    """Subject-verb agreement: the plural form of a present-tense verb for a plural subject."""
    if not is_plural(subj):
        return singular
    return _PLURAL_VERBS.get(singular, re.sub(r"s$", "", singular))


_STAT_NAMES = {
    "M": "Move",
    "T": "Toughness",
    "Sv": "Save",
    "W": "Wounds",
    "A": "Attacks",
    "Ld": "Leadership",
    "OC": "Objective Control",
    "S": "Strength",
    "WS": "Weapon Skill",
    "BS": "Ballistic Skill",
    "AP": "Armour Penetration",
    "D": "Damage",
    "Range": "Range",
    "detection-range": "detection range",
}


def stat_name(stat: Any) -> str:
    s = jstr(stat)
    return _STAT_NAMES.get(s, title_case(s))


def pool_name(pool: Any) -> str:
    """Resource-pool token → display name (``cp`` → ``CP``, otherwise Title Case)."""
    p = jstr(pool)
    return "CP" if p.lower() == "cp" else title_case(p)


# The unit of resource a pool holds, singular, for pools whose id does not name it.
_POOL_UNITS = {"blood-tithe": "Blood Tithe point", "battle-focus": "Battle Focus token", "yp": "YP"}
# Countable nouns a pool id can end in: singular → plural.
_POOL_NOUNS = {
    "dice": ("die", "dice"),
    "die": ("die", "dice"),
    "token": ("token", "tokens"),
    "tokens": ("token", "tokens"),
    "point": ("point", "points"),
    "points": ("point", "points"),
    "marker": ("marker", "markers"),
}


def resource_noun(pool: Any, label: Any, count: Any = None) -> str:
    """A pool's noun: its author label (pluralized by count), else the resource the pool holds —
    "1 Miracle die", "2 Pain tokens" — never the pool itself ("1 Miracle Dice Pool")."""
    one = num(jstr(count)) == 1
    if isinstance(label, str) and len(label) > 0:
        return label if one else f"{label}s"
    pid = jstr(pool).lower()
    if pid == "cp":
        return "CP"
    base = re.sub(r"-pool$", "", pid)
    unit = _POOL_UNITS.get(base)
    if unit:
        return unit if unit == "YP" or one else f"{unit}s"
    words = base.split("-")
    noun = _POOL_NOUNS.get(words[-1])
    if not noun:
        return title_case(base)
    head = title_case("-".join(words[:-1]))
    return f"{f'{head} ' if head else ''}{noun[0] if one else noun[1]}"


_ROLL_NAMES = {
    "hit": "Hit",
    "wound": "Wound",
    "charge": "Charge",
    "damage": "Damage",
    "advance": "Advance",
    "save": "saving throw",
    "leadership": "Leadership",
    "battle-shock": "Battle-shock",
    "desperate-escape": "Desperate Escape",
    "normal-move": "Normal move",
    "deadly-demise": "Deadly Demise",
    "dark-pact": "Dark Pact",
    "blessings-of-khorne": "Blessings of Khorne",
    "resource-die": "pool die",
    "manoeuvre": "Agile Manoeuvre",
    "channelling": "Channel the Warp",
}


def roll_name(roll: Any) -> str:
    # The dice a named ability rolls: "Reanimation Protocols".
    if isinstance(roll, dict) and roll.get("of_ability") is not None:
        return ability_label(roll["of_ability"])
    r = jstr(roll)
    return _ROLL_NAMES.get(r, title_case(r))


def signed(operation: Any, value: Any) -> str:
    """``+1`` / ``-1`` from an operation + value (a negative value flips the sign)."""
    sign = 1 if operation in ("add", "improve") else -1
    n = num(value)
    if not math.isnan(n) and n < 0:
        sign = -sign
        value = num_str(abs(n))
    return f"{'+' if sign > 0 else '-'}{dice_case(value)}"


def format_comparison(comp: str, threshold: Any) -> str:
    """Dice comparison → "a 4+", "a 3 or less", etc."""
    th = jstr(threshold)
    if comp == "lte":
        return f"a {th} or less"
    if comp == "gt":
        return f"greater than {th}"
    if comp == "lt":
        return f"less than {th}"
    if comp == "eq":
        return f"exactly {th}"
    return f"a {th}+"


def possessive(s: str) -> str:
    """Possessive form of a subject noun phrase (``the unit`` → ``the unit's``)."""
    return f"{s}'" if s.endswith("s") else f"{s}'s"


def of_or_possessive(subj: str, rest: str) -> str:
    """``<subj>'s <rest>``, or ``the <rest> of <subj>`` when the subject ends in a clause."""
    if re.search(r" (within|other than|that|with) ", subj) or subj.endswith('"'):
        return f"the {rest} of {subj}"
    return f"{possessive(subj)} {rest}"


def none_of(subj: str) -> str:
    """The subject of a "cannot" clause: "all enemy units cannot …" reads "enemy units cannot …"."""
    return re.sub(r"^all ", "", subj)


def pronoun(subj: str) -> str:
    """Possessive pronoun agreeing with the subject (``its`` / ``their``)."""
    return "their" if is_plural(subj) else "its"


_ABILITY_LABELS = {"nurgle-s-gift-aura": "Nurgle's Gift (Aura)", "fights-first": "Fights First"}


def ability_label(id: Any) -> str:
    """The display label for an ability id: a curated override, else Title Case."""
    return _ABILITY_LABELS.get(jstr(id), title_case(jstr(id)))


_WEAPON_LABELS = {"imperiums-sword": "Imperium's Sword"}


def weapon_label(id: Any) -> str:
    """The display name for a granted weapon id: a curated override, else Title Case."""
    return _WEAPON_LABELS.get(jstr(id), title_case(jstr(id)))


def weapon_noun(m: dict[str, Any]) -> str:
    """ "melee weapons", "ranged Bolt Rifle weapons with [PISTOL]" — a weapon filter as a noun."""
    kind = f"{jstr(m['weapon_type'])} " if m.get("weapon_type") else ""
    keyword = f" with [{jstr(m['weapon_keyword']).upper()}]" if m.get("weapon_keyword") else ""
    # A name that already carries the noun ("hellforged weapons") must not read "weapons weapons".
    raw = (
        re.sub(r"\s+weapons?$", "", jstr(m["weapon_name"]), flags=re.IGNORECASE)
        if m.get("weapon_name")
        else ""
    )
    named = title_case(raw) if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", raw) else raw
    ref = m.get("weapon_ref")
    if ref is not None:
        # A bound weapon ("the selected weapon") or the weapons picked for a named ability.
        sel = ref.get("selected_by") if isinstance(ref, dict) else None
        if sel is not None:
            ability = sel.get("ability") if isinstance(sel, dict) else None
            return f"the {kind}weapons selected for {ability_label(ability)}{keyword}"
        return f"the selected {kind}weapon{keyword}"
    return f"{kind}{f'{named} ' if named else ''}weapons{keyword}"


def has_weapon(m: dict[str, Any]) -> bool:
    """Whether a modifier carries a weapon filter."""
    return (
        m.get("weapon_type") is not None
        or m.get("weapon_name") is not None
        or m.get("weapon_keyword") is not None
        or m.get("weapon_ref") is not None
    )


def weapon_roll_scope(m: dict[str, Any]) -> str:
    """ " with melee weapons" for a roll scoped to a weapon filter, else ""."""
    return f" with {weapon_noun(m)}" if has_weapon(m) else ""


_ROLE_SUBJECTS = {
    "this-model": "this model",
    "model-in-this-unit": "a model in this unit",
    "defender": "the target",
    "event-subject": "the triggering unit",
    "event-object": "that unit",
    "stratagem-target": "that unit",
    "bearer-transport": "the Transport this unit is embarked within",
    "ability-unit": "this unit",
}


def filter_subject(f: dict[str, Any], ctx: Ctx | None = None) -> str:
    """A unit filter as the plural subject of an effect: ``friendly INFANTRY units within 6"``."""
    ctx = ctx or {}
    owner = (
        "friendly "
        if f.get("owner") == "friendly"
        else "enemy "
        if f.get("owner") == "enemy"
        else ""
    )
    all_of = f.get("all_of")
    all_s = f"{' '.join(jstr(x) for x in all_of)} " if isinstance(all_of, list) else ""
    noun = "models" if f.get("level") == "model" else "units"
    s = f"{owner}{all_s}{noun}"
    if isinstance(f.get("any_of"), list):
        s += f" with the {or_list([jstr(x) for x in f['any_of']])} keyword"
    if isinstance(f.get("none_of"), list):
        s += f" (excluding {or_list([jstr(x) for x in f['none_of']])} {noun})"
    within = f.get("within")
    if within is not None:
        w = within if isinstance(within, dict) else {}
        of = f" of {effect_subject(w['of'], ctx)}" if w.get("of") is not None else ""
        wholly = "wholly " if w.get("wholly") is True else ""
        s += f" {wholly}within {range_phrase(w.get('range'))}{of}"
    s += _filter_relations(f, ctx)
    if f.get("visible") is True:
        s += " that are visible"
    if f.get("designated") is not None:
        by = (
            f" by {effect_subject(f['designated_by'], ctx)}"
            if f.get("designated_by") is not None
            else ""
        )
        s += f" that are {_designation_phrase(jstr(f['designated']), True)}{by}"
    if f.get("not_designated") is not None:
        s += f" that are not {_designation_phrase(jstr(f['not_designated']), True)}"
    if f.get("state") is not None:
        s += f" that are {_state_phrase(jstr(f['state']))}"
    if f.get("excluding") is not None:
        s += f" other than {effect_subject(f['excluding'], ctx)}"
    bounded = (
        within is not None
        or f.get("visible") is True
        or f.get("designated") is not None
        or f.get("not_designated") is not None
        or f.get("state") is not None
        or f.get("embarked_in") is not None
        or f.get("member_of") is not None
        or f.get("engaged_with") is not None
        or f.get("not_engaged_with") is not None
    )
    return s if bounded else f"all {s}"


def _filter_relations(f: dict[str, Any], ctx: Ctx) -> str:
    """A unit filter's relations to other units and abilities: " embarked within this model",
    " with the Deep Strike ability"."""
    s = ""
    if isinstance(f.get("has_ability"), list):
        s += f" with the {and_list([ability_label(a) for a in f['has_ability']])} ability"
    if isinstance(f.get("lacks_ability"), list):
        s += f" without the {or_list([ability_label(a) for a in f['lacks_ability']])} ability"
    if f.get("embarked_in") is not None:
        s += f" embarked within {effect_subject(f['embarked_in'], ctx)}"
    if f.get("member_of") is not None:
        s += f" in {effect_subject(f['member_of'], ctx)}"

    # "any other friendly unit": a filter excluding the unit with the ability reads "other".
    def engaged_with(g: Any) -> str:
        x = dict(g) if isinstance(g, dict) else {}
        other = x.get("excluding") in ("this-unit", "this-model")
        if other:
            del x["excluding"]
        phrase = re.sub(r"^all ", "", filter_subject(x, ctx), count=1)
        phrase = re.sub(r" units\b", " unit", phrase, count=1)
        phrase = re.sub(r" models\b", " model", phrase, count=1)
        return f"other {phrase}" if other else phrase

    if f.get("engaged_with") is not None:
        target = re.sub(
            r"^an? other ", "another ", _articled(engaged_with(f["engaged_with"])), count=1
        )
        s += f" within Engagement Range of {target}"
    if f.get("not_engaged_with") is not None:
        s += f" that are not within Engagement Range of any {engaged_with(f['not_engaged_with'])}"
    return s


def _articled(s: str) -> str:
    return f"{'an' if s[:1].lower() in ('a', 'e', 'i', 'o', 'u') and s else 'a'} {s}"


def effect_subject(target: Any, ctx: Ctx | None = None) -> str:
    """An effect target (a unit-ref) as the effect's subject."""
    ctx = ctx or {}
    if target is None or target == "this-unit":
        if ctx.get("unit_subject"):
            return ctx["unit_subject"]
        return "this unit" if ctx.get("selected_unit") or ctx.get("selected_model") else "the unit"
    if target == "selected-unit":
        if ctx.get("selected_model"):
            return "that model"
        return "that unit" if ctx.get("selected_unit") else "the selected unit"
    if target == "recipient":
        return "that unit" if ctx.get("aura_recipient") else "the unit"
    if target == "attacker":
        return ctx.get("unit_subject") or "the attacking unit"
    if isinstance(target, str):
        return _ROLE_SUBJECTS.get(target, dekebab(target))
    r = target if isinstance(target, dict) else {}
    if isinstance(r.get("event_var"), str):
        return "that unit"
    if isinstance(r.get("selection_var"), str):
        return f"the bound {jstr(r['selection_var']).replace('_', ' ')}"
    if isinstance(r.get("stratagem_target"), str):
        return f"the {dekebab(re.sub(r'^the-', '', r['stratagem_target']))} target"
    return filter_subject(r, ctx)


def weapon_holder(target: Any, ctx: Ctx) -> str:
    """Who carries a weapon filter's weapons: "this model", "models in this unit", …."""
    if target == "this-model":
        return "this model"
    if ctx.get("unit_subject") and (target is None or target in ("this-unit", "attacker")):
        return f"models in {ctx['unit_subject']}"
    if target == "selected-unit" and ctx.get("selected_model"):
        return "that model"
    if target is None or target == "this-unit":
        return "models in this unit"
    if target == "selected-unit":
        return "models in that unit" if ctx.get("selected_unit") else "models in the selected unit"
    return effect_subject(target, ctx)


def region_phrase(r: dict[str, Any]) -> str:
    """A region-ref as a place: "enemy territory", "the Ruins terrain area", "Plague Zone"."""
    if r.get("rule_region"):
        rr = r["rule_region"] if isinstance(r["rule_region"], dict) else {}
        return title_case(jstr(rr.get("region_id")))
    if r.get("territory"):
        return dekebab(jstr(r["territory"]))
    area = r.get("terrain_area")
    area = area if isinstance(area, dict) else {}
    where = (
        f"the {dekebab(jstr(area['footprint']))} terrain area"
        if area.get("footprint") is not None
        else "a terrain area"
    )
    if area.get("designated") is not None:
        where += f" tagged {dekebab(jstr(area['designated']))}"
    return where


def designation_for(tag: str) -> str:
    """A tag an effect applies: a registered id prints the rules' term, a legacy upper-case
    tag stays as printed, others read "marked as …"."""
    label = designation_label(tag)
    if label is not None:
        return label
    return tag if tag == tag.upper() else f"marked as {dekebab(tag)}"
