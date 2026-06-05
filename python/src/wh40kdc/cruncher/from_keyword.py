"""Translate a weapon-keyword catalog entry into the Buff stack it contributes
for a given reference-site parameter set and engine context.

Two paths converge here:

1. **DSL walk**, for keywords whose catalog ``effect`` is non-null
   (``twin-linked``, ``heavy``). The walker handles a deliberately small
   subset of nodes and produces buffs with ``source.kind = "weapon-keyword"``.
2. **Id dispatch**, for the eight rules whose catalog ``effect`` is null
   because the DSL has no primitive for them yet. These are surfaced as
   ``extra-keyword`` buffs so the engine can dispatch its math directly.

Unrecognised nodes drop silently in M1.

Python mirror of ``tools/src/cruncher/from-keyword.ts``.
"""

from __future__ import annotations

import math
from typing import Any, TypeGuard

from wh40kdc.cruncher.buffs import Buff, BuffSource, EngineContext

#: Keywords whose math the engine encodes directly (catalog ``effect`` is null).
ENGINE_DISPATCH_KEYWORDS = frozenset(
    [
        "lethal-hits",
        "sustained-hits",
        "devastating-wounds",
        "anti",
        "melta",
        "rapid-fire",
        "torrent",
        "ignores-cover",
    ]
)


def _is_object(value: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict)


def buffs_from_keyword(
    *,
    keyword_id: str,
    weapon_id: str,
    effect: Any,
    parameters: dict[str, Any] | None = None,
    context: EngineContext,
) -> list[Buff]:
    """Convert a single weapon-keyword reference (catalog effect +
    reference-site parameters) into the buff contributions it makes against
    ``context``."""
    source: BuffSource = {
        "kind": "weapon-keyword",
        "weaponId": weapon_id,
        "keywordId": keyword_id,
    }

    if keyword_id in ENGINE_DISPATCH_KEYWORDS:
        ref: dict[str, Any] = {"keyword_id": keyword_id}
        if parameters is not None:
            ref["parameters"] = parameters
        return [{"source": source, "contribution": {"type": "extra-keyword", "keywordRef": ref}}]

    if effect is None:
        return []
    return _walk(effect, source, context)


def _walk(node: Any, source: BuffSource, ctx: EngineContext) -> list[Buff]:
    if not _is_object(node):
        return []
    node_type = node.get("type")

    if node_type == "re-roll":
        return _reroll_buffs(node, source)
    if node_type == "roll-modifier":
        return _roll_modifier_buffs(node, source)
    if node_type == "feel-no-pain":
        return _feel_no_pain_buffs(node, source)
    if node_type == "keyword-grant":
        return _keyword_grant_buffs(node, source)
    if node_type == "conditional":
        return _conditional_buffs(node, source, ctx)
    if node_type == "sequence":
        return _walk_children(node.get("steps"), source, ctx)
    return []


def _walk_children(children: Any, source: BuffSource, ctx: EngineContext) -> list[Buff]:
    if not isinstance(children, list):
        return []
    out: list[Buff] = []
    for child in children:
        out.extend(_walk(child, source, ctx))
    return out


def _reroll_buffs(node: dict[str, Any], source: BuffSource) -> list[Buff]:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        return []
    roll = modifier.get("roll")
    subset = modifier.get("subset")
    if roll in ("hit", "wound", "save", "damage") and subset in ("ones", "all-failures"):
        return [
            {"source": source, "contribution": {"type": "reroll", "roll": roll, "subset": subset}}
        ]
    return []


def _roll_modifier_buffs(node: dict[str, Any], source: BuffSource) -> list[Buff]:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        return []
    if modifier.get("operation") != "add":
        return []  # M1 supports additive only; multiplicative effects are out of scope.
    value = modifier.get("value")
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return []
    roll = modifier.get("roll")
    contribution_type = (
        {
            "hit": "hit-mod",
            "wound": "wound-mod",
            "save": "save-mod",
            "damage": "damage-mod",
        }.get(roll)
        if isinstance(roll, str)
        else None
    )
    if contribution_type is None:
        return []
    return [{"source": source, "contribution": {"type": contribution_type, "value": value}}]


def _feel_no_pain_buffs(node: dict[str, Any], source: BuffSource) -> list[Buff]:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        return []
    threshold = modifier.get("threshold")
    if (
        not isinstance(threshold, (int, float))
        or isinstance(threshold, bool)
        or not math.isfinite(threshold)
    ):
        return []
    return [{"source": source, "contribution": {"type": "feel-no-pain", "threshold": threshold}}]


def _keyword_grant_buffs(node: dict[str, Any], source: BuffSource) -> list[Buff]:
    modifier = node.get("modifier")
    if not _is_object(modifier):
        return []
    id_ = modifier.get("keyword_id")
    if id_ is None:
        id_ = modifier.get("id")
    if not isinstance(id_, str) or id_ == "":
        return []
    params = modifier.get("parameters")
    ref: dict[str, Any] = {"keyword_id": id_}
    if _is_object(params):
        ref["parameters"] = params
    return [{"source": source, "contribution": {"type": "extra-keyword", "keywordRef": ref}}]


def _conditional_buffs(node: dict[str, Any], source: BuffSource, ctx: EngineContext) -> list[Buff]:
    condition = node.get("condition")
    effect = node.get("effect")
    if not _is_object(condition):
        return []
    negated = condition.get("negated") is True
    verdict = _evaluate_condition(condition, ctx)
    if verdict == "unknown":
        return []
    active = (not verdict) if negated else verdict
    if not active:
        return []
    return _walk(effect, source, ctx)


def _evaluate_condition(condition: dict[str, Any], ctx: EngineContext) -> Any:
    """True/False when the engine can evaluate the condition against ``ctx``;
    ``"unknown"`` when the condition references state the M1 engine has no
    channel for (the buff is then dropped)."""
    ctype = condition.get("type")
    if ctype == "remained-stationary":
        return ctx.get("attackerStationary") is True
    if ctype == "target-has-keyword":
        parameters = condition.get("parameters")
        parameters = parameters if _is_object(parameters) else {}
        kw = parameters.get("keyword")
        if not isinstance(kw, str):
            return "unknown"
        return kw.lower() in (ctx.get("targetKeywords") or [])
    return "unknown"
