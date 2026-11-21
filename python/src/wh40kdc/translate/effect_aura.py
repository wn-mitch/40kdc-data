"""Aura reach: who an aura affects and where, for the aura clause and recipient triggers."""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_refs import range_phrase
from wh40kdc.translate.effect_words import filter_subject, jstr, or_list

Effect = dict[str, Any]


def _obj(v: Any) -> dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _aura_emitter(value: Any, origin: str) -> str:
    """Who an aura is measured from.

    A filter that names an owner is army-wide: any of that side's models with its keywords
    ("one or more friendly DEATH GUARD models"; owner any names no side). Without one it
    narrows the aura's own origin (this model, or this unit).
    """
    if not isinstance(value, dict) or not isinstance(value.get("owner"), str):
        return _keyword_filter_clause(value, origin)
    rest = dict(value)
    owner = rest.pop("owner")
    all_of = rest.pop("all_of", None)
    any_of = rest.pop("any_of", None)
    none_of = rest.pop("none_of", None)
    all_list = [jstr(k) for k in all_of] if isinstance(all_of, list) else []
    none_list = [jstr(k) for k in none_of] if isinstance(none_of, list) else []
    any_list = [jstr(k) for k in any_of] if isinstance(any_of, list) else []
    if any(k in all_list for k in any_list):
        any_list = []
    elif none_list:
        any_list = [k for k in any_list if k not in none_list]
    if len(any_list) == 1:
        all_list.append(any_list[0])
        any_list = []
    side = "" if owner == "any" else f" {owner}"
    keywords = "".join(f" {keyword}" for keyword in all_list)
    remaining: dict[str, Any] = dict(rest)
    if any_list:
        remaining["any_of"] = any_list
    if none_list:
        remaining["none_of"] = none_list
    return _keyword_filter_clause(remaining, f"one or more{side}{keywords} models", all_list)


def _keyword_filter_clause(
    value: Any, noun: str, already_all: list[str] | None = None
) -> str:
    if not isinstance(value, dict):
        return noun
    relations = dict(value)
    all_of = relations.pop("all_of", None)
    any_of = relations.pop("any_of", None)
    none_of = relations.pop("none_of", None)
    not_all = relations.pop("not_all_of", None)
    extra_all = [jstr(k) for k in all_of] if isinstance(all_of, list) else []
    all_list = [*(already_all or []), *extra_all]
    none_list = [jstr(k) for k in none_of] if isinstance(none_of, list) else []
    any_list = [jstr(k) for k in any_of] if isinstance(any_of, list) else []
    if any(k in all_list for k in any_list):
        any_list = []
    elif none_list:
        any_list = [k for k in any_list if k not in none_list]
    if len(any_list) == 1:
        extra_all.append(any_list[0])
        any_list = []
    all_text = f" with {' and '.join(extra_all)}" if extra_all else ""
    any_text = f" with the {or_list(any_list)} keyword" if any_list else ""
    none_text = f" (excluding {or_list(none_list)} models)" if none_list else ""
    not_all_text = (
        f" without all of {' and '.join(map(jstr, not_all))}"
        if isinstance(not_all, list)
        else ""
    )
    other = f" matching {filter_subject(relations)}" if relations else ""
    return f"{noun}{all_text}{any_text}{none_text}{not_all_text}{other}"


def aura_reach(e: Effect, m: dict[str, Any]) -> tuple[str, str]:
    """Who an aura reaches and where: ("an enemy unit", 'within 6" of this unit')."""
    range_text = range_phrase(m["range"]) if m.get("range") is not None else "range"
    capped = (
        f" (to a maximum of {range_phrase(m['range_cap'])}, extensions included)"
        if m.get("range_cap") is not None
        else ""
    )
    owner = "friendly" if e.get("target") == "friendly-within-aura" else "enemy"
    recipient_filter = m.get("eligible", m.get("recipient_filter", {}))
    subject = filter_subject({"owner": owner, **_obj(recipient_filter)})
    subject = (
        subject.removeprefix("all ")
        .replace(" units", " unit", 1)
        .replace(" models", " model", 1)
        .replace("that are", "that is", 1)
    )
    eligible_who = f"{'an' if re.match(r'^[aeiou]', subject, re.I) else 'a'} {subject}"
    recipient = (
        _keyword_filter_clause(m["recipient_filter"], eligible_who)
        if m.get("eligible") is not None and m.get("recipient_filter") is not None
        else eligible_who
    )
    # Without a range bonus, of names the unit the range is measured from; this model by default.
    origin = "this unit" if m.get("of") == "this-unit" else "this model"
    emitter = (
        _aura_emitter(m["emitter_filter"], origin)
        if m.get("emitter_filter") is not None
        else origin
    )
    wholly = "wholly " if m.get("wholly") is True else ""
    return recipient, f"{wholly}within {range_text}{capped} of {emitter}"


def first_aura(e: Any) -> Effect | None:
    """The first aura an effect applies through its conditions, sequences and parts."""
    if not isinstance(e, dict):
        return None
    if e.get("type") == "aura":
        return e if _obj(e.get("modifier")).get("range_bonus") is None else None
    steps = e.get("steps")
    for child in [e.get("effect"), *(steps if isinstance(steps, list) else [])]:
        aura = first_aura(child)
        if aura is not None:
            return aura
    return None


def with_aura_recipient(t: dict[str, Any], effect: Any) -> dict[str, Any]:
    """A trigger whose subject is the aura's recipient names the unit the aura reaches.

    ("an enemy unit within 6\" of this unit"), carried to the trigger describer as
    ``{aura_recipient}``.
    """
    if t.get("subject") != "recipient":
        return t
    aura = first_aura(effect)
    if aura is None:
        return t
    recipient, within = aura_reach(aura, _obj(aura.get("modifier")))
    return {**t, "subject": {"aura_recipient": f"{recipient} {within}"}}
