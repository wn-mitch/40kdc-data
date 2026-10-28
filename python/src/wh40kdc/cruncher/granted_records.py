"""Grants of ability records ("friendly BLOOD LEGIONS units gain Blessings of
Khorne"), resolved to the record itself so the translator reads them as
printed definitions: the holders run the granted rule as their own ability,
and its "this unit" is the holder.

Python mirror of ``tools/src/cruncher/granted-records.ts``.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Set
from typing import Any

#: The ability record with this id (its ``effect``, ``trigger``, ``usage`` and
#: ``optional``), or None when none resolves.
GrantedRecordLookup = Callable[[str], Mapping[str, Any] | None]


def resolve_granted_records(
    effect: Any, lookup: GrantedRecordLookup, seen: Set[str] = frozenset()
) -> Any:
    """Rewrite each ``ability-grant`` that names an ability record by id into a
    printed grant: its ``definition`` is an ability part carrying the record's
    effect (itself resolved), trigger, usage and optionality.

    A grant already carrying a definition, a rules bundle, an id ``lookup``
    does not resolve (a core ability), and a record in ``seen`` (the granting
    ability itself, or a cycle) stay as they are, so the translator reports
    them as before. Unchanged subtrees keep their identity.
    """
    if isinstance(effect, list):
        copy: list[Any] | None = None
        for index, child in enumerate(effect):
            resolved = resolve_granted_records(child, lookup, seen)
            if resolved is not child:
                if copy is None:
                    copy = list(effect)
                copy[index] = resolved
        return effect if copy is None else copy
    if not isinstance(effect, dict):
        return effect
    modifier = effect.get("modifier")
    if effect.get("type") == "ability-grant" and isinstance(modifier, dict):
        ability = modifier.get("ability")
        if (
            isinstance(ability, str)
            and modifier.get("definition") is None
            and modifier.get("rules_bundle") is not True
            and ability not in seen
        ):
            record = lookup(ability)
            if record is not None and isinstance(record.get("effect"), dict):
                definition: dict[str, Any] = {
                    "type": "ability-part",
                    "effect": resolve_granted_records(record["effect"], lookup, {*seen, ability}),
                }
                if record.get("trigger") is not None:
                    definition["trigger"] = record["trigger"]
                if record.get("usage") is not None:
                    definition["usage"] = record["usage"]
                if record.get("optional") is True:
                    definition["optional"] = True
                return {**effect, "modifier": {**modifier, "definition": definition}}
    out: dict[str, Any] | None = None
    for key, child in effect.items():
        resolved = resolve_granted_records(child, lookup, seen)
        if resolved is not child:
            if out is None:
                out = dict(effect)
            out[key] = resolved
    return effect if out is None else out
