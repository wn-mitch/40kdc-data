"""Battle-size → points/detachment caps, in one place.

11e battle sizes set both the army points ceiling and the detachment-point
budget: ``incursion`` = 1000 pts / 2 DP, ``strike-force`` = 2000 pts / 3 DP.
Centralised so the roster-legality checker, the affordability primitive, and
the importers agree on a single source of truth.

Python mirror of ``tools/src/data/battle-sizes.ts`` /
``crates/wh40kdc/src/data/battle_sizes.rs`` / ``go/battle_sizes.go``.
"""

from __future__ import annotations


def points_limit_for_battle_size(battle_size: str | None) -> int | None:
    """Army points ceiling for a battle size; ``None`` when the size is unknown."""
    if battle_size == "strike-force":
        return 2000
    if battle_size == "incursion":
        return 1000
    return None


def detachment_cap_for_battle_size(battle_size: str | None) -> int | None:
    """11e detachment-point budget for a battle size; ``None`` when unknown."""
    if battle_size == "strike-force":
        return 3
    if battle_size == "incursion":
        return 2
    return None


def unit_limit_for_battle_size(battle_size: str | None) -> int | None:
    """11e unit limit per datasheet (incursion 2, strike-force 3); BATTLELINE and
    DEDICATED TRANSPORT double it, every EPIC HERO is limited to 1. ``None`` when unknown.
    """
    if battle_size == "strike-force":
        return 3
    if battle_size == "incursion":
        return 2
    return None


def enhancement_limit_for_battle_size(battle_size: str | None) -> int | None:
    """11e Enhancement limit (incursion 2, strike-force 4); ``None`` when unknown."""
    if battle_size == "strike-force":
        return 4
    if battle_size == "incursion":
        return 2
    return None
