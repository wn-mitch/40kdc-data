"""Conditions inside an enemy selection lever that only restate the selection.

The lever vouches that the other side of the attack is the selected unit, so a condition that it
is that unit (``same-unit`` as the selection), or that it carries a tag the selection itself
designates, holds. Python mirror of ``designatedTags``, ``selectionHolds`` and their helpers in
``tools/src/cruncher/from-dsl-selection.ts``.
"""

from __future__ import annotations

from typing import Any

_SELECTED_UNIT = "selected-unit"


def _names_selection(value: Any, binding: str | None) -> bool:
    """Whether a unit-ref names the selection's unit: ``selected-unit`` or its own binding."""
    return value == _SELECTED_UNIT or (
        binding is not None and isinstance(value, dict) and value.get("selection_var") == binding
    )


def designated_tags(node: Any, binding: str | None = None) -> set[str]:
    """The tags the selection's own ``designate`` steps put on the selected unit, outside a
    nested selection."""
    tags: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for child in value:
                visit(child)
            return
        if not isinstance(value, dict) or value.get("type") == "select-units":
            return
        modifier = value.get("modifier") if isinstance(value.get("modifier"), dict) else None
        if (
            value.get("type") == "designate"
            and _names_selection(value.get("target"), binding)
            and modifier is not None
            and isinstance(modifier.get("tag"), str)
            and modifier.get("clear") is not True
        ):
            tags.add(modifier["tag"])
        for child in value.values():
            visit(child)

    visit(node)
    return tags


def _held_by_selection(
    condition: dict[str, Any], other: str, tags: set[str], binding: str | None
) -> bool:
    """Whether a condition holds once the player vouches that ``other`` is the selected unit."""
    params = condition.get("parameters")
    if not isinstance(params, dict) or params.get("subject") != other:
        return False
    if condition.get("type") == "same-unit":
        return _names_selection(params.get("as"), binding)
    filt = params.get("filter")
    if condition.get("type") != "matches" or not isinstance(filt, dict):
        return False
    tag = filt.get("designated")
    return len(filt) == 1 and isinstance(tag, str) and tag in tags


_HELD = object()


def _without_held(condition: Any, other: str, tags: set[str], binding: str | None) -> Any:
    """The condition left once the selection's back-references hold: ``_HELD`` when nothing is
    left. An ``and`` keeps its other operands; any other operator is left whole."""
    if not isinstance(condition, dict):
        return condition
    operands = condition.get("operands")
    if condition.get("operator") == "and" and isinstance(operands, list):
        rest = [
            operand
            for operand in operands
            if not (isinstance(operand, dict) and _held_by_selection(operand, other, tags, binding))
        ]
        if len(rest) == len(operands):
            return condition
        if not rest:
            return _HELD
        if len(rest) == 1:
            return rest[0]
        return {**condition, "operands": rest}
    return _HELD if _held_by_selection(condition, other, tags, binding) else condition


def selection_holds(node: Any, other: str, tags: set[str], binding: str | None = None) -> Any:
    """The lever's effect with every condition that only restates the selection settled: a
    conditional whose condition holds becomes its effect. Nested selections keep their scope."""
    if isinstance(node, list):
        return [selection_holds(child, other, tags, binding) for child in node]
    if not isinstance(node, dict) or node.get("type") == "select-units":
        return node
    if node.get("type") == "conditional" and "effect" in node:
        condition = _without_held(node.get("condition"), other, tags, binding)
        if condition is _HELD:
            return selection_holds(node["effect"], other, tags, binding)
        if condition is not node.get("condition"):
            return selection_holds({**node, "condition": condition}, other, tags, binding)
    return {key: selection_holds(value, other, tags, binding) for key, value in node.items()}
