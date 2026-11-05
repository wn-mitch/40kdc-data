"""A condition on each unit an effect reaches.

"While an enemy unit is within 3" of this unit, that unit has -1 OC". Mirrors
``tools/src/translate/effect-recipient-gate.ts``.
"""

from __future__ import annotations

from typing import Any

from wh40kdc.translate.condition_leadin import condition_lead_in, is_defensive_effect
from wh40kdc.translate.condition_refs import unit_filter_phrase


def _as_that_unit(c: Any) -> Any:
    """The condition with every ``recipient`` subject read as "that unit" (``event-object``)."""
    if not isinstance(c, dict):
        return c
    out = dict(c)
    p = c.get("parameters")
    if isinstance(p, dict) and p.get("subject") == "recipient":
        out["parameters"] = {**p, "subject": "event-object"}
    if isinstance(c.get("operands"), list):
        out["operands"] = [_as_that_unit(o) for o in c["operands"]]
    return out


def _names_recipient(c: Any) -> bool:
    if not isinstance(c, dict):
        return False
    p = c.get("parameters")
    if isinstance(p, dict) and p.get("subject") == "recipient":
        return True
    ops = c.get("operands")
    return isinstance(ops, list) and any(_names_recipient(o) for o in ops)


def recipient_gate(
    e: dict[str, Any], ctx: dict[str, Any]
) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    """A condition on each unit the effect reaches (subject ``recipient``) gating a leaf effect
    aimed at a unit filter, as ``(lead, inner, ctx)``. The condition names the unit with the
    filter's phrase; its later mentions and the effect say "that unit" (or "that model"). None
    when the shape is not that one."""
    condition = e.get("condition")
    inner = e.get("effect")
    if condition is None or not isinstance(inner, dict):
        return None
    target = inner.get("target")
    if not isinstance(target, dict):
        return None
    if (
        inner.get("effect") is not None
        or inner.get("steps") is not None
        or inner.get("options") is not None
        or not _names_recipient(condition)
    ):
        return None
    model = target.get("level") == "model"
    that = "that model" if model else "that unit"
    lead = condition_lead_in(_as_that_unit(condition), is_defensive_effect(inner)).replace(
        "that unit", that
    )
    at = lead.find(that)
    if at < 0:
        return None
    lead = f"{lead[:at]}{unit_filter_phrase(target)}{lead[at + len(that) :]}"
    gated_ctx = {**ctx, "each_model": True} if model else {**ctx, "aura_recipient": True}
    return lead, {**inner, "target": "recipient"}, gated_ctx
