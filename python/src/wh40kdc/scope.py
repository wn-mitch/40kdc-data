"""Roster-highlighting scope: resolve which units an ability (typically a
detachment rule) benefits, from its curated ``applies_to`` keyword filter.

This is the contract consumers replicate: a unit matches iff it carries every
``required_keywords`` entry and none of the ``excluded_keywords``, compared
against the union of its ``keywords`` and ``faction_keywords``. Keywords compare
without regard to case or apostrophe style (:func:`keyword_key`): rules print them
uppercase, as ``applies_to`` spells them, while units store datasheet spelling.

Two distinct "no constraint" forms, both deliberate:
  - a ``None``/absent filter has no resolvable scope and matches nothing (the
    app renders no highlight rather than guess);
  - a present filter with neither keyword list constrains nothing and matches
    every unit (vacuous required/excluded sets).

Mirrors ``tools/src/scope.ts`` (TS) and ``wh40kdc::scope`` (Rust); pinned
byte-for-byte across the ports by the ``conformance/applies-to`` corpus (bump
``conformance/SPEC_VERSION`` on change).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

__all__ = ["ability_applies_to_unit", "unit_matches_applies_to"]


def unit_matches_applies_to(
    applies_to: dict[str, Any] | None,
    owned_keywords: Iterable[str],
) -> bool:
    """True when a unit owning ``owned_keywords`` (the union of its ``keywords``
    and ``faction_keywords``) falls within ``applies_to``'s scope. See the module
    docstring for the ``None``-vs-empty-filter semantics."""
    if applies_to is None:
        return False
    owned = {keyword_key(kw) for kw in owned_keywords}
    if any(keyword_key(kw) not in owned for kw in applies_to.get("required_keywords") or []):
        return False
    if any(keyword_key(kw) in owned for kw in applies_to.get("excluded_keywords") or []):
        return False
    return True


def keyword_key(keyword: str) -> str:
    """How two keyword spellings compare.

    Uppercase, with a curly apostrophe read as a straight one.
    """
    return keyword.upper().replace("’", "'")


def ability_applies_to_unit(applies_to: dict[str, Any] | None, unit: dict[str, Any]) -> bool:
    """Convenience over :func:`unit_matches_applies_to` for a unit dict: unions
    the unit's ``keywords`` and ``faction_keywords`` and applies the filter."""
    owned = [*(unit.get("keywords") or []), *(unit.get("faction_keywords") or [])]
    return unit_matches_applies_to(applies_to, owned)
