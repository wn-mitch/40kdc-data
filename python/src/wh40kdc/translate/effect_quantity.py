"""Quantities and the small noun phrases the phase-4 leaves share: a value per battle size,
a bound roll's result, a count on the board, the move a ``counts_as_move`` names, a dice
requirement and a roll kind.

Python mirror of the quantity helpers in ``tools/src/translate/effect-words.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.effect_words import dekebab, dice_case, jstr, roll_name, title_case

_BATTLE_SIZES = ("incursion", "strike-force", "onslaught")

#: What a count-of / scaling source counts, as a noun phrase.
SCALE_OF: dict[str, str] = {
    "enemy-models-in-range": "enemy models",
    "friendly-models-in-range": "friendly models",
    "models-in-bearer-unit": "models in this unit",
    "models-in-or-embarked-in-bearer": "models in or embarked within this model",
    "models-embarked-in-bearer": "models embarked within this model",
    "embarked-models-oc": "Objective Control of the models embarked within this model",
    "models-equipped-with": "models in this unit equipped with",
    "enemy-units-in-range": "enemy units",
    "wounds-lost": "wounds lost",
    "battle-round": "battle round",
}


def scale_source(q: dict[str, Any]) -> str:
    """A count source with its keyword / wargear qualifier: "SPYDER models in this unit"."""
    of = jstr(q["count_of"] if q.get("count_of") is not None else q.get("of"))
    s = SCALE_OF.get(of, dekebab(of))
    if of == "models-equipped-with":
        s += f" {title_case(jstr(q.get('wargear')))}"
    if q.get("keyword") is not None:
        s = re.sub(r"^models\b", f"{jstr(q['keyword'])} models", s, count=1)
    if q.get("within_inches") is not None:
        s += f' within {jstr(q["within_inches"])}"'
    return s


def _battle_sized(q: dict[str, Any]) -> bool:
    return all(q.get(k) is not None for k in _BATTLE_SIZES)


def quantity_phrase(q: dict[str, Any]) -> str:
    """A non-literal quantity as a noun phrase: one value per battle size, a bound roll's
    result, or a count. Literal numbers and dice go through ``dice_case``."""
    if _battle_sized(q):
        values = "/".join(jstr(q[k]) for k in _BATTLE_SIZES)
        return f"{values} (Incursion/Strike Force/Onslaught)"
    if isinstance(q.get("roll_var"), str):
        if q.get("successes_on") is not None:
            return f"the number of those dice that rolled a {jstr(q['successes_on'])}+"
        return "the result of that roll"
    if q.get("count_of") == "battle-round":
        return "the battle round number"
    if q.get("count_of") == "embarked-models-oc":
        return f"the total {scale_source(q)}"
    if q.get("count_of") is not None:
        return f"the number of {scale_source(q)}"
    return "?"


def is_literal(q: Any) -> bool:
    """Whether a quantity is a literal number or dice expression."""
    return q is None or not isinstance(q, (dict, list))


def amount_of(q: Any, one: str, many: str) -> str:
    """ "D3 mortal wounds", or "a number of mortal wounds equal to the result of that roll"."""
    if is_literal(q):
        n = dice_case(q)
        return f"{n} {one if n == '1' else many}"
    p = q if isinstance(q, dict) else {}
    if _battle_sized(p):
        values = "/".join(jstr(p[k]) for k in _BATTLE_SIZES)
        return f"{values} {many} (Incursion/Strike Force/Onslaught)"
    return f"a number of {many} equal to {quantity_phrase(p)}"


_MOVED: dict[str, str] = {
    "normal": "a Normal move",
    "advance": "an Advance move",
    "fall-back": "a Fall Back move",
    "charge": "a Charge move",
    "remain-stationary": "no move (it Remained Stationary)",
}


def moved_phrase(move: Any) -> str:
    """ "a Normal move" — the move a counts_as_move names."""
    m = jstr(move)
    if m in _MOVED:
        return _MOVED[m]
    return f"{'an' if m[:1].lower() in 'aeiou' and m else 'a'} {title_case(m)} move"


def requirement_phrase(req: Any) -> str:
    """A dice requirement: "pair of 4+", or alternatives "pair of 6+ or triple of 3+"."""

    def one(r: Any) -> str:
        r = r if isinstance(r, dict) else {}
        return f"{jstr(r.get('type'))} of {jstr(r.get('min_value'))}+"

    any_of = req.get("any_of") if isinstance(req, dict) else None
    if isinstance(any_of, list):
        return " or ".join(one(r) for r in any_of)
    return one(req)


_TEST_KINDS = frozenset({"psychic", "battle-shock", "leadership", "desperate-escape", "hazard"})


def roll_kind_noun(kind: Any) -> str:
    """ "a Psychic test", "a Blessings of Khorne roll" — what kind of roll a gate or step is."""
    name = roll_name(kind)
    article = "an" if name[:1].lower() in "aeiou" and name else "a"
    noun = "test" if isinstance(kind, str) and kind in _TEST_KINDS else "roll"
    return f"{article} {name} {noun}"
