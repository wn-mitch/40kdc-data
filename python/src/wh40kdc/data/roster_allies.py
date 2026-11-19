"""Allied-pool attribution, caps and locks for the roster checker.

Mirror of TS ``data/roster-allies.ts``; pinned by the ``roster_validation``
conformance corpus.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from wh40kdc.data.dataset import Dataset


def attribute_allies(
    dataset: Dataset,
    faction_id: str | None,
    detachment_ids: list[str],
    army_keyword_set: set[str],
    views: list[Any],
) -> dict[int, dict[str, Any]]:
    """The offered allied rule each foreign roster unit is included through.

    Keyed by index into ``views``. A unit is foreign when its ``faction_id``
    differs from the army's and it carries a Faction keyword the army faction
    lacks. It is attributed to the first offered, non-``exclusive`` rule
    (``allies_for`` order) whose pool (``ally_units_for``) lists its id;
    otherwise it is left out.
    """
    out: dict[int, dict[str, Any]] = {}
    if not faction_id:
        return out
    pools = [
        (rule, {u.id for u in dataset.ally_units_for(rule["id"])})
        for rule in dataset.allies_for(faction_id, detachment_ids)
        if not rule.get("exclusive")
    ]
    for idx, view in enumerate(views):
        if view is None or view.raw.get("faction_id") == faction_id:
            continue
        if all(k in army_keyword_set for k in view.raw.get("faction_keywords") or []):
            continue
        for rule, ids in pools:
            if view.id in ids:
                out[idx] = rule
                break
    return out


def ally_keyword_limit_violations(
    rule: dict[str, Any], members: list[set[str]], battle_size: str | None
) -> list[tuple[str, str, str]]:
    """``(code, id, message)`` keyword-cap violations of one allied rule.

    ``members`` are the keyword sets of the units included through the rule;
    keywords match case-insensitively. Each ``keyword_limits`` cap at
    ``battle_size`` counts the units carrying its keyword, less one counted
    receiver unit per donor unit for each exemption; ``keyword_limits_exclusive``
    allows only one limited keyword present, at any battle size.
    """
    out: list[tuple[str, str, str]] = []
    lowered = [{k.lower() for k in kws} for kws in members]

    def has_all(kws: set[str], need: list[str]) -> bool:
        return all(k.lower() in kws for k in need)

    limits = rule.get("keyword_limits") or []
    for limit in limits:
        if battle_size is None or limit["battle_size"] != battle_size:
            continue
        keyword = limit["keyword"]
        counted = [i for i, kws in enumerate(lowered) if keyword.lower() in kws]
        exempt: set[int] = set()
        for ex in limit.get("exemptions") or []:
            donors = sum(1 for kws in lowered if has_all(kws, ex["donor_keywords"]))
            for i in counted:
                if donors == 0:
                    break
                if i in exempt or not has_all(lowered[i], ex["receiver_keywords"]):
                    continue
                exempt.add(i)
                donors -= 1
        count = len(counted) - len(exempt)
        if count > limit["max_count"]:
            out.append(
                (
                    "ally-keyword-limit-exceeded",
                    f"{rule['id']}:{keyword}",
                    f"{rule['id']} includes {count} {keyword} units, "
                    f"over the limit of {limit['max_count']}",
                )
            )
    if rule.get("keyword_limits_exclusive"):
        keywords = sorted({limit["keyword"] for limit in limits})
        used = [k for k in keywords if any(k.lower() in kws for kws in lowered)]
        if len(used) > 1:
            out.append(
                (
                    "ally-keyword-limits-exclusive",
                    rule["id"],
                    f"{rule['id']} allows only one of {', '.join(keywords)}; "
                    f"the army includes {' and '.join(used)} units",
                )
            )
    return out


class AllyMember(NamedTuple):
    """A roster unit included through an allied rule, as ``ally_pool_violations`` reads it."""

    unit_id: str
    #: Index into the roster's units.
    unit_index: int
    #: The unit's roster cost (host-aware points, wargear and enhancement).
    cost: int
    is_warlord: bool
    has_enhancement: bool
    #: True when the unit is BATTLELINE (role or keyword).
    battleline: bool
    #: The unit's roster keyword set.
    keywords: set[str]


def ally_pool_violations(
    rule: dict[str, Any],
    members: list[AllyMember],
    battle_size: str | None,
    warlord_exempt: set[str],
) -> list[tuple[str, str, str, int | None]]:
    """``(code, id, message, unit_index)`` pool-level violations of one allied rule.

    In order: the ``points_limits`` cap at ``battle_size`` on the members'
    combined cost; the ``cannot_be_warlord`` lock (lifted for a datasheet in
    ``warlord_exempt``); the ``cannot_take_enhancements`` lock; and, for each
    ``battleline_ratio_keywords`` keyword at any battle size, more
    non-BATTLELINE members carrying it than BATTLELINE ones (keywords match
    case-insensitively). ``unit_index`` is None for an army-level violation.
    """
    out: list[tuple[str, str, str, int | None]] = []
    cap = next(
        (
            p["max_points"]
            for p in rule.get("points_limits") or []
            if p.get("battle_size") == battle_size
        ),
        None,
    )
    if cap is not None:
        spent = sum(m.cost for m in members)
        if spent > cap:
            out.append(
                (
                    "ally-points-over-limit",
                    rule["id"],
                    f"{rule['id']} units total {spent}, over the {cap} limit",
                    None,
                )
            )
    for m in members:
        if rule.get("cannot_be_warlord") and m.is_warlord and m.unit_id not in warlord_exempt:
            out.append(
                (
                    "ally-cannot-be-warlord",
                    m.unit_id,
                    f"{m.unit_id} cannot be Warlord under {rule['id']}",
                    m.unit_index,
                )
            )
        if rule.get("cannot_take_enhancements") and m.has_enhancement:
            out.append(
                (
                    "ally-cannot-take-enhancements",
                    m.unit_id,
                    f"{m.unit_id} cannot take an Enhancement under {rule['id']}",
                    m.unit_index,
                )
            )
    for keyword in rule.get("battleline_ratio_keywords") or []:
        lower = keyword.lower()
        battleline = other = 0
        for m in members:
            if not any(k.lower() == lower for k in m.keywords):
                continue
            if m.battleline:
                battleline += 1
            else:
                other += 1
        if other > battleline:
            out.append(
                (
                    "ally-battleline-ratio-exceeded",
                    f"{rule['id']}:{keyword}",
                    f"{rule['id']} includes {other} non-Battleline {keyword} units, "
                    f"more than its {battleline} Battleline {keyword} units",
                    None,
                )
            )
    return out
