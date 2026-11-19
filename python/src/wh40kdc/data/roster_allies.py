"""Allied-pool attribution and keyword caps for the roster checker.

Mirror of TS ``data/roster-allies.ts``; pinned by the ``roster_validation``
conformance corpus.
"""

from __future__ import annotations

from typing import Any

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
