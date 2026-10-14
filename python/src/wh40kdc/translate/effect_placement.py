"""Where a unit or model may be placed: the placement keywords (a single value or a list
that all apply) and the ``near`` / ``away_from`` / ``in_region`` constraint lists shared by
set-up, add-unit and return-models. Each phrase starts with a space so it appends to its
clause.

Python mirror of ``tools/src/translate/effect-placement.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_refs import _objective_phrase
from wh40kdc.translate.effect_words import (
    Ctx,
    and_list,
    dekebab,
    effect_subject,
    jstr,
    range_phrase,
    region_phrase,
)

_PLACEMENTS: dict[str, str] = {
    "closest-to-destruction": "as close as possible to where it was destroyed",
    "closest-to-original": "as close as possible to its original position",
    "coherency": "in Unit Coherency",
    "unengaged": "not within Engagement Range of any enemy units",
    "strategic-reserves": "in Strategic Reserves",
    "anywhere": "anywhere on the battlefield",
    "connected-sections": "with its sections touching",
    "deployment-zone": "wholly within your deployment zone",
    "on-terrain": "on top of a terrain feature",
}


def _article(s: str) -> str:
    return "an" if s[:1].lower() in ("a", "e", "i", "o", "u") and s else "a"


def placement_phrase(m: dict[str, Any], origin: str = "this model") -> str:
    """A placement keyword, or a list of them that all apply, with the legacy ``range`` for
    (wholly) within."""
    raw = m.get("placement")
    items = raw if isinstance(raw, list) else [raw] if raw is not None else []
    parts = []
    for p in items:
        k = jstr(p)
        if k == "wholly-within":
            parts.append(f"wholly within {range_phrase(m.get('range'))} of {origin}")
        elif k == "within":
            parts.append(f"within {range_phrase(m.get('range'))} of {origin}")
        else:
            parts.append(_PLACEMENTS.get(k, dekebab(k)))
    return f" {and_list(parts)}" if parts else ""


def place_phrase(of: Any, ctx: Ctx) -> str:
    """Something a distance is measured to: a unit, an objective marker, a named marker, an
    edge or the centre."""
    if of == "battlefield-edge":
        return "a battlefield edge"
    if of == "battlefield-centre":
        return "the centre of the battlefield"
    if isinstance(of, dict):
        if of.get("marker") is not None:
            label = re.sub(r" marker$", "", dekebab(jstr(of["marker"])), count=1, flags=re.I)
            return f"{_article(label)} {label} marker"
        if of.get("objective") is not None:
            objective = of["objective"]
            obj = _objective_phrase(objective, False, "objective marker")
            if isinstance(objective, dict) and objective.get("selection_var") is not None:
                return "that objective marker"
            return f"{_article(obj)} {obj}"
    target = of if of is not None else "this-model"
    return re.sub(r"^all ", "", effect_subject(target, ctx), count=1)


def _away_phrase(of: Any, ctx: Ctx) -> str:
    """Away-from targets read as models: a bare enemy filter is "all enemy models"."""
    if isinstance(of, dict) and len(of) == 1 and of.get("owner") == "enemy":
        return "all enemy models"
    return place_phrase(of, ctx)


def _dicts(v: Any) -> list[dict[str, Any]]:
    return [x if isinstance(x, dict) else {} for x in v] if isinstance(v, list) else []


def placement_limits(m: dict[str, Any], ctx: Ctx) -> str:
    """The near / away_from / in_region lists as trailing limits."""
    parts: list[str] = []
    for n in _dicts(m.get("near")):
        wholly = "wholly " if n.get("wholly") is True else ""
        parts.append(
            f"{wholly}within {range_phrase(n.get('range'))} of {place_phrase(n.get('of'), ctx)}"
        )
    region = m.get("in_region")
    if region is not None:
        r = region if isinstance(region, dict) else {}
        wholly = "wholly " if r.get("wholly") is True else ""
        inner = r.get("region")
        parts.append(f"{wholly}within {region_phrase(inner if isinstance(inner, dict) else {})}")
    away = _dicts(m.get("away_from"))
    if away:
        limits = [
            f"{range_phrase(a.get('range'))} away from {_away_phrase(a.get('of'), ctx)}"
            for a in away
        ]
        parts.append(f"more than {and_list(limits)}")
    # One placement reads as a plain limit; several all apply.
    return f" {' and '.join(parts)}" if parts else ""
