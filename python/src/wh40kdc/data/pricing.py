"""Unit point-cost maths shared by every consumer of the dataset.

Given a unit, a model count, and the unit's army ordinal, which ``points`` tier
applies.

11e prices some datasheets by **army ordinal** — how many copies of that
datasheet you have already taken. The schema models this with optional
``unit_count_min``/``unit_count_max`` bands on each ``points`` tier (1-based,
inclusive; an open-ended top band has ``unit_count_max: null``). Selecting a cost
is a two-step filter: keep the tiers whose ordinal band contains this copy, then
pick the highest model-count tier the count reaches. A tier with no
``unit_count_min`` is unbanded and applies to every copy (the common case).

Some units also carry ``allied_points`` — alternate tiers scoped to a
``host_faction`` that apply when the unit is fielded in another faction's army
(an Agents of the Imperium unit allied into any IMPERIUM army; a shared Space
Marine datasheet a chapter section reprices). :func:`host_points_tiers` selects
the tier table in effect for a host army and :func:`host_unit_points` prices
from it; :func:`base_unit_points` stays native-only for callers without army
context.

Python mirror of ``tools/src/data/pricing.ts`` /
``crates/wh40kdc/src/data/pricing.rs``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

Unit = dict[str, Any]
PointsTier = dict[str, Any]


def _tier_covers_ordinal(tier: PointsTier, ordinal: int) -> bool:
    """True when ``ordinal`` (1-based army copy) falls within ``tier``'s band."""
    minimum = tier.get("unit_count_min")
    if minimum is None:
        return True  # unbanded: applies to every copy
    if ordinal < minimum:
        return False
    maximum = tier.get("unit_count_max")
    return maximum is None or ordinal <= maximum


def base_unit_points(unit: Unit, model_count: int, ordinal: int = 1) -> int:
    """Base point cost for a unit of ``model_count`` models as its ``ordinal``-th copy.

    Among the tiers whose ordinal band covers this copy (1-based; defaults to the
    1st copy), returns the cost of the highest ``models`` threshold the count
    reaches (lowest tier when none is reached). ``models`` is the tier's range
    floor (a range-priced tier spans ``models``..``models_max`` at one cost, e.g.
    Venatari 4–6 @320), so a count inside a range resolves to that range's cost.
    Returns 0 when no tier applies — the caller surfaces a violation rather than
    guessing.
    """
    return _tier_cost(unit.get("points") or [], model_count, ordinal)


def _tier_cost(table: list[PointsTier], model_count: int, ordinal: int) -> int:
    """The two-step tier selection over an explicit tier table (native or allied)."""
    tiers = sorted(
        (t for t in table if _tier_covers_ordinal(t, ordinal)),
        key=lambda t: t["models"],
    )
    if not tiers:
        return 0
    chosen = tiers[0]
    for t in tiers:
        if model_count >= t["models"]:
            chosen = t
    return chosen["cost"]


def _keyword_slug(name: str) -> str:
    """``Imperium`` → ``imperium``: faction keywords are display names,
    ``host_faction`` values are id slugs."""
    return "-".join(name.strip().lower().split())


def host_points_tiers(unit: Unit, host_faction: Mapping[str, Any] | None) -> list[PointsTier]:
    """The points tiers in effect for a unit fielded in ``host_faction``'s army.

    A unit native to the host army (its ``faction_id`` IS the army's faction)
    always prices from ``points`` — ``allied_points`` only ever applies to a
    unit included in ANOTHER faction's army. For a foreign unit, entries whose
    ``host_faction`` names the army's faction id exactly win (a chapter
    reprice); otherwise entries naming a super-faction keyword the army's
    faction carries apply (an Agents unit's ``imperium`` price). With no
    matching entry — or no army context at all — the native table stands.
    """
    native = unit.get("points") or []
    entries = unit.get("allied_points") or []
    if host_faction is None or not entries:
        return native
    host_id = host_faction.get("id")
    if unit.get("faction_id") == host_id:
        return native
    exact = [t for t in entries if t.get("host_faction") == host_id]
    if exact:
        return exact
    owned = {_keyword_slug(k) for k in host_faction.get("keywords") or []}
    grouped = [t for t in entries if t.get("host_faction") in owned]
    return grouped if grouped else native


def host_unit_points(
    unit: Unit,
    model_count: int,
    ordinal: int = 1,
    host_faction: Mapping[str, Any] | None = None,
) -> int:
    """:func:`base_unit_points`, priced from the tier table in effect inside
    ``host_faction``'s army (see :func:`host_points_tiers`). With no
    ``host_faction`` this IS ``base_unit_points``. Size coverage is identical
    across tables (allied tiers reprice the native sizes), so
    :func:`points_tier_missing` stays native-only.
    """
    return _tier_cost(host_points_tiers(unit, host_faction), model_count, ordinal)


def points_tier_missing(unit: Unit, model_count: int, ordinal: int = 1) -> bool:
    """True when no points tier covers ``model_count`` for this ``ordinal``.

    The count falls outside every tier's ``[models, models_max]`` range (below the
    smallest tier, above the largest, or in a gap between non-contiguous tiers),
    or the ordinal has no banded price. A single-size tier (no ``models_max``)
    covers only ``models``. Mirrors the band filter of :func:`base_unit_points`.
    """
    tiers = [t for t in unit.get("points") or [] if _tier_covers_ordinal(t, ordinal)]
    if not tiers:
        return True
    return not any(
        t["models"] <= model_count <= (t.get("models_max") or t["models"]) for t in tiers
    )


def wargear_points(unit: Unit, counts: Mapping[str, int]) -> int:
    """Per-item MFM wargear surcharge for a unit whose final loadout has ``counts``
    copies of each weapon/wargear id.

    Each ``wargear_costs`` entry charges ``cost`` for every copy of ``item_id``
    present — a Terminator Assault Squad's five thunder hammers add 25, a Chapter
    Ancient's Banner of Macragge adds 10. Items with no cost entry are free; absent
    ``wargear_costs`` contributes 0, so a unit's total is
    ``base_unit_points + wargear_points + enhancement``. Mirror of
    ``tools/src/data/pricing.ts`` ``wargearPoints``.
    """
    total = 0
    for wc in unit.get("wargear_costs") or []:
        total += wc["cost"] * max(0, counts.get(wc["item_id"], 0))
    return total
