"""English for the named-equipment predicates (``named-weapon``, ``unit-wargear``).

Python mirror of ``tools/src/translate/condition-equipment.ts``. Negation is written here rather
than through ``negate_phrase``, because a printed weapon name may contain " is " or " has ".
"""

from __future__ import annotations

from wh40kdc.translate.condition_refs import P, _str, title_case


def named_equipment_phrase(ctype: str, p: P, negated: bool) -> str:
    """The English for one named-equipment predicate, negated when ``negated``."""
    if ctype == "unit-wargear":
        return _wargear_phrase(p, negated)
    return _weapon_phrase(p, negated)


def _wargear_phrase(p: P, negated: bool) -> str:
    label = title_case(_str(p.get("wargear")))
    models = p.get("models")
    if not isinstance(models, dict):
        verb = "does not have" if negated else "has"
        return f"this unit {verb} the {label} wargear"
    verb = "are not equipped with" if _str(models.get("state")) == "lack" else "are equipped with"
    return _unit_level(f"{_models_subject(models)} {verb} the {label} wargear", negated)


def _weapon_phrase(p: P, negated: bool) -> str:
    name = _str(p.get("name"))
    count = p.get("count")
    one = count == 1
    count_text = _str(count)
    weapons = f'one weapon named "{name}"' if one else f'exactly {count_text} weapons named "{name}"'
    if p.get("subject") == "this-model":
        verb = "is not" if negated else "is"
        return f"this model {verb} equipped with {weapons}"
    models = p.get("models")
    if not isinstance(models, dict):
        models = {}
    if _str(models.get("state")) == "lack":
        none = f'no weapon named "{name}"' if one else f'fewer than {count_text} weapons named "{name}"'
        return _unit_level(f"{_models_subject(models)} have {none}", negated)
    return _unit_level(f"{_models_subject(models)} are each equipped with {weapons}", negated)


def _models_subject(models: P) -> str:
    at_least = _str(models.get("at_least"))
    if at_least == "1":
        return "one or more models in this unit"
    return f"at least {at_least} models in this unit"


def _unit_level(phrase: str, negated: bool) -> str:
    return f"it is not the case that {phrase}" if negated else phrase
