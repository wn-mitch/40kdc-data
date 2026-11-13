"""Keyword predicates the abilities resolver reads a unit through: a member's keyword set, a
rule's ``applies_to`` filter, a Stratagem target's ``eligibility``, and the abilities a unit's
standing rules suppress.

Python mirror of the keyword helpers in ``tools/src/abilities-resolver/resolver.ts``. Keywords
compare by ``normalize_name``. ``required`` decides a keyword a predicate requires and
``excluded`` one it excludes; the resolver holds a required keyword no datasheet prints, since
the army gains it in play.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wh40kdc.data.entities import UnitView
from wh40kdc.data.normalize import normalize_name

Predicate = Callable[[str], bool]

_PREDICATE_KEYS = frozenset({"all_of", "any_of", "none_of", "not_all_of", "owner"})

# Source kinds whose rules hold for the unit without a player choosing them in play.
_STANDING_SOURCES = frozenset({"army", "detachment", "unit", "attached"})


def member_keywords(member: UnitView | None, detachment_id: Any) -> set[str]:
    """A member's keywords, lower-cased: its datasheet and faction keywords, plus each
    conditional keyword whose ``required_detachment_id`` is unset or the selected detachment."""
    if member is None:
        return set()
    conditional = [
        entry["keyword"]
        for entry in member.raw.get("conditional_keywords") or []
        if entry.get("required_detachment_id") is None
        or entry.get("required_detachment_id") == detachment_id
    ]
    return {
        keyword.lower()
        for keyword in (member.raw.get("keywords") or [])
        + (member.raw.get("faction_keywords") or [])
        + conditional
    }


def _combined(members: list[set[str]]) -> Predicate:
    """Whether the unit of ``members``, read as one combined unit, has a keyword."""
    combined = {normalize_name(keyword) for member in members for keyword in member}
    return lambda keyword: normalize_name(keyword) in combined


def applies_to_unit(filter_: Any, members: list[set[str]], printed: Predicate) -> bool:
    """Whether a rule's ``applies_to`` admits a unit of ``members``, read as one combined unit.
    An absent filter admits every unit; a filter naming anything but keyword lists (or a
    friendly owner) is not decided here and admits it too."""
    if not isinstance(filter_, dict):
        return True
    has = _combined(members)
    verdict = keyword_predicate_holds(
        filter_, lambda keyword: has(keyword) or not printed(keyword), has
    )
    return verdict is not False


def keyword_predicate_holds(
    filter_: dict[str, Any], required: Predicate, excluded: Predicate
) -> bool | None:
    """A static keyword predicate's verdict (``all_of``, ``any_of``, ``none_of``,
    ``not_all_of``, a friendly ``owner``), or ``None`` when it names anything else."""
    if any(key not in _PREDICATE_KEYS for key in filter_):
        return None
    if "owner" in filter_ and filter_["owner"] != "friendly":
        return None

    def lists(key: str) -> list[str]:
        value = filter_.get(key)
        return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []

    any_of = lists("any_of")
    not_all_of = lists("not_all_of")
    return (
        all(required(keyword) for keyword in lists("all_of"))
        and (not any_of or any(required(keyword) for keyword in any_of))
        and not any(excluded(keyword) for keyword in lists("none_of"))
        and (not not_all_of or not all(excluded(keyword) for keyword in not_all_of))
    )


def eligibility_keywords(
    condition: Any, required: Predicate, excluded: Predicate
) -> bool | None:
    """The verdict of a Stratagem target's ``eligibility`` on the target's own keywords. A
    ``matches`` on the target unit whose filter is only keyword lists is decided; ``and``,
    ``or`` and ``not`` combine verdicts; anything else (battlefield state, history) is ``None``,
    which never refuses the target."""
    if not isinstance(condition, dict):
        return None
    operator = condition.get("operator")
    operands = condition.get("operands")
    if isinstance(operator, str) and isinstance(operands, list):
        values = [eligibility_keywords(operand, required, excluded) for operand in operands]
        if operator == "and":
            if False in values:
                return False
            return True if all(value is True for value in values) else None
        if operator == "or":
            if True in values:
                return True
            return False if all(value is False for value in values) else None
        if operator == "not" and len(values) == 1:
            return None if values[0] is None else not values[0]
        return None
    parameters = condition.get("parameters")
    if condition.get("type") != "matches" or not isinstance(parameters, dict):
        return None
    if parameters.get("subject", "this-unit") != "this-unit":
        return None
    filter_ = parameters.get("filter")
    if not isinstance(filter_, dict):
        return None
    return keyword_predicate_holds(filter_, required, excluded)


def suppressed_ability_ids(
    entries: list[dict[str, Any]], members: list[set[str]], printed: Predicate
) -> set[str]:
    """The ability ids the unit's standing rules (army, detachment, unit and attached entries)
    suppress: a ``rule-state`` with direction ``suppressed`` and ``rule_kind`` ``ability`` whose
    target is this unit, or friendly units whose keywords it has, under ``conditional``
    conditions that are only keyword checks on the unit and hold. A Stratagem's, a supporting
    unit's, or a triggered or battlefield-conditioned suppression is left to play."""
    has = _combined(members)

    def required(keyword: str) -> bool:
        return has(keyword) or not printed(keyword)

    out: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
            return
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        if node_type == "conditional":
            if eligibility_keywords(node.get("condition"), required, has) is True:
                walk(node.get("effect"))
            return
        if node_type in ("sequence", "rules-bundle"):
            walk(node.get("steps"))
            return
        modifier = node.get("modifier")
        if node_type != "rule-state" or not isinstance(modifier, dict):
            return
        rule = modifier.get("rule")
        if (
            modifier.get("direction") != "suppressed"
            or modifier.get("rule_kind") != "ability"
            or not isinstance(rule, str)
        ):
            return
        target = node.get("target")
        if target == "this-unit" or (
            isinstance(target, dict) and keyword_predicate_holds(target, required, has) is True
        ):
            out.add(rule)

    for entry in entries:
        if entry["source"]["kind"] in _STANDING_SOURCES and not entry["ability"].raw.get("trigger"):
            walk(entry["ability"].raw.get("effect"))
    return out


def has_friendly_target(stratagem: dict[str, Any]) -> bool:
    """Whether a Stratagem names a friendly target in ``target_restrictions``."""
    raw = stratagem.get("target_restrictions")
    targets = raw if isinstance(raw, list) else [raw] if raw else []
    return any(target.get("side") != "enemy" for target in targets)
