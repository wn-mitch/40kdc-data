"""A unit's MFM loadout at a model count.

Port of ``tools/src/data/mfm-loadout-unit.ts``; conformance-pinned through the
``mfm_loadout`` corpus. Gives how a model count splits across the loadout's
model rows, and the default wargear at that size.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from wh40kdc.data.mfm_loadout import (
    Copies,
    _add,
    _template,
    check_mfm_loadout,
    default_mfm_loadout,
)
from wh40kdc.data.mfm_loadout_bounds import mfm_weapon_bounds
from wh40kdc.data.mfm_loadout_search import (
    MfmConfiguration,
    mfm_assignment,
    mfm_configurations,
)

# The marker that ends a candidate list cut at its limit.
MFM_CANDIDATES_TRUNCATED = "…truncated"

# A `name#k` suffix: a positive decimal integer.
_ORDINAL = re.compile(r"[1-9][0-9]*")


def _row_range(tier: Sequence[Mapping[str, Any]], row: str) -> tuple[int, int] | None:
    """The ``(min, max)`` model count a loadout row has in a tier.

    A row written ``name#k``, with ``k`` a positive decimal integer, is the
    k-th of the tier's rows of that name; any other name covers all of the
    tier's rows with that exact name.
    """
    hash_at = row.rfind("#")
    suffix = row[hash_at + 1 :] if hash_at > 0 else ""
    if _ORDINAL.fullmatch(suffix):
        k = int(suffix)
        entries = [model for model in tier if model["name"] == row[:hash_at]]
        if k > len(entries):
            return None
        return entries[k - 1]["min"], entries[k - 1]["max"]
    entries = [model for model in tier if model["name"] == row]
    if not entries:
        return None
    return sum(model["min"] for model in entries), sum(model["max"] for model in entries)


Range = tuple[int, int]


def _tier_ranges(
    composition: Mapping[str, Any],
) -> tuple[dict[str, int], list[dict[str, Range]]] | None:
    """The default rows' model counts and each tier's ``(min, max)`` per row.

    Tiers in declaration order, rows in stock order. A row the tier does not
    list keeps its default count. None without a loadout.
    """
    rules = composition.get("loadout")
    if rules is None:
        return None
    declared = composition.get("tiers") or []
    tiers = [tier["models"] for tier in declared] if declared else [composition["models"]]
    defaults, _ = default_mfm_loadout(rules)
    out: list[dict[str, Range]] = []
    for tier in tiers:
        ranges: dict[str, Range] = {}
        for row, n in defaults.items():
            found = _row_range(tier, row)
            ranges[row] = found if found is not None else (n, n)
        out.append(ranges)
    return defaults, out


def _total(ranges: Mapping[str, Range], side: int) -> int:
    return sum(r[side] for r in ranges.values())


def mfm_rows(composition: Mapping[str, Any], model_count: int) -> dict[str, int] | None:
    """The loadout rows' model counts for a unit of ``model_count`` models.

    None when no tier holds that count. The first tier (in declaration order)
    whose range holds the count fixes each row's range; the default unit's rows
    are clamped into it, and the difference goes to (or comes from) the row with
    the most default models that has room, ties to the first in stock order,
    until the count is reached.
    """
    found = _tier_ranges(composition)
    if found is None:
        return None
    defaults, tiers = found
    order = list(defaults)
    for ranges in tiers:
        if model_count < _total(ranges, 0) or model_count > _total(ranges, 1):
            continue
        rows = {row: min(ranges[row][1], max(ranges[row][0], defaults[row])) for row in order}
        delta = model_count - sum(rows.values())
        while delta != 0:
            grow = delta > 0
            candidates = [
                row
                for row in order
                if (rows[row] < ranges[row][1] if grow else rows[row] > ranges[row][0])
            ]
            # The tier's range holds the count, so some row has room.
            best = candidates[0]
            for row in candidates[1:]:
                if defaults[row] > defaults[best]:
                    best = row
            room = ranges[best][1] - rows[best] if grow else rows[best] - ranges[best][0]
            step = min(room, abs(delta))
            rows[best] += step if grow else -step
            delta += -step if grow else step
        return rows
    return None


def mfm_row_splits(composition: Mapping[str, Any], model_count: int) -> list[dict[str, int]]:
    """Every way a unit of ``model_count`` models splits across its loadout rows under some tier.

    The :func:`mfm_rows` split first, then the rest by tier in declaration
    order, each tier's in ascending order of the rows' counts (rows in stock
    order). Each split is listed once. Empty when no tier holds the count.
    """
    bulk = mfm_rows(composition, model_count)
    found = _tier_ranges(composition)
    if bulk is None or found is None:
        return []
    defaults, tiers = found
    order = list(defaults)
    out = [bulk]
    seen = {tuple(bulk[row] for row in order)}

    def walk(i: int, left: int, lows: list[int], highs: list[int], counts: list[int]) -> None:
        if i == len(order):
            key = tuple(counts)
            if left == 0 and key not in seen:
                seen.add(key)
                out.append(dict(zip(order, counts, strict=True)))
            return
        # The rows after this one must still be able to take what is left.
        rest_low = sum(lows[i + 1 :])
        rest_high = sum(highs[i + 1 :])
        for n in range(max(lows[i], left - rest_high), min(highs[i], left - rest_low) + 1):
            counts.append(n)
            walk(i + 1, left - n, lows, highs, counts)
            counts.pop()

    for ranges in tiers:
        lows = [ranges[row][0] for row in order]
        highs = [ranges[row][1] for row in order]
        walk(0, model_count, lows, highs, [])
    return out


def mfm_resized_default(rules: Mapping[str, Any], rows: Mapping[str, int]) -> dict[str, int] | None:
    """The default unit's copies, resized by each row's template per model gained or lost.

    None when removing models would take copies the default does not have.
    """
    models, counts = default_mfm_loadout(rules)
    out: Copies = dict(counts)
    for row, n in rows.items():
        delta = n - models.get(row, 0)
        if delta != 0:
            _add(out, _template(rules, row), delta)
    if any(n < 0 for n in out.values()):
        return None
    return {i: n for i, n in out.items() if n > 0}


def mfm_scaled_default(rules: Mapping[str, Any], rows: Mapping[str, int]) -> dict[str, int] | None:
    """The default wargear at ``rows``, scaling each row's default copies per model.

    None when a row's copies do not split evenly over its default models, or a
    row the default unit has none of is given models.
    """
    out: Copies = {}
    for row in rules["stock"]:
        model = row.get("model")
        if model is None:
            _add(out, row["items"])
            continue
        n = rows.get(model, 0)
        if n == 0:
            continue
        if row["models"] == 0:
            return None
        items = row["items"] or [
            {"id": item["id"], "count": item["count"] * row["models"]}
            for item in _template(rules, model)
        ]
        for item in items:
            if (item["count"] * n) % row["models"] != 0:
                return None
            out[item["id"]] = out.get(item["id"], 0) + item["count"] * n // row["models"]
    return out


def mfm_base_loadout(
    rules: Mapping[str, Any], rows: Mapping[str, int]
) -> tuple[dict[str, int], bool] | None:
    """The base loadout ``(counts, legal)`` of a unit with ``rows`` models per row.

    The resized default when it is legal, else the scaled default when that
    is, else the resized default (or the scaled one) with ``legal`` False. None
    when neither can be built.
    """
    resized = mfm_resized_default(rules, rows)
    scaled = mfm_scaled_default(rules, rows)
    for counts in (resized, scaled):
        if counts is not None and not check_mfm_loadout(rules, rows, counts):
            return counts, True
    fallback = resized if resized is not None else scaled
    return (fallback, False) if fallback is not None else None


def mfm_unit_violations(
    composition: Mapping[str, Any], model_count: int, counts: Mapping[str, int]
) -> list[dict[str, str]] | None:
    """Violations of a unit of ``model_count`` models carrying ``counts``.

    None when the composition has no loadout.
    """
    if composition.get("loadout") is None:
        return None
    rows = mfm_rows(composition, model_count)
    if rows is None:
        return [
            {
                "code": "invalid-model-count",
                "message": f"no squad size of this unit has {model_count} models",
            }
        ]
    return check_mfm_loadout(composition["loadout"], rows, counts)


def mfm_unit_base_loadout(
    composition: Mapping[str, Any], model_count: int
) -> tuple[dict[str, int], bool] | None:
    rows = mfm_rows(composition, model_count)
    return mfm_base_loadout(composition["loadout"], rows) if rows is not None else None


def mfm_unit_bounds(
    composition: Mapping[str, Any], model_count: int
) -> dict[str, dict[str, int]] | None:
    rows = mfm_rows(composition, model_count)
    return mfm_weapon_bounds(composition["loadout"], rows) if rows is not None else None


def mfm_unit_assignment(
    composition: Mapping[str, Any], model_count: int, counts: Mapping[str, int]
) -> MfmConfiguration | None:
    rows = mfm_rows(composition, model_count)
    return mfm_assignment(composition["loadout"], rows, counts) if rows is not None else None


def _item_list(items: Sequence[Mapping[str, Any]]) -> str:
    return ",".join(f"{item['id']}:{item['count']}" for item in items)


def encode_mfm_configuration(configuration: MfmConfiguration) -> str:
    """A configuration as ``<witness> => <counts>``.

    Each group as ``<row>×<models>[<items per model>]`` in search order, then
    the unit's own wargear as ``unit[<items>]`` when it has any, joined by
    ``; ``; counts as ascending ``id:count`` pairs joined by ``,``.
    """
    groups = [
        f"{group['model']}×{group['count']}[{_item_list(group['items'])}]"
        for group in configuration.groups
    ]
    if configuration.unit:
        groups.append(f"unit[{_item_list(configuration.unit)}]")
    counts = [{"id": i, "count": n} for i, n in sorted(configuration.counts.items())]
    return f"{'; '.join(groups)} => {_item_list(counts)}"


def mfm_unit_candidates(composition: Mapping[str, Any], model_count: int, limit: int) -> list[str]:
    """The legal configurations of a unit of ``model_count`` models, encoded, up to ``limit``.

    In search order, then :data:`MFM_CANDIDATES_TRUNCATED` when more exist.
    Empty when the size cannot be built.
    """
    rows = mfm_rows(composition, model_count)
    if rows is None:
        return []
    configurations, truncated = mfm_configurations(composition["loadout"], rows, limit)
    out = [encode_mfm_configuration(c) for c in configurations]
    if truncated:
        out.append(MFM_CANDIDATES_TRUNCATED)
    return out
