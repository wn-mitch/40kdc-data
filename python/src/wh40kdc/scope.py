"""Roster-highlighting scope: resolve which units an ability benefits from its
curated static keyword subset.

``applies_to`` is intentionally not scraped from runtime effects. A missing or
null filter matches nothing; an explicit empty object matches every unit.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

__all__ = ["ability_applies_to_unit", "unit_matches_applies_to"]


def unit_matches_applies_to(
    applies_to: dict[str, Any] | None,
    owned_keywords: Iterable[str],
) -> bool:
    """Match canonical all/any/none keyword subsets."""
    if applies_to is None:
        return False
    owned = {keyword_key(kw) for kw in owned_keywords}
    all_of = applies_to.get("all_of") or []
    any_of = applies_to.get("any_of") or []
    none_of = applies_to.get("none_of") or []
    not_all_of = applies_to.get("not_all_of") or []
    if any(keyword_key(kw) not in owned for kw in all_of):
        return False
    if any_of and not any(keyword_key(kw) in owned for kw in any_of):
        return False
    if any(keyword_key(kw) in owned for kw in none_of):
        return False
    if not_all_of and all(keyword_key(kw) in owned for kw in not_all_of):
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
