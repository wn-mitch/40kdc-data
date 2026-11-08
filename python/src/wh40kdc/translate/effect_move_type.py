"""The move-type container: a move type an army rule defines (Special Move Types), as a named mode
of a core move or a move of its own, with what applies before, while and after a unit makes it.

Mirrors ``tools/src/translate/effect-move-type.ts``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wh40kdc.translate.condition import describe_condition
from wh40kdc.translate.condition_refs import range_phrase
from wh40kdc.translate.effect_words import capitalize, dice_case, jstr

Render = Callable[[Any], str]

_MOVES: dict[str, str] = {
    "normal": "Normal",
    "advance": "Advance",
    "fall-back": "Fall Back",
    "charge": "Charge",
    "pile-in": "Pile-in",
    "consolidation": "Consolidation",
    "surge": "Surge",
    "scout": "Scout",
    "ingress": "Ingress",
    "disembark": "Disembark",
    "embark": "Embark",
    "pulse-jet": "Pulse Jet",
}


def _titled(slug: str) -> str:
    return " ".join(capitalize(word) for word in slug.split("-"))


def _head(e: dict[str, Any]) -> str:
    """"Shock Disembark Move (the shock mode of a Disembark move)"."""
    move_type = jstr(e.get("move_type"))
    move = _MOVES.get(move_type, _titled(move_type))
    if e.get("mode") is None:
        return jstr(e.get("name"))
    return f"{jstr(e.get('name'))} (the {_titled(jstr(e.get('mode')))} mode of a {move} move)"


def _clauses(e: dict[str, Any], inline: Render) -> list[str]:
    """Each statement the move type makes, as a clause, in the order the app prints them."""
    out: list[str] = []
    if e.get("distance") is not None:
        out.append(f'the unit can move up to {dice_case(e.get("distance"))}"')
    if e.get("setup_distance") is not None:
        out.append(
            f"each model is set up wholly within {range_phrase(e.get('setup_distance'))} "
            "of that Transport"
        )
    eligible_if = e.get("eligible_if")
    if eligible_if is not None:
        out.append(f"a unit can make this move only if {describe_condition(eligible_if)}")
    if e.get("before") is not None:
        out.append(f"before it moves, {inline(e.get('before'))}")
    if e.get("while") is not None:
        out.append(f"while it moves, {inline(e.get('while'))}")
    if e.get("after") is not None:
        out.append(f"after it moves, {inline(e.get('after'))}")
    return out


def move_type_inline(e: dict[str, Any], inline: Render) -> str:
    parts = _clauses(e, inline)
    return f"{_head(e)}: {'; '.join(parts)}" if parts else _head(e)


def move_type_block(e: dict[str, Any], indent: str, arrow: str, inline: Render) -> str:
    parts = _clauses(e, inline)
    if not parts:
        return f"{indent}{arrow}{_head(e)}."
    return "\n".join(
        [f"{indent}{arrow}{_head(e)}:", *(f"{indent}  - {capitalize(p)}." for p in parts)]
    )
