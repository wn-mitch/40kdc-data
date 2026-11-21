"""A unit filter as the predicate of a ``matches`` subject. Mirror of
``filterPredicate`` in ``tools/src/translate/condition.ts``."""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_refs import unit_filter_phrase

_CLAUSE_LEAD = re.compile(r"^(?:wholly within|within|not within|embarked within|in) ")


def filter_predicate(f: dict[str, Any], noun: str, negated: bool) -> str:
    """A one-clause filter as the predicate of a subject that is already a unit
    or model: "the triggering unit is within Engagement Range of ..." and "the
    unit is enfeebled by this model", not "is a unit within ...". A noun the
    filter qualifies ("a friendly INFANTRY unit", "a unit with the X keyword")
    stays, as does one with several clauses (each keeps qualifying the noun), one
    whose clause is a noun phrase of its own ("a unit that is a PSYKER unit or
    ..."), or one whose clause is itself negative when the predicate is
    negated."""
    phrase = unit_filter_phrase(f)
    clauses = [
        k
        for k, v in f.items()
        if v is not None and k not in ("level", "designated_by", "has_ability_models")
    ]
    bare = f"a {noun} "
    if len(clauses) != 1 or not phrase.startswith(bare):
        return phrase
    rest = phrase[len(bare) :]
    if rest.startswith("that is "):
        clause: str | None = rest[len("that is ") :]
    elif _CLAUSE_LEAD.match(rest):
        clause = rest
    else:
        clause = None
    if (
        clause is None
        or clause.startswith(("a ", "an "))
        or (negated and clause.startswith("not "))
    ):
        return phrase
    return clause
