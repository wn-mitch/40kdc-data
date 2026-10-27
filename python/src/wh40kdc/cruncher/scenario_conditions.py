"""Condition evaluators that read declared scenario state, and the attack-comparison buff gate.

The scenario evaluators read which rules are active, which regions a unit is in, how many
objectives each side controls, which units make up a combined unit, and which other units are
near each unit of the attack. Each returns "unknown" when the context does not declare the fact
it needs.

The attack-comparison gate compares the attack's Strength with a unit's Toughness. The engine
supplies the modified characteristics; a comparison whose characteristic the context lacks does
not hold.

Python mirror of ``tools/src/cruncher/scenario-conditions.ts`` plus the attack-comparison
helpers of ``buffs.ts``, ``from-dsl.ts`` and ``engine.ts`` and the neighbour filter of
``unit-filter.ts``. Context fields keep their TS camelCase names:

``attackStrength``, ``targetToughness``, ``targetToughnessMax``, ``targetToughnessMin`` (engine
supplied), ``attackerToughness`` (caller supplied); ``attackerNeighbours`` /
``targetNeighbours`` (complete lists of ``{keywords, owner, distanceInches}``, ``owner``
relative to that unit); ``activeRules`` (complete list of rule ids or
``{ability_id, option_id?, definition_id?}``); ``attackerRegions`` / ``targetRegions`` (complete
lists of ``{ruleRegion?, terrainArea?, territory?, deploymentZone?, wholly?}``);
``objectivesControlled`` (``{attacker, target, total}``); ``attackerMembers`` /
``targetMembers`` (every unit of the combined unit, ``{unitId, role, keywords}``).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, TypeGuard

from wh40kdc.scope import keyword_key

Verdict = bool | str

_PREDICATE_KEYS = ("all_of", "any_of", "none_of", "not_all_of")
_COMPARISONS = ("gt", "gte", "lt", "lte", "eq")


def _is_object(value: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict)


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _other(side: str) -> str:
    return "target" if side == "attacker" else "attacker"


def keyword_matches_predicate(predicate: dict[str, list[str]], keywords: Iterable[str]) -> bool:
    """Match every present clause; an empty ``any_of`` or ``not_all_of`` clause is false."""
    owned = {keyword_key(keyword) for keyword in keywords}

    def has(keyword: str) -> bool:
        return keyword_key(keyword) in owned

    all_of = predicate.get("all_of")
    any_of = predicate.get("any_of")
    none_of = predicate.get("none_of")
    not_all_of = predicate.get("not_all_of")
    return (
        (all_of is None or all(has(k) for k in all_of))
        and (any_of is None or any(has(k) for k in any_of))
        and (none_of is None or not any(has(k) for k in none_of))
        and (not_all_of is None or not all(has(k) for k in not_all_of))
    )


# ---------------------------------------------------------------------------
# attack-compare
# ---------------------------------------------------------------------------


def _attack_operand(value: Any) -> dict[str, Any] | None:
    """A side of an attack comparison the engine supplies: the attack's S, or either unit's T."""
    if not _is_object(value):
        return None
    if len(value) == 1 and _is_num(value.get("value")):
        return {"value": value["value"]}
    if any(key not in ("of", "stat", "reduce") for key in value):
        return None
    of = value.get("of")
    stat = value.get("stat")
    reduce = value.get("reduce")
    if reduce is not None and reduce not in ("max", "min"):
        return None
    if of == "attacker":
        supported = (stat == "S" and reduce is None) or (stat == "T" and reduce != "min")
    else:
        supported = of == "defender" and stat == "T"
    if not supported or not isinstance(stat, str):
        return None
    return (
        {"of": of, "stat": stat} if reduce is None else {"of": of, "stat": stat, "reduce": reduce}
    )


def attack_comparison(params: Any) -> dict[str, Any] | None:
    """Canonical ``attack-compare`` parameters as a gate entry, or None when the engine cannot
    evaluate them."""
    if not _is_object(params) or any(k not in ("left", "comparison", "right") for k in params):
        return None
    left = _attack_operand(params.get("left"))
    right = _attack_operand(params.get("right"))
    comparison = params.get("comparison")
    if left is None or "value" in left or right is None:
        return None
    if comparison not in _COMPARISONS:
        return None
    return {"left": left, "comparison": comparison, "right": right}


def _attack_stat(operand: dict[str, Any], ctx: dict[str, Any]) -> Any:
    """The characteristic an operand names, or None when the context lacks it."""
    if "value" in operand:
        return operand["value"]
    reduce = operand.get("reduce")
    if operand.get("of") == "attacker":
        if operand.get("stat") == "S" and reduce is None:
            return ctx.get("attackStrength")
        if operand.get("stat") == "T" and reduce != "min":
            return ctx.get("attackerToughness")
        return None
    if operand.get("stat") != "T":
        return None
    if reduce == "max":
        return ctx.get("targetToughnessMax")
    if reduce == "min":
        return ctx.get("targetToughnessMin")
    return ctx.get("targetToughness")


def attack_comparison_holds(comparison: dict[str, Any], ctx: dict[str, Any]) -> bool:
    """Whether an attack comparison holds; a missing characteristic does not establish it."""
    left = _attack_stat(comparison["left"], ctx)
    right = _attack_stat(comparison["right"], ctx)
    if not _is_num(left) or not _is_num(right):
        return False
    op = comparison.get("comparison")
    if op == "gt":
        return bool(left > right)
    if op == "gte":
        return bool(left >= right)
    if op == "lt":
        return bool(left < right)
    if op == "lte":
        return bool(left <= right)
    if op == "eq":
        return bool(left == right)
    return False


def attack_comparisons_hold(gate: dict[str, Any], ctx: dict[str, Any]) -> bool:
    """Whether every attack comparison on a gate holds (vacuously true without any)."""
    comparisons = gate.get("attackComparisons")
    return not comparisons or all(attack_comparison_holds(c, ctx) for c in comparisons)


def has_attack_comparison(gate: Any) -> bool:
    """Whether a gate, or a weapon requirement nested in it, carries an attack comparison."""
    if not _is_object(gate):
        return False
    return gate.get("attackComparisons") is not None or any(
        has_attack_comparison(required) for required in gate.get("weaponRequirements") or []
    )


def set_attack_characteristics(
    ctx: dict[str, Any],
    strength: float,
    target_toughness: list[float],
    attacked_toughness: float,
    toughness_mod: float,
) -> None:
    """Record the attack's modified Strength and the target's modified Toughness on ``ctx``: the
    attacked profile's, and the highest and lowest over the target's profiles."""
    modified = [toughness + toughness_mod for toughness in target_toughness]
    ctx["attackStrength"] = strength
    ctx["targetToughness"] = attacked_toughness + toughness_mod
    ctx["targetToughnessMax"] = max(modified)
    ctx["targetToughnessMin"] = min(modified)


# ---------------------------------------------------------------------------
# rule-active, in-region, controls
# ---------------------------------------------------------------------------


def evaluate_rule_active(params: dict[str, Any], ctx: dict[str, Any]) -> Verdict:
    """``rule-active``: a rule id is active when it, or one of its options or definitions, is
    listed; an option or definition reference needs that exact entry."""
    rule = params.get("rule")
    active = ctx.get("activeRules")
    if active is None:
        return "unknown"
    if isinstance(rule, str):
        return any(
            entry == rule if isinstance(entry, str) else entry.get("ability_id") == rule
            for entry in active
        )
    if not _is_object(rule) or not isinstance(rule.get("ability_id"), str):
        return "unknown"
    if isinstance(rule.get("option_id"), str):
        key = "option_id"
    elif isinstance(rule.get("definition_id"), str):
        key = "definition_id"
    else:
        return "unknown"
    return any(
        not isinstance(entry, str)
        and entry.get("ability_id") == rule["ability_id"]
        and entry.get(key) == rule[key]
        for entry in active
    )


def _region_matcher(
    region: dict[str, Any], ability_side: str
) -> Callable[[dict[str, Any]], bool] | None:
    territory = region.get("territory")
    if isinstance(territory, str):
        if territory == "your-territory":
            return lambda entry: entry.get("territory") == ability_side
        if territory == "enemy-territory":
            return lambda entry: entry.get("territory") == _other(ability_side)
        if territory == "attacker-territory":
            return lambda entry: entry.get("territory") == "attacker"
        if territory == "no-mans-land":
            return lambda entry: entry.get("territory") == "no-mans-land"
        if territory == "your-deployment-zone":
            return lambda entry: entry.get("deploymentZone") == ability_side
        if territory == "enemy-deployment-zone":
            return lambda entry: entry.get("deploymentZone") == _other(ability_side)
        return None
    terrain = region.get("terrain_area")
    if _is_object(terrain):
        # A designated terrain area needs designations the scenario does not carry.
        if terrain.get("designated") is None:
            return lambda entry: entry.get("terrainArea") is True
        return None
    rule_region = region.get("rule_region")
    if _is_object(rule_region) and isinstance(rule_region.get("region_id"), str):
        region_id = rule_region["region_id"]
        return lambda entry: entry.get("ruleRegion") == region_id
    return None


def evaluate_in_region(
    params: dict[str, Any], ctx: dict[str, Any], side: str, ability_side: str
) -> Verdict:
    """``in-region`` for the unit on ``side``. Territory and deployment zones are read from the
    ability's side. "Wholly" and "every model" need an entry that declares the unit wholly in it."""
    regions = ctx.get("attackerRegions" if side == "attacker" else "targetRegions")
    region = params.get("region")
    if regions is None or not _is_object(region):
        return "unknown"
    models = params.get("models")
    if models is not None and models not in ("any", "every"):
        return "unknown"
    wholly = params.get("wholly") is True or models == "every"
    matches = _region_matcher(region, ability_side)
    if matches is None:
        return "unknown"
    return any(matches(entry) and (not wholly or entry.get("wholly") is True) for entry in regions)


def _compare(left: float, comparison: Any, right: float) -> Verdict:
    if comparison == "gt":
        return left > right
    if comparison == "gte":
        return left >= right
    if comparison == "lt":
        return left < right
    if comparison == "lte":
        return left <= right
    if comparison == "eq":
        return left == right
    return "unknown"


def evaluate_controls(params: dict[str, Any], ctx: dict[str, Any], ability_side: str) -> Verdict:
    """``controls``: objectives the ``by`` side (friendly unless stated, relative to the ability's
    side) controls, bounded by ``count``, compared with the other side's, or as a ``proportion``
    of every objective. Every stated clause must hold. An objective filter needs per-objective
    state."""
    control = ctx.get("objectivesControlled")
    if not _is_object(control) or params.get("objective") is not None:
        return "unknown"
    if not all(_is_num(control.get(key)) for key in ("attacker", "target", "total")):
        return "unknown"

    def side_of(owner: Any) -> str | None:
        if owner is None or owner == "friendly":
            return ability_side
        if owner == "enemy":
            return _other(ability_side)
        return None

    by = side_of(params.get("by"))
    if by is None:
        return "unknown"
    count = control[by]
    verdicts: list[Verdict] = []
    if "count" in params and params["count"] is not None:
        bounds = params["count"]
        if not _is_object(bounds):
            return "unknown"
        low, high = bounds.get("min"), bounds.get("max")
        if (low is not None and not _is_num(low)) or (high is not None and not _is_num(high)):
            return "unknown"
        verdicts.append((low is None or count >= low) and (high is None or count <= high))
    if params.get("compare") is not None:
        compare = params["compare"]
        against = side_of(compare.get("owner")) if _is_object(compare) else None
        if against is None:
            return "unknown"
        verdicts.append(_compare(count, compare.get("comparison"), control[against]))
    if params.get("proportion") is not None:
        proportion = params["proportion"]
        if (
            not _is_object(proportion)
            or not _is_num(proportion.get("fraction"))
            or control["total"] <= 0
        ):
            return "unknown"
        verdicts.append(
            _compare(count / control["total"], proportion.get("comparison"), proportion["fraction"])
        )
    # Bare `controls` means at least one objective.
    if not verdicts:
        verdicts.append(count >= 1)
    if False in verdicts:
        return False
    return "unknown" if "unknown" in verdicts else True


# ---------------------------------------------------------------------------
# attachment members, within-neighbour filters
# ---------------------------------------------------------------------------


def _keyword_predicate(filt: dict[str, Any]) -> dict[str, list[str]] | None:
    """The keyword clauses of a filter, or None when one is malformed."""
    predicate: dict[str, list[str]] = {}
    for key in _PREDICATE_KEYS:
        value = filt.get(key)
        if value is None:
            continue
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            return None
        predicate[key] = value
    return predicate


def attachment_from_members(role: Any, with_filter: Any, members: Any, own: Any) -> Verdict:
    """``attachment`` facts the combined unit's members settle. ``own`` is the unit the ability
    belongs to. Leading needs ``own`` to be a Leader with a Bodyguard; led needs another member
    that is a Leader; attached needs another member. ``with`` narrows those other members by
    keyword (friendly units only)."""
    if members is None or not isinstance(own, str):
        return "unknown"
    own_member = next((m for m in members if m.get("unitId") == own), None)
    if own_member is None:
        return False
    others = [m for m in members if m.get("unitId") != own]
    if role == "leading":
        candidates = (
            [m for m in others if m.get("role") == "bodyguard"]
            if own_member.get("role") == "leader"
            else []
        )
    elif role == "led":
        candidates = [m for m in others if m.get("role") == "leader"]
    elif role == "attached":
        candidates = others
    else:
        return "unknown"
    if with_filter is None:
        return len(candidates) > 0
    if not _is_object(with_filter):
        return "unknown"
    if with_filter.get("owner") == "enemy":
        return False
    if any(key != "owner" and key not in _PREDICATE_KEYS for key in with_filter):
        return "unknown"
    predicate = _keyword_predicate(with_filter)
    if predicate is None:
        return "unknown"
    return any(keyword_matches_predicate(predicate, m.get("keywords") or []) for m in candidates)


def is_neighbour_filter(of: dict[str, Any]) -> bool:
    """A ``within.of`` that names other units by keyword and owner."""
    if not of:
        return False
    for key, value in of.items():
        if key == "owner":
            if value not in ("friendly", "enemy", "any"):
                return False
        elif key in _PREDICATE_KEYS:
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                return False
        else:
            return False
    return True


def within_neighbour(value: dict[str, Any], neighbours: Any, same_side: bool) -> Verdict:
    """Whether a unit near the filtered unit meets a ``within`` filter's ``of``. The filter's
    owner is relative to the ability's side; a neighbour's owner is relative to the filtered unit,
    so they agree only when the ability belongs to the filtered unit's side."""
    range_ref = value.get("range")
    if not (_is_object(range_ref) and _is_num(range_ref.get("inches")) and len(range_ref) == 1):
        return "unknown"
    if neighbours is None:
        return "unknown"
    of = value["of"]
    inches = range_ref["inches"]
    predicate = {key: of[key] for key in _PREDICATE_KEYS if of.get(key) is not None}
    for neighbour in neighbours:
        owner = neighbour.get("owner")
        if not same_side:
            owner = "enemy" if owner == "friendly" else "friendly"
        if of.get("owner") is not None and of["owner"] != "any" and of["owner"] != owner:
            continue
        if neighbour.get("distanceInches", float("inf")) <= inches and keyword_matches_predicate(
            predicate, neighbour.get("keywords") or []
        ):
            return True
    return False
