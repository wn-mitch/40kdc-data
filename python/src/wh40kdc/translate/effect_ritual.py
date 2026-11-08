"""The ritual-menu container: Rituals attempted with a Psychic test, each with its Warp Charge.

Mirrors ``tools/src/translate/effect-ritual.ts``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wh40kdc.translate.effect_quantity import roll_kind_noun
from wh40kdc.translate.effect_words import capitalize, dice_case, jstr

Render = Callable[[Any], str]

# "(each Ritual can be attempted once per turn across your army)": the menu's limit on each Ritual.
_RITUAL_LIMIT = "each Ritual can be attempted once per turn across your army"


def _obj(v: Any) -> dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _test_phrase(e: dict[str, Any], inline: Render) -> str:
    """"take a Psychic test: roll 2D6, and you can roll one additional D6; …"."""
    test = _obj(e.get("test"))
    extra = test.get("extra_die")
    more = ""
    if isinstance(extra, dict):
        offer = "you can roll" if extra.get("optional") is True else "roll"
        more = f", and {offer} one additional {dice_case(extra.get('dice'))}"
    perils = test.get("perils")
    cost = ""
    if isinstance(perils, dict):
        cost = f"; if any two of its dice show the same result, {inline(perils.get('effect'))}"
    kind = "a test" if test.get("kind") is None else roll_kind_noun(test.get("kind"))
    return (
        f"take {kind}: roll {dice_case(test.get('dice'))}{more}{cost}; if this model is not "
        "destroyed and the total of all its dice equals or exceeds the Ritual's Warp Charge, "
        "this model manifests that Ritual"
    )


def _ritual_head(ritual: dict[str, Any]) -> str:
    """"Destiny's Ruin (Warp Charge 5)"."""
    return f"{jstr(ritual.get('name'))} (Warp Charge {jstr(ritual.get('warp_charge'))})"


def _rituals(e: dict[str, Any]) -> list[dict[str, Any]]:
    rituals = e.get("rituals")
    return [_obj(r) for r in rituals] if isinstance(rituals, list) else []


def ritual_menu_inline(e: dict[str, Any], inline: Render) -> str:
    rituals = " / ".join(f"{_ritual_head(r)}: {inline(r.get('effect'))}" for r in _rituals(e))
    return f"attempt one Ritual ({_RITUAL_LIMIT}); to do so, {_test_phrase(e, inline)}: {rituals}"


def ritual_menu_block(e: dict[str, Any], indent: str, arrow: str, inline: Render) -> str:
    lines = [
        f"{indent}{arrow}Attempt one of the Rituals below ({_RITUAL_LIMIT}). "
        f"To do so, {_test_phrase(e, inline)}:"
    ]
    for ritual in _rituals(e):
        lines.append(
            f"{indent}  - {_ritual_head(ritual)}: {capitalize(inline(ritual.get('effect')))}."
        )
    return "\n".join(lines)
