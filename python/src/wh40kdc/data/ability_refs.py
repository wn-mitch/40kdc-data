"""A unit's ``ability_ids`` entry: an ability id, or an object for a rated rule (``{id,
value}``: Deadly Demise D3, Feel No Pain 5+) or for the ability a wargear item prints
(``{id, wargear}``).

Python mirror of ``tools/src/data/ability-refs.ts``.
"""

from __future__ import annotations

from typing import Any


def ability_ref_id(ref: Any) -> str:
    """The ability id an entry names."""
    return (
        ref if isinstance(ref, str) else str(ref.get("id")) if isinstance(ref, dict) else str(ref)
    )


def ability_ref_value(ref: Any) -> str | int | float | None:
    """The rating an entry prints, if it is a rated rule."""
    return ref.get("value") if isinstance(ref, dict) else None


def ability_ref_wargear(ref: Any) -> str | None:
    """The wargear item an entry's ability is printed by, if any."""
    return ref.get("wargear") if isinstance(ref, dict) else None


def ability_ids_of(value: Any) -> list[str]:
    """The ability ids of an untyped ``ability_ids`` value: strings and ``{id}`` objects,
    anything else skipped."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for v in value:
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict) and isinstance(v.get("id"), str):
            out.append(v["id"])
    return out


def unit_ability_ids(refs: Any) -> list[str]:
    """The ability ids of a unit's ``ability_ids``, in order."""
    return ability_ids_of(refs)


def printed_wargear_ids(refs: Any) -> list[str]:
    """The wargear ids whose printed ability the unit lists."""
    out: list[str] = []
    for r in refs or []:
        w = ability_ref_wargear(r) if isinstance(r, dict) else None
        if w:
            out.append(w)
    return out


def _is_rating_ref(v: Any) -> bool:
    return isinstance(v, dict) and len(v) == 1 and v.get("rating") is True


def with_rating(effect: Any, rating: Any) -> Any:
    """An effect with every ``{rating: true}`` replaced by the unit's printed rating.
    Without a rating (no unit in context) the effect is returned as is; unchanged subtrees
    keep their identity."""
    if rating is None:
        return effect

    def walk(v: Any) -> Any:
        if _is_rating_ref(v):
            return rating
        if isinstance(v, list):
            items = [walk(x) for x in v]
            return items if any(a is not b for a, b in zip(items, v, strict=True)) else v
        if isinstance(v, dict):
            fields = {k: walk(x) for k, x in v.items()}
            return fields if any(fields[k] is not v[k] for k in v) else v
        return v

    return walk(effect)
