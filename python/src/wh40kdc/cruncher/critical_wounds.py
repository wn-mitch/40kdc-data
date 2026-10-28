"""Critical wounds with their own AP and Damage.

A buff gated ``onCritical: "wound"`` applies only to the attacks that score a critical wound, so
those wounds take their save at their own AP and deal their own Damage, and with Devastating
Wounds their mortal wounds deal that Damage. Python mirror of
``tools/src/cruncher/critical-wounds.ts``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from typing import Any

from wh40kdc.cruncher.buffs import resolve_buffs


def has_critical_wound_buffs(buffs: Iterable[Any]) -> bool:
    """Whether any buff applies only on a critical wound."""
    return any((buff.get("applicableWhen") or {}).get("onCritical") == "wound" for buff in buffs)


def resolve_critical_wound(buffs: list[Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """The buffs resolved for an attack that scored a critical wound."""
    return resolve_buffs(buffs, {**ctx, "criticalRoll": "wound"})


def attack_ap(resolved: dict[str, Any], printed_ap: float) -> float:
    """The AP an attack has under ``resolved``; worsening AP stops at 0."""
    set_ap = resolved["statSet"].get("AP")
    return min(0, (set_ap["value"] if set_ap is not None else printed_ap) + resolved["apMod"]["value"])


def split_unsaved(
    streams: Sequence[dict[str, float]],
    reroll_one_dice: Callable[[float, float], float],
    reroll_one: bool,
) -> tuple[float, float]:
    """The expected unsaved wounds of streams that take the same save at different targets, with a
    "re-roll one saving throw" spent on the stream a failed save is likelier to come from. Each
    stream gives its ``wounds``, save chance ``saved``, re-rollable failure chance ``open`` and
    re-rolled save chance ``fresh``. Returns the unsaved wounds and the re-rolled dice."""
    unsaved = sum(s["wounds"] * (1 - s["saved"]) for s in streams)
    if not reroll_one:
        return unsaved, 0.0
    pool = sum(s["wounds"] for s in streams)
    failing = sum(s["wounds"] * s["open"] for s in streams)
    if pool <= 0 or failing <= 0:
        return unsaved, 0.0
    dice = reroll_one_dice(pool, failing / pool)
    # The re-rolled save comes from each stream in proportion to its re-rollable failures.
    unsaved -= dice * sum(s["wounds"] * s["open"] * s["fresh"] for s in streams) / failing
    return unsaved, dice


def mix_distributions(parts: Sequence[tuple[float, Sequence[dict[str, float]]]]) -> list[dict[str, float]]:
    """Per-roll damage distributions mixed by weight, ascending by value with each value once, as
    ``one_damage_reroll_gain`` reads them."""
    total = sum(weight for weight, _ in parts)
    by_value: dict[float, float] = {}
    for weight, distribution in parts:
        for outcome in distribution:
            share = outcome["probability"] * weight / total if total > 0 else 0.0
            by_value[outcome["value"]] = by_value.get(outcome["value"], 0.0) + share
    return [{"value": v, "probability": p} for v, p in sorted(by_value.items())]
