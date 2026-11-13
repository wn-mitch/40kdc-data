"""Keywords a bearer's own abilities change once it is attached at list building.

Mirror of TS ``tools/src/data/list-building-keywords.ts``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from wh40kdc.scope import keyword_key, unit_matches_applies_to

_BEARER_REFS = ("this-model", "this-unit")
_PREDICATE_KEYS = ("all_of", "any_of", "none_of", "not_all_of")
# A change is (add, keyword key).
Change = tuple[bool, str]
_UNDECIDABLE = object()


def _is_bearer(ref: Any) -> bool:
    return ref is None or ref in _BEARER_REFS


def _with_predicate(filter_: Any) -> Any:
    """The ``with`` filter's keyword predicate, ``None`` for no filter, ``_UNDECIDABLE`` when
    the filter needs more than the attached unit's keywords."""
    if filter_ is None:
        return None
    if not isinstance(filter_, Mapping):
        return _UNDECIDABLE
    predicate: dict[str, list[str]] = {}
    for key, value in filter_.items():
        if value is None:
            continue
        if (key == "owner" and value == "friendly") or (key == "level" and value == "unit"):
            continue
        if key not in _PREDICATE_KEYS:
            return _UNDECIDABLE
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            return _UNDECIDABLE
        predicate[key] = value
    return predicate


def _leaf_changes(leaf: Mapping[str, Any]) -> list[Change]:
    modifier = leaf.get("modifier")
    if not _is_bearer(leaf.get("target")) or not isinstance(modifier, Mapping):
        return []
    if leaf.get("type") == "keyword-grant" and isinstance(modifier.get("keywords"), list):
        return [(True, keyword_key(k)) for k in modifier["keywords"] if isinstance(k, str)]
    rule = modifier.get("rule")
    if (
        leaf.get("type") == "rule-state"
        and modifier.get("rule_kind") == "keyword"
        and isinstance(rule, str)
    ):
        if modifier.get("direction") == "suppressed":
            return [(False, keyword_key(rule))]
        if modifier.get("direction") == "granted":
            return [(True, keyword_key(rule))]
    return []


def attachment_keyword_changes(
    ability: Mapping[str, Any],
) -> tuple[dict[str, list[str]] | None, list[Change]] | None:
    """The keyword changes an ability makes to its bearer once attached, when attachment alone
    gates them: an untriggered ``conditional`` on a single ``attachment`` predicate (role
    ``attached``, the bearer as subject) over a leaf or a ``sequence`` of leaves. Returns
    ``(predicate on the attached unit's keywords or None, changes)``, or ``None`` for any other
    shape (a compound condition is not list building)."""
    if ability.get("trigger") is not None:
        return None
    effect = ability.get("effect")
    if not isinstance(effect, Mapping) or effect.get("type") != "conditional":
        return None
    condition, body = effect.get("condition"), effect.get("effect")
    if not isinstance(condition, Mapping) or not isinstance(body, Mapping):
        return None
    if condition.get("type") != "attachment" or condition.get("operator") is not None:
        return None
    params = condition.get("parameters")
    params = params if isinstance(params, Mapping) else {}
    if params.get("role") != "attached" or not _is_bearer(params.get("subject")):
        return None
    predicate = _with_predicate(params.get("with"))
    if predicate is _UNDECIDABLE:
        return None
    steps = body.get("steps")
    leaves = (
        [s for s in steps if isinstance(s, Mapping)]
        if body.get("type") == "sequence" and isinstance(steps, list)
        else [body]
    )
    changes = [change for leaf in leaves for change in _leaf_changes(leaf)]
    return (predicate, changes) if changes else None


def list_building_keyword_changes(
    bearer_abilities: Iterable[Mapping[str, Any]],
    attached_to_keywords: Iterable[str] | None,
) -> list[Change]:
    """The bearer's keyword changes while attached to a unit with ``attached_to_keywords``
    (leader or support attachment), in ability then effect order; none when unattached."""
    if attached_to_keywords is None:
        return []
    attached = list(attached_to_keywords)
    out: list[Change] = []
    for ability in bearer_abilities:
        gated = attachment_keyword_changes(ability)
        if gated is None:
            continue
        predicate, changes = gated
        if predicate is not None and not unit_matches_applies_to(predicate, attached):
            continue
        out.extend(changes)
    return out


def with_keyword_changes(owned: set[str], changes: list[Change]) -> Callable[[str], bool]:
    """Keyword membership over a roster keyword set with the changes applied in order. A
    keyword the set holds keeps its exact spelling test; a change matches any spelling."""
    if not changes:
        return owned.__contains__
    removed: set[str] = set()
    granted: set[str] = set()
    for add, key in changes:
        if add:
            granted.add(key)
            removed.discard(key)
        else:
            removed.add(key)
            granted.discard(key)

    def has(keyword: str) -> bool:
        key = keyword_key(keyword)
        return key in granted or (keyword in owned and key not in removed)

    return has
