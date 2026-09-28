"""Single effects on the resource and army-construction axes: CP, costs, resource pools
and dice, Transport capacity and muster rules. One lowercase-initial clause, no period.

Python mirror of the resource and army leaves in ``tools/src/translate/effect-leaf-board.ts``.
"""

from __future__ import annotations

import re
from typing import Any

from wh40kdc.translate.effect_words import (
    Ctx,
    dice_case,
    effect_subject,
    jstr,
    num,
    num_str,
    resource_noun,
    roll_name,
    title_case,
)


def _obj(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else {}


def cost_modifier(m: dict[str, Any], subj: str) -> str:
    of = m.get("of")
    noun = "manoeuvre" if of == "manoeuvre" else "ability" if of == "ability" else "Stratagem"
    op = m.get("operation")
    if m.get("applies_to") == "the-triggering-use":
        if op == "decrease":
            return (
                f"reduce the CP cost of that use of the {noun} by {jstr(m.get('amount'))}CP (to a "
                "minimum of 0CP)"
            )
        if op == "increase":
            return f"increase the CP cost of that use of the {noun} by {jstr(m.get('amount'))}CP"
        if op == "waive":
            return f"that use of the {noun} costs no CP"
        return f"that use of the {noun} costs {jstr(m.get('amount'))}CP"
    named = m.get("id") is not None
    which = (
        f"the {title_case(jstr(m['id']))} {noun}"
        if named
        else ("abilities" if noun == "ability" else f"{noun}s")
    )
    applies = m.get("applies_to")
    if applies == "targeting-this-unit":
        whose = f" that {'targets' if named else 'target'} {subj}"
    elif applies == "used-by-this-unit":
        whose = f" used by {subj}"
    else:
        whose = ""
    verb = "costs" if named else "cost"
    if op == "waive":
        return f"{which}{whose} can be used without paying {'its' if named else 'their'} CP cost"
    if op == "set":
        return f"{which}{whose} {verb} {jstr(m.get('amount'))}CP"
    if op == "multiply":
        a = m.get("amount")
        times = "twice" if a == 2 else "three times" if a == 3 else f"{jstr(a)} times"
        return f"{which}{whose} {verb} {times} {'its' if named else 'their'} stated CP cost"
    amount = jstr(m["amount"] if m.get("amount") is not None else 1)
    return f"{which}{whose} {verb} {amount}CP {'less' if op == 'decrease' else 'more'}"


def resource_die(m: dict[str, Any]) -> str:
    pool = resource_noun(m.get("pool"), None)
    if m.get("operation") == "substitute":
        rolls = [roll_name(r) for r in m["rolls"]] if isinstance(m.get("rolls"), list) else ["dice"]
        return (
            f"discard a die from your {pool} and use its value in place of a {' or '.join(rolls)} "
            "roll"
        )
    shown = "the highest result" if m.get("value") == "highest" else jstr(m.get("value"))
    if m.get("count_per_pool") is not None:
        per = resource_noun(m["count_per_pool"], None)
        die = "one rolled D6" if m.get("value") == "rolled" else f"one die showing {shown}"
        lost = f", after which all your {per} are lost" if m.get("consumes_pool") is True else ""
        return f"add {die} to your {pool} for each {per} you have{lost}"
    cnt = dice_case(m["count"]) if m.get("count") is not None else "1"
    if m.get("value") == "rolled":
        return f"add {'a rolled D6' if cnt == '1' else f'{cnt} rolled D6'} to your {pool}"
    return f"add {'a die' if cnt == '1' else f'{cnt} dice'} showing {shown} to your {pool}"


def army_rule(m: dict[str, Any], subj: str, ctx: Ctx) -> str:
    with_f = (
        re.sub(r"^all ", "", effect_subject(m["with"], ctx)) if m.get("with") is not None else None
    )
    rule = m.get("rule")
    if rule == "warlord-required":
        return f"{subj} must be your Warlord"
    if rule == "warlord-forbidden":
        return f"{subj} cannot be your Warlord"
    if rule == "unique":
        return f"your army can include only one of {subj}"
    if rule == "enhancement-forbidden":
        return f"{subj} cannot be given Enhancements"
    if rule == "enhancement-slot":
        each = re.sub(r" units\b", " unit", with_f, count=1) if with_f is not None else "such unit"
        up_to = f"up to {jstr(m['max'])} " if m.get("max") is not None else ""
        kind = (
            f"{title_case(jstr(m['enhancement_kind']))} "
            if m.get("enhancement_kind") is not None
            else ""
        )
        plural = "" if m.get("max") == 1 else "s"
        return f"each {each} can be given {up_to}{kind}Enhancement{plural}"
    if rule == "faction-forbidden":
        return f"you cannot select {title_case(jstr(m.get('faction')))} as your Army Faction"
    if rule == "attachment":
        if m.get("mandatory") is True:
            return f"{subj} must be attached to a Leader, or it counts as destroyed"
        led = (
            f" led by a {title_case(jstr(m['led_by']))} model"
            if m.get("led_by") is not None
            else ""
        )
        return (
            f"at the start of the Declare Battle Formations step, {subj} can join one friendly "
            f"unit{led}, "
            "becoming part of that Bodyguard unit"
        )
    if m.get("max") is not None:
        return (
            f"your army can include at most {jstr(m['max'])} "
            f"{with_f if with_f is not None else 'such units'}"
        )
    return f"your army cannot include {with_f if with_f is not None else 'such units'}"


def _space_models(s: Any) -> str:
    """The models one ``space_per_model`` entry names."""
    entry = _obj(s)
    return _as_models(
        effect_subject({"any_of": entry.get("any_of"), "all_of": entry.get("all_of")})
    )


def _as_models(subject: str) -> str:
    return re.sub(r"\bunits\b", "models", re.sub(r"^all ", "", subject), count=1)


def transport_capacity(m: dict[str, Any]) -> str:
    """How models count against a Transport's capacity."""
    if m.get("capacity") is not None:
        who = (
            f" {_as_models(effect_subject(m['eligible']))}"
            if m.get("eligible") is not None
            else " models"
        )
        spaces = (
            [
                f"{_space_models(s)} take {jstr(_obj(s).get('slots'))} spaces each"
                for s in m["space_per_model"]
            ]
            if isinstance(m.get("space_per_model"), list)
            else []
        )
        return "; ".join(
            [f"this model has a Transport capacity of {jstr(m['capacity'])}{who}", *spaces]
        )
    keyword = title_case(jstr(m["model_keyword"])) if m.get("model_keyword") is not None else ""
    single = m.get("subject_kind") == "single-model"
    if keyword:
        model = f"{'this ' if single else ''}{keyword} model"
    else:
        model = "this model" if single else "model in this unit"
    each_model = model if single else f"each {model}"
    elig = m.get("transport_eligibility")
    elig = elig if isinstance(elig, dict) else None
    if elig is not None and elig.get("requires_capacity_keyword") is not None:
        qualification = (
            f" in a Transport able to carry {title_case(jstr(elig['requires_capacity_keyword']))} "
            "models"
        )
    elif elig is not None and elig.get("embark_as_keyword") is not None:
        qualification = f" when embarking as {title_case(jstr(elig['embark_as_keyword']))}"
    else:
        qualification = ""
    if m.get("occupancy_kind") == "fixed-model-spaces":
        sp = num(m.get("spaces_per_model"))
        return (
            f"for Transport capacity{qualification}, {each_model} occupies {num_str(sp)} "
            f"model space{'' if sp == 1 else 's'}"
        )
    if m.get("occupancy_kind") == "equivalent-model":
        equivalent = (
            f"{title_case(jstr(m['equivalent_model_keyword']))} model"
            if m.get("equivalent_model_keyword") is not None
            else "model"
        )
        count = num(
            m.get("equivalent_model_count") if m.get("equivalent_model_count") is not None else 1
        )
        return (
            f"for Transport capacity{qualification}, {each_model} counts as {num_str(count)} "
            f"{equivalent}{'' if count == 1 else 's'}"
        )
    models = num(m.get("models_per_group"))
    spaces_n = num(m.get("spaces_per_group"))
    group_model = f"{keyword} model" if keyword else "model in this unit"
    group_models = f"{keyword} models" if keyword else "models in this unit"
    if single:
        subject = model
    elif models == 1:
        subject = f"each {group_model}"
    else:
        subject = f"each group of {num_str(models)} {group_models}"
    space_noun = "model space" if spaces_n == 1 else "model spaces"
    return (
        f"for Transport capacity{qualification}, {subject} occupies {num_str(spaces_n)} "
        f"{space_noun}, "
        f"rounding {jstr(m.get('rounding'))}"
    )


def resource_gain(m: dict[str, Any]) -> str:
    a = m.get("amount")
    amount = "a number of" if a == "variable" else "any number of" if a == "any" else dice_case(a)
    return f"you gain {amount} {resource_noun(m.get('pool'), m.get('label'), a)}"


def resource_spend(m: dict[str, Any]) -> str:
    a = m.get("amount")
    amount = "all your" if a == "all" else "one or more" if a == "one-or-more" else dice_case(a)
    return f"spend {amount} {resource_noun(m.get('pool'), m.get('label'), 2 if a == 'all' else a)}"


def cp_gain(m: dict[str, Any]) -> str:
    n = num(m.get("amount"))
    return f"you lose {num_str(abs(n))}CP" if n < 0 else f"you gain {jstr(m.get('amount'))}CP"
