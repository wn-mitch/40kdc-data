"""Chapter cohesion for the roster checker.

Which chapter-locked units an army under a ``faction-keyword-cohesion`` rule may
not take. Mirror of TS ``data/roster-chapter.ts``; pinned by the
``roster_validation`` conformance corpus.
"""

from __future__ import annotations

from typing import Any


def _own_keywords(child: dict[str, Any], parent: dict[str, Any]) -> list[str]:
    """A child faction's own keywords: its keywords minus its parent's."""
    inherited = set(parent.get("keywords") or [])
    return [k for k in child.get("keywords") or [] if k not in inherited]


def chapter_mismatches(
    faction: dict[str, Any] | None,
    parent: dict[str, Any] | None,
    children: list[dict[str, Any]],
    unit_faction_keywords: list[list[str] | None],
) -> list[tuple[int, list[str]]]:
    """The units the army may not take, as ``(index, chapter keywords)``.

    A unit carrying the rule's base keyword plus other faction keywords is
    locked to a chapter; allies (no base keyword) and generic units are not
    judged here. A chapter army (a child of ``parent``) takes only its own
    chapter's units. A parent army takes no chapter's units: each child faction
    is an army of its own. ``children`` are the factions whose
    ``parent_faction_id`` is the army's faction.
    """
    if faction is None:
        return []
    rules = faction.get("army_construction_rules") or []
    rule = next((r for r in rules if r.get("type") == "faction-keyword-cohesion"), None)
    if rule is None:
        return []
    base = rule["base_faction_keyword"]
    if faction.get("parent_faction_id"):
        if parent is None:
            return []
        keywords = set(_own_keywords(faction, parent))
        chapter_army = True
    else:
        keywords = {k for child in children for k in _own_keywords(child, faction)}
        chapter_army = False
    if not keywords:
        return []
    out: list[tuple[int, list[str]]] = []
    for index, unit_keywords in enumerate(unit_faction_keywords):
        if not unit_keywords or base not in unit_keywords:
            continue
        own = [k for k in unit_keywords if k != base]
        hit = any(k in keywords for k in own)
        if own and (not hit if chapter_army else hit):
            out.append((index, own))
    return out
