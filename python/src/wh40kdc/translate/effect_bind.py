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
from wh40kdc.translate.effect_quantity import roll_kind_noun
from wh40kdc.translate.effect_words import (
    capitalize,
    dice_case,
    jstr,
    num,
    range_phrase,
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


_ORIGINS = {"bearer": "the bearer", "bearer-unit": "the bearer's unit"}


def objective_selector_phrase(sel: dict[str, Any]) -> str:
    """ "one objective marker you control that the bearer's unit is within range of"."""
    each = sel.get("count") == "each"
    n = num(sel["count"] if sel.get("count") is not None else 1)
    noun = "objective marker" if each or n == 1 else "objective markers"
    controlled = sel.get("controlled_by")
    control = (
        {"controlled_by": "friendly"}
        if controlled == "your-army"
        else {"controlled_by": "enemy"}
        if controlled == "opponent"
        else {}
    )
    base = _objective_phrase({**_obj(sel.get("filter")), **control}, False, noun)
    quantity = "each" if each else "one" if n == 1 else jstr(sel.get("count"))
    origin_id = jstr(sel["origin"] if sel.get("origin") is not None else "bearer")
    origin = _ORIGINS.get(origin_id, "the bearer")
    s = f"{quantity} {base}"
    if sel.get("range") == "objective-control":
        s += f" that {origin} is within range of"
    elif sel.get("range") is not None:
        s += f" within {range_phrase(sel['range'])} of {origin}"
    elif sel.get("range_inches") is not None:
        s += f' within {jstr(sel["range_inches"])}" of {origin}'
    req = sel.get("requires_unit")
    if req is not None:
        r = _obj(req)
        who = "an enemy" if r.get("owner") == "enemy" else "a friendly"
        ability = title_case(jstr(r.get("requires_ability")))
        s += f" with {who} unit with the {ability} ability within range of it"
    return s


def _selection_limit(sel: dict[str, Any]) -> str:
    limit = sel.get("selection_limit")
    if limit is None:
        return ""
    lim = _obj(limit)
    times = "once" if num(lim.get("count")) == 1 else f"{jstr(lim.get('count'))} times"
    period = jstr(lim.get("period")).replace("-", " ")
    return f" (each objective marker can be selected for this ability at most {times} per {period})"


def _lead(sel: dict[str, Any]) -> str:
    verb = "for" if sel.get("count") == "each" else "select"
    return f"{verb} {objective_selector_phrase(sel)}{_selection_limit(sel)}"


def select_objective_inline(e: dict[str, Any], inline: Render) -> str:
    """select-objective on one line: "select one objective marker …: <effect>"."""
    return f"{_lead(_obj(e.get('selector')))}: {inline(e.get('effect'))}"


def select_objective_block(
    e: dict[str, Any], indent: str, arrow: str, nested: str | None, inline: Render
) -> str:
    """select-objective as a block: a header line and the nested effect one level deeper."""
    head = f"{indent}{arrow}{capitalize(_lead(_obj(e.get('selector'))))}"
    return f"{head}:\n{nested}" if nested is not None else f"{head}: {inline(e.get('effect'))}."
