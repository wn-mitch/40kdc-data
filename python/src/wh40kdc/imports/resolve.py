"""Resolve a ``ParsedRoster`` onto 40kdc entity ids, producing a ``Roster``.

Resolution is lenient: a name that doesn't match a 40kdc entity yields a
resolved-ref with ``id: None``, ``resolved: False``, and up to five candidate
suggestions — the roster is never dropped or rejected. Everything that didn't
resolve cleanly is summarised in the diagnostics block.

Matching reuses the dataset's own lookups (``Collection.find`` /
``find_all`` / ``by_faction``) and ``normalize_name``; there is no bespoke
fuzzy matcher. Faction is resolved first so unit/detachment/enhancement
lookups can be scoped to it.

Python mirror of ``tools/src/import/resolve.ts``.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.data.dataset import Dataset
from wh40kdc.data.normalize import normalize_name

#: The dataset edition/dataslate stamped onto an imported roster.
ROSTER_GAME_VERSION = {"edition": "11th", "dataslate": "pre-launch-provisional"}

_MAX_CANDIDATES = 5


class _DiagnosticsBuilder:
    """Accumulates warnings and resolved/unresolved tallies during an import."""

    def __init__(self) -> None:
        self.resolved_units = 0
        self.unresolved_units = 0
        self.resolved_weapons = 0
        self.unresolved_weapons = 0
        self.warnings: list[dict[str, Any]] = []

    def warn(self, code: str, message: str, raw_name: str | None = None) -> None:
        self.warnings.append({"code": code, "message": message, "raw_name": raw_name})

    def build(self) -> dict[str, Any]:
        return {
            "resolved_units": self.resolved_units,
            "unresolved_units": self.unresolved_units,
            "resolved_weapons": self.resolved_weapons,
            "unresolved_weapons": self.unresolved_weapons,
            "warnings": self.warnings,
        }


def _unresolved(raw_name: str, candidates: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {
        "id": None,
        "raw_name": raw_name,
        "resolved": False,
        "candidates": candidates if candidates is not None else [],
    }


def _resolved(id: str, raw_name: str) -> dict[str, Any]:
    return {"id": id, "raw_name": raw_name, "resolved": True, "candidates": []}


def _to_candidates(records: list[Any]) -> list[dict[str, str]]:
    out = []
    for r in records[:_MAX_CANDIDATES]:
        if isinstance(r, dict):
            entry = {"id": r["id"]}
            # Mirror TS JSON semantics: an absent name drops the key entirely
            # (JSON.stringify elides undefined values).
            if r.get("name") is not None:
                entry["name"] = r["name"]
            out.append(entry)
        else:
            out.append({"id": r.id, "name": r.name})
    return out


def _map_battle_size(raw: str | None) -> str | None:
    """Map a source battle-size label to the 40kdc enum, if recognisable."""
    if not raw:
        return None
    key = normalize_name(raw)
    if "strike force" in key:
        return "strike-force"
    if "incursion" in key:
        return "incursion"
    return None


def _detachment_cap(battle_size: str | None) -> int | None:
    """11e detachment-point budget for a battle size; ``None`` when unknown."""
    if battle_size == "strike-force":
        return 3
    if battle_size == "incursion":
        return 2
    return None


def resolve(parsed: dict[str, Any], ds: Dataset, format: str = "listforge") -> dict[str, Any]:
    diag = _DiagnosticsBuilder()

    if parsed["multi_force"]:
        diag.warn(
            "multi-force",
            "Source list contains more than one faction; the primary faction was used "
            "for scoping.",
        )

    # --- Faction (resolved first so other lookups can scope to it). ----------
    faction_id: str | None = None
    if parsed["faction_raw_name"]:
        hit = ds.factions.find(parsed["faction_raw_name"])
        if hit:
            faction_id = hit.id
        else:
            diag.warn(
                "faction-unresolved",
                "Faction name did not match any 40kdc faction.",
                parsed["faction_raw_name"],
            )

    # --- Detachments (each scoped to faction, then global fallback). ---------
    # 11e lists may field several detachments under a detachment-point cap; the
    # list preserves source order. ``dp_cost`` is looked up from the resolved
    # detachment entity (no source format reports it).
    detachments: list[dict[str, Any]] = []
    for raw_name in parsed["detachment_raw_names"]:
        key = normalize_name(raw_name)
        scoped = None
        if faction_id:
            scoped = next(
                (
                    d
                    for d in ds.detachments.by_faction(faction_id)
                    if normalize_name(d.get("name") or "") == key
                ),
                None,
            )
        hit = scoped if scoped is not None else ds.detachments.find(raw_name)
        if hit is not None:
            detachments.append(
                {"ref": _resolved(hit["id"], raw_name), "dp_cost": hit.get("detachment_points")}
            )
        else:
            diag.warn(
                "detachment-unresolved",
                "Detachment name did not match any 40kdc detachment.",
                raw_name,
            )
            detachments.append(
                {
                    "ref": _unresolved(raw_name, _to_candidates(ds.detachments.find_all(raw_name))),
                    "dp_cost": None,
                }
            )
    detachment_ids = [d["ref"]["id"] for d in detachments if d["ref"]["id"] is not None]

    # --- Battle size. ---------------------------------------------------------
    battle_size = _map_battle_size(parsed["battle_size_raw"])
    if parsed["battle_size_raw"] and battle_size is None:
        diag.warn(
            "battle-size-unmapped",
            "Battle size label could not be mapped.",
            parsed["battle_size_raw"],
        )
    detachment_cap = _detachment_cap(battle_size)

    # --- Detachment-point cap check (only when cap and every cost are known). -
    if (
        detachment_cap is not None
        and detachments
        and all(d["dp_cost"] is not None for d in detachments)
    ):
        spent = sum(d["dp_cost"] for d in detachments)
        if spent > detachment_cap:
            diag.warn(
                "detachment-points-exceeded",
                f"Detachments cost {spent} detachment points but the {battle_size} "
                f"budget is {detachment_cap}.",
            )

    # --- Units (and their enhancements / wargear). ----------------------------
    units = [_resolve_unit(u, faction_id, detachment_ids, ds, diag) for u in parsed["units"]]

    # --- Leader attachments (second pass: needs all resolved unit ids). -------
    _infer_leader_attachments(parsed["units"], units, ds, diag)

    # --- Points reconciliation (reported vs computed kept distinct). ----------
    if parsed["total_reported"] is not None and parsed["total_reported"] != parsed[
        "total_computed"
    ]:
        diag.warn(
            "points-mismatch",
            f"Source-reported total ({parsed['total_reported']}) differs from the sum "
            f"of cost lines ({parsed['total_computed']}).",
        )

    return {
        "name": parsed["name"],
        "source": {"format": format, "generated_by": parsed["generated_by"]},
        "faction_id": faction_id,
        "detachments": detachments,
        "battle_size": battle_size,
        "points": {
            "declared_limit": parsed["declared_limit"],
            "detachment_cap": detachment_cap,
            "total_reported": parsed["total_reported"],
            "total_computed": parsed["total_computed"],
        },
        "units": units,
        "game_version": dict(ROSTER_GAME_VERSION),
        "diagnostics": diag.build(),
    }


def _resolve_unit(
    parsed: dict[str, Any],
    faction_id: str | None,
    detachment_ids: list[str],
    ds: Dataset,
    diag: _DiagnosticsBuilder,
) -> dict[str, Any]:
    # Prefer a faction-scoped match (the same unit id recurs across factions),
    # then fall back to a global name lookup.
    key = normalize_name(parsed["raw_name"])
    scoped = None
    if faction_id:
        scoped = next(
            (u for u in ds.units.by_faction(faction_id) if normalize_name(u.name) == key),
            None,
        )
    all_hits = ds.units.find_all(parsed["raw_name"])
    hit = scoped if scoped is not None else (all_hits[0] if all_hits else None)

    if hit is not None:
        ref = _resolved(hit.id, parsed["raw_name"])
        diag.resolved_units += 1
    else:
        ref = _unresolved(parsed["raw_name"], _to_candidates(all_hits))
        diag.unresolved_units += 1
        diag.warn("unit-unresolved", "Unit name did not match any 40kdc unit.", parsed["raw_name"])

    enhancement = (
        _resolve_enhancement(parsed["enhancement_raw_name"], detachment_ids, ds, diag)
        if parsed["enhancement_raw_name"]
        else None
    )
    enhancement_points = None if enhancement is None else parsed["enhancement_points"]

    wargear = []
    for w in parsed["wargear"]:
        hits = ds.weapons.find_all(w["raw_name"])
        if hits:
            diag.resolved_weapons += 1
            wargear.append({"ref": _resolved(hits[0].id, w["raw_name"]), "count": w["count"]})
        else:
            diag.unresolved_weapons += 1
            diag.warn(
                "weapon-unresolved",
                "Weapon name did not match any 40kdc weapon.",
                w["raw_name"],
            )
            wargear.append(
                {"ref": _unresolved(w["raw_name"], _to_candidates(hits)), "count": w["count"]}
            )

    return {
        "ref": ref,
        "model_count": parsed["model_count"],
        "points": parsed["points"],
        "is_warlord": parsed["is_warlord"],
        "enhancement": enhancement,
        "enhancement_points": enhancement_points,
        "wargear": wargear,
        "leader_attachment": None,
    }


def _resolve_enhancement(
    raw_name: str,
    detachment_ids: list[str],
    ds: Dataset,
    diag: _DiagnosticsBuilder,
) -> dict[str, Any]:
    key = normalize_name(raw_name)
    # Enhancements belong to a detachment, not a faction — scope to any of the
    # roster's resolved detachments.
    scoped = None
    if detachment_ids:
        scoped = next(
            (
                e
                for e in ds.enhancements.all
                if e.get("detachment_id") in detachment_ids
                and normalize_name(e.get("name") or "") == key
            ),
            None,
        )
    hit = scoped if scoped is not None else ds.enhancements.find(raw_name)
    if hit is not None:
        return _resolved(hit["id"], raw_name)
    diag.warn(
        "enhancement-unresolved",
        "Enhancement name did not match any 40kdc enhancement.",
        raw_name,
    )
    return _unresolved(raw_name, _to_candidates(ds.enhancements.find_all(raw_name)))


def _infer_leader_attachments(
    parsed_units: list[dict[str, Any]],
    units: list[dict[str, Any]],
    ds: Dataset,
    diag: _DiagnosticsBuilder,
) -> None:
    """Infer leader→bodyguard attachments.

    The source format does not encode an unambiguous attachment, so each
    inferred link is marked provisional: we match a resolved character unit
    against a resolved non-character unit in the same roster using the
    dataset's leader-attachment data.
    """
    bodyguard_ids = {
        u["ref"]["id"]
        for i, u in enumerate(units)
        if u["ref"]["id"] and not parsed_units[i]["is_character"]
    }

    for i, unit in enumerate(units):
        if not unit["ref"]["id"] or not parsed_units[i]["is_character"]:
            continue
        leader_id = unit["ref"]["id"]
        attachment = next(
            (la for la in ds.leader_attachments if la.get("leader_id") == leader_id), None
        )
        if attachment is None:
            continue
        bodyguard_id = next(
            (id_ for id_ in attachment.get("eligible_bodyguard_ids", []) if id_ in bodyguard_ids),
            None,
        )
        if bodyguard_id is None:
            continue

        bodyguard = next((u for u in units if u["ref"]["id"] == bodyguard_id), None)
        if bodyguard is None:
            continue

        unit["leader_attachment"] = {
            "bodyguard_ref": _resolved(bodyguard_id, bodyguard["ref"]["raw_name"]),
            "provisional": True,
        }
        diag.warn(
            "leader-attachment-inferred",
            "Leader attachment was inferred from leader-attachment data and is provisional.",
            unit["ref"]["raw_name"],
        )
