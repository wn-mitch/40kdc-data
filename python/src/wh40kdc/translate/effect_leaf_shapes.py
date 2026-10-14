"""Single effects added for the phase-4 shapes: a test exemption, a datasheet swap, how a
characteristic that differs between models resolves, Firing Deck weapon borrowing and a
weapon binding. One lowercase-initial clause, no period; None for any other type.

Also holds the phase-4 clauses of existing leaves (ability-activate selection, the limits
on a changed ability allowance, a redirected target) so ``effect_leaf`` stays one module.

Python mirror of ``tools/src/translate/effect-leaf-shapes.ts`` and the matching arms of
``tools/src/translate/effect-leaf.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.condition_refs import _and_list, _obj, _or_list
from wh40kdc.translate.effect_words import (
    Ctx,
    ability_label,
    bracket_keyword,
    dekebab,
    dice_case,
    effect_subject,
    is_plural,
    jstr,
    num,
    num_str,
    stat_name,
    test_name,
    title_case,
    v,
)
from wh40kdc.translate.expiry import expiry_trail

Leaf = dict[str, Any]


def _test_exemption(m: dict[str, Any], subj: str) -> str:
    window = jstr(m.get("window")).replace("-", " ")
    return (
        f"{subj} {v(subj, 'does')} not need to take any further "
        f"{test_name(m.get('test'))} tests this {window}"
    )


def _characteristic_resolution(m: dict[str, Any], subj: str) -> str:
    stat = f"{stat_name(m.get('stat'))} characteristic"
    if m.get("rule") == "majority":
        tie = "lowest" if m.get("tie") == "lowest" else "highest"
        which = f"the {stat} of the majority of its models (if tied, the {tie})"
    else:
        which = (
            f"the {'lowest' if m.get('rule') == 'lowest' else 'highest'} {stat} among its models"
        )
    if m.get("applies_to") == "wound-roll":
        return f"each time an attack targets {subj}, use {which} to determine the Wound roll"
    return f"{subj} {v(subj, 'uses')} {which}"


def _borrow_weapons(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    # Weapons come from models, so a unit filter reads as its models.
    if m.get("from") is not None:
        source = re.sub(r"^all ", "", effect_subject(m["from"], ctx), count=1)
        source = re.sub(r"\bunits\b", "models", source, count=1)
    else:
        source = "models embarked within it"
    scope = _obj(m.get("weapons"))
    kind = f"{jstr(scope['type'])} " if scope.get("type") else ""
    excluded = scope.get("exclude_keyword")
    excl = (
        f" (excluding {' and '.join(bracket_keyword(k) for k in excluded)} weapons)"
        if isinstance(excluded, list) and excluded
        else ""
    )
    until = expiry_trail(m.get("until"))
    duration = f" {until}" if until else ""
    return (
        f"{subj} can use one {kind}weapon{excl} from each of up to "
        f"{dice_case(m.get('max_models'))} {source}{duration}; "
        "those models cannot shoot"
    )


def _select_weapon(m: dict[str, Any], subj: str) -> str:
    n = num(m["count"] if m.get("count") is not None else 1)
    one = n == 1
    scope = _obj(m.get("weapons"))
    named = f"{jstr(scope['name'])} " if scope.get("name") is not None else ""
    kind = named + (f"{jstr(scope['type'])} " if scope.get("type") is not None else "")
    keyword = scope.get("keyword")
    refs = keyword if isinstance(keyword, list) else [keyword] if keyword is not None else []
    kw = f" with {_or_list([bracket_keyword(k) for k in refs])}" if refs else ""
    count = "one" if one else jstr(m.get("count"))
    refer = "it as the selected weapon" if one else "them as the selected weapons"
    return (
        f"select {count} {kind}weapon{'' if one else 's'}{kw} equipped by {subj}; "
        f"the effects below refer to {refer}"
    )


def describe_shape_leaf(e: Leaf, m: dict[str, Any], subj: str, ctx: Ctx) -> str | None:
    """The phase-4 leaves, or None for any other type."""
    t = e.get("type")
    if t == "test-exemption":
        return _test_exemption(m, subj)
    if t == "datasheet-swap":
        return (
            f"{subj} {v(subj, 'uses')} the {title_case(jstr(m.get('datasheet')))} datasheet "
            "from now on, keeping its lost wounds and its position"
        )
    if t == "characteristic-resolution":
        return _characteristic_resolution(m, subj)
    if t == "borrow-weapons":
        return _borrow_weapons(m, subj, ctx)
    if t == "select-weapon":
        return _select_weapon(m, subj)
    return None


def ability_activate(m: dict[str, Any], subj: str) -> str:
    """An ability resolved now, one of its options made active, or a fresh selection."""
    label = ability_label(m.get("ability"))
    if m.get("procedure") == "oath":
        return f"{subj} {v(subj, 'resolves')} the {label} Oath procedure again"
    consumed = (
        ", even if it has already been selected this battle"
        if m.get("ignore_consumed") is True
        else ""
    )
    sel = m.get("select")
    exclusive = " (and no other option is)" if m.get("exclusive") is True else ""
    if sel is not None:
        sel = sel if isinstance(sel, dict) else {}
        count = sel.get("count")
        n = num(1 if count is None else count)
        n = 1.0 if n != n or n == 0 else n
        names = _option_names(sel.get("from"))
        if sel.get("by") == "roll":
            results = "one result" if n == 1 else f"{num_str(n)} results"
            among = f" among the {_or_list(names)} options" if names else ""
            how = f"make a new {label} roll and activate {results} it allows{among}"
        else:
            what = (
                f"of the {_or_list(names)} options"
                if names
                else ("option" if n == 1 else "options")
            )
            how = f"select {'one' if n == 1 else num_str(n)} {what} of {label}"
        join = "in place of" if m.get("exclusive") is True else "in addition to"
        return f"{how} for {subj}, {join} any already active{consumed}"
    override = m.get("override")
    instead = ""
    if override is not None:
        amount = override.get("amount") if isinstance(override, dict) else None
        instead = f", using {dice_case(amount)} in place of its usual amount"
    if m.get("all_options") is True:
        return f"every option of {label} is active for {subj}{consumed}"
    if isinstance(m.get("options"), list):
        active = _and_list(_option_names(m["options"]))
        return f"the {active} options of {label} are active for {subj}{exclusive}{consumed}"
    if m.get("option") is None:
        return f"{subj} {v(subj, 'resolves')} the {label} ability now{instead}"
    return (
        f"the {title_case(jstr(m['option']))} option of {label} is active for {subj}"
        f"{exclusive}{consumed}"
    )


def _option_names(options: Any) -> list[str]:
    """Option ids as their display names."""
    return [title_case(jstr(o)) for o in options] if isinstance(options, list) else []


def ability_limits(m: dict[str, Any]) -> str:
    """The limits on a changed allowance: once per battle round, never in the same phase,
    outside the shared limit."""
    parts: list[str] = []
    per = m.get("cap_per")
    if per is not None:
        p = per if isinstance(per, dict) else {}
        times = "once" if num(p.get("count")) == 1 else f"{jstr(p.get('count'))} times"
        parts.append(f"but it can be used at most {times} per {dekebab(jstr(p.get('period')))}")
    if m.get("not_same") is not None:
        parts.append(f"but not in the same {jstr(m['not_same'])} as the use that triggered this")
    if m.get("consumes_shared_use") is False:
        parts.append("and this use does not count toward that ability's limit for other units")
    return f", {', '.join(parts)}" if parts else ""


_REDIRECTED = {"stratagem": "Stratagems", "shoot": "ranged attacks", "fight": "melee attacks"}


def redirect_targeting(m: dict[str, Any], who: str, whom: str, ctx: Ctx) -> str:
    """Attacks (or Stratagems) aimed at one unit that must target another instead."""
    to = effect_subject(m.get("to"), ctx)
    what = _REDIRECTED.get(jstr(m.get("kind")), "attacks")
    # One unit is targeted at a time: "that target a friendly ANATHEMA PSYKANA unit".
    if whom.startswith("all ") or is_plural(whom):
        base = re.sub(r"^all ", "", whom, count=1)
        base = re.sub(r" units\b", " unit", base, count=1)
        base = re.sub(r" models\b", " model", base, count=1)
        one = re.sub(r"^a ([aeiou])", r"an \1", f"a {base}", count=1, flags=re.IGNORECASE)
    else:
        one = whom
    by = f" made by {who}" if m.get("by") is not None else ""
    eligible = f", if {to} is an eligible target" if m.get("if_eligible") is True else ""
    return f"{what}{by} that target {one} must target {to} instead{eligible}"
