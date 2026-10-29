"""Enhancement bearer eligibility groups (mirror of TS ``meetsEnhancementGroups``)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any


def meets_enhancement_groups(
    enhancement: Mapping[str, Any], unit_id: str, has: Callable[[str], bool]
) -> bool:
    """Whether a bearer meets one eligibility group of ``enhancement``.

    A keyword group (``keyword_restriction_groups``, or the flat ``keyword_restrictions`` as one
    group) needs every keyword; a ``datasheet_restriction_groups`` entry needs the bearer's unit
    to be ``unit_id`` and every listed keyword. With no group of either kind any bearer
    qualifies.
    Exclusions are the caller's.
    """
    groups = enhancement.get("keyword_restriction_groups")
    if groups is None:
        flat = enhancement.get("keyword_restrictions")
        groups = [flat] if flat is not None else []
    datasheets = enhancement.get("datasheet_restriction_groups") or []
    if not groups and not datasheets:
        return True
    return any(all(has(k) for k in group) for group in groups) or any(
        group.get("unit_id") == unit_id and all(has(k) for k in group.get("keywords") or [])
        for group in datasheets
    )
