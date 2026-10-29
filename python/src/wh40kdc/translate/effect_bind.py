"""The binding containers added for the phase-4 shapes: ``roll`` (one roll whose result
nested numeric fields and dice gates share) and ``select-objective`` (bind objective
markers for the nested effect). Renderers take the nested-effect describer as a callback so
this module does not import ``effect``.

Python mirror of ``tools/src/translate/effect-bind.ts``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from wh40kdc.translate.condition_refs import _objective_phrase
from wh40kdc.translate.effect_quantity import quantity_phrase, roll_kind_noun
from wh40kdc.translate.effect_words import (
    capitalize,
    dice_case,
    jstr,
    num,
    title_case,
)

Render = Callable[[Any], str]


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _pool_title(pool: str) -> str:
    """ "Blessings of Khorne pool" from a pool id."""
    return f"{title_case(re.sub(r'-pool$', '', pool))} pool"


def roll_head(e: dict[str, Any]) -> str:
    """ "roll 8D6, plus one D6 for each die in your Blessings of Khorne pool (a Blessings of
    Khorne roll)"."""
    pool = e.get("extra_dice_pool")
    extra = (
        f", plus one D6 for each die in your {_pool_title(pool)}" if isinstance(pool, str) else ""
    )
    kind = f" ({roll_kind_noun(e['kind'])})" if e.get("kind") is not None else ""
    return f"roll {dice_case(e.get('dice'))}{extra}{kind}"


def _selector_count(sel: dict[str, Any]) -> tuple[str, bool]:
    bounds = _obj(sel.get("count"))
    minimum = bounds.get("min")
    maximum = bounds.get("max")

    def quantity(value: Any) -> str:
        if isinstance(value, dict):
            return quantity_phrase(value)
        return "one" if num(value) == 1 else jstr(value)

    if minimum is not None and minimum == maximum:
        return quantity(minimum), maximum != 1
    if minimum is not None and maximum is not None and minimum != 0:
        return f"from {quantity(minimum)} through {quantity(maximum)}", maximum != 1
    if maximum is not None:
        return f"up to {quantity(maximum)}", maximum != 1
    if minimum is not None:
        return f"at least {quantity(minimum)}", True
    return "each", False

def _selection_binding(sel: dict[str, Any], plural: bool) -> str:
    binding = sel.get("bind_as")
    if not isinstance(binding, str) or not binding:
        return ""
    name = binding.replace("-", " ").replace("_", " ")
    return f", binding {'them' if plural else 'it'} as {name}"


def _selection_limit(sel: dict[str, Any], noun: str) -> str:
    limit = _obj(sel.get("limit"))
    if not limit:
        return ""
    times = "once" if num(limit.get("count")) == 1 else f"{jstr(limit.get('count'))} times"
    period = jstr(limit.get("period")).replace("-", " ")
    return (
        f" (each {noun} can be selected for this ability at most {times} "
        f"per {period} across your army)"
    )


def objective_selector_phrase(sel: dict[str, Any]) -> str:
    count, plural = _selector_count(sel)
    noun = "objective markers" if plural else "objective marker"
    base = _objective_phrase(_obj(sel.get("filter")), False, noun)
    eligibility = ""
    if isinstance(sel.get("eligibility"), dict):
        from wh40kdc.translate.condition_leadin import describe_selection_eligibility

        eligibility = f" {describe_selection_eligibility(sel['eligibility'])}"
    binding = _selection_binding(sel, plural)
    limit = _selection_limit(sel, "objective marker")
    return f"{count} {base}{eligibility}{binding}{limit}"


def _lead(sel: dict[str, Any]) -> str:
    return f"{'for' if sel.get('count') is None else 'select'} {objective_selector_phrase(sel)}"


def select_objective_inline(e: dict[str, Any], inline: Render) -> str:
    """select-objective on one line: "select one objective marker …: <effect>"."""
    return f"{_lead(_obj(e.get('selector')))}: {inline(e.get('effect'))}"


def select_objective_block(
    e: dict[str, Any], indent: str, arrow: str, nested: str | None, inline: Render
) -> str:
    """select-objective as a block: a header line and the nested effect one level deeper."""
    head = f"{indent}{arrow}{capitalize(_lead(_obj(e.get('selector'))))}"
    return f"{head}:\n{nested}" if nested is not None else f"{head}: {inline(e.get('effect'))}."
