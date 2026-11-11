"""Warlord eligibility from the per-model Warlord flags on unit-composition
rows (``cannot_be_warlord``, ``can_be_non_character_warlord``,
``is_supreme_commander``). The core rules select a CHARACTER model as
Warlord; an army that includes Supreme Commander units must pick one of
them; and "cannot be your Warlord" outranks "must be your Warlord".
Mirror of TS ``tools/src/data/roster-warlord.ts``.
"""

from __future__ import annotations

from typing import Any


def _cannot_lead(unit: dict[str, Any]) -> bool:
    """True when no model of the unit can be the Warlord."""
    rows = unit["rows"]
    return bool(rows) and all(m.get("cannot_be_warlord") is True for m in rows)


def warlord_violations(
    units: list[dict[str, Any] | None],
    detachment_warlords: set[str],
) -> list[tuple[str, str, str, int | None]]:
    """Warlord violations as ``(code, id, message, unit_index)``.

    ``units`` is indexed like the roster (``None`` for an unresolved unit);
    each entry has ``unit_id``, ``is_warlord``, ``is_character`` and the
    composition model ``rows``. ``detachment_warlords`` holds the datasheets a
    selected detachment names for Warlord; naming lifts ``cannot_be_warlord``.
    """
    out: list[tuple[str, str, str, int | None]] = []

    def barred(u: dict[str, Any]) -> bool:
        return _cannot_lead(u) and u["unit_id"] not in detachment_warlords

    for idx, u in enumerate(units):
        if u is None or not u["is_warlord"]:
            continue
        uid = u["unit_id"]
        if barred(u):
            out.append(("cannot-be-warlord", uid, f"{uid} cannot be your Warlord", idx))
        if not u["is_character"] and not any(
            m.get("can_be_non_character_warlord") is True for m in u["rows"]
        ):
            out.append(
                (
                    "warlord-not-character",
                    uid,
                    f"{uid} is not a Character and cannot be your Warlord",
                    idx,
                )
            )
    # Checked only when a Warlord is chosen; a missing one is ``no-warlord``.
    if not any(u is not None and u["is_warlord"] for u in units):
        return out
    supreme = [
        u
        for u in units
        if u is not None
        and not barred(u)
        and any(
            m.get("is_supreme_commander") is True and m.get("cannot_be_warlord") is not True
            for m in u["rows"]
        )
    ]
    if supreme and not any(u["is_warlord"] for u in supreme):
        ids = sorted({u["unit_id"] for u in supreme})
        out.append(
            (
                "warlord-not-supreme-commander",
                "+".join(ids),
                f"the Warlord must be one of: {', '.join(ids)}",
                None,
            )
        )
    return out
