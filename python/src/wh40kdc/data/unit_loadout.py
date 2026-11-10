"""One unit's wargear legality at any model count, behind one interface.

Port of ``tools/src/data/unit-loadout.ts``. A unit's MFM loadout rules
(unit-composition ``loadout``) decide where the dump provides them, else its
authored wargear options. :meth:`Dataset.loadout_of` hands these out.

Under MFM rules a unit's model count can split across its loadout rows more
than one way when its tiers allow it (:func:`mfm_row_splits`). A loadout is
legal when it is legal on any split. Defaults, the maximal loadout and
candidates use the bulk split (:func:`mfm_rows`).
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol, TypeVar

from wh40kdc.data.loadout import (
    LOADOUT_CANDIDATES_DEFAULT_LIMIT,
    LoadoutGroup,
    base_loadout,
    check_unit_legality,
    complete_loadout,
    group_loadout,
    loadout_candidates,
    maximal_loadout,
    weapon_bounds,
)
from wh40kdc.data.mfm_loadout import check_mfm_loadout, default_mfm_loadout
from wh40kdc.data.mfm_loadout_bounds import mfm_weapon_bounds
from wh40kdc.data.mfm_loadout_search import (
    MfmConfiguration,
    for_each_mfm_configuration,
    mfm_assignment,
)
from wh40kdc.data.mfm_loadout_unit import (
    mfm_base_loadout,
    mfm_row_splits,
    mfm_rows,
    mfm_unit_candidates,
)

Counts = dict[str, int]
Bounds = dict[str, dict[str, int]]
Violation = dict[str, str]
T = TypeVar("T")

_ORDINAL = re.compile(r"[1-9][0-9]*")


class UnitLoadout(Protocol):
    """A unit's wargear legality at a model count. Counts are copies across the whole unit."""

    # ``mfm`` when the unit's MFM loadout rules decide, ``wargear-options`` when its options do.
    source: str

    def base(self, model_count: int) -> Counts | None:
        """The out-of-the-box loadout; None when no squad size has ``model_count`` models."""

    def bounds(self, model_count: int) -> Bounds | None:
        """Each item's fewest and most copies on any legal loadout; None when unbuildable."""

    def maximal(self, model_count: int) -> Counts | None:
        """The legal loadout adding the most copies over :meth:`base`; first in search order."""

    def check(self, model_count: int, counts: Mapping[str, int]) -> list[Violation]:
        """Violations of ``counts``, by id then code; empty when legal."""

    def groups(self, model_count: int, counts: Mapping[str, int]) -> list[LoadoutGroup] | None:
        """How ``counts`` sit on the models; None for one model or no legal assignment."""

    def complete(self, model_count: int, explicit: Mapping[str, int]) -> dict[str, Any] | None:
        """``{counts, groups}``: a legal loadout holding at least ``explicit``'s copies.

        Nothing beyond the greater of ``explicit`` and the default is carried.
        """

    def candidates(self, model_count: int, limit: float | None = None) -> list[str]:
        """Legal loadouts as encoded candidate strings, up to ``limit``, then a marker."""


def unit_loadout(
    unit: Mapping[str, Any], composition: Mapping[str, Any] | None, options: list[Any]
) -> UnitLoadout:
    """The view for ``unit`` with its faction-scoped ``composition`` and ``options``."""
    if composition is not None and composition.get("loadout") is not None:
        return _MfmView(unit, composition)
    return _OptionsView(unit, composition, options)


def _model_name(row: str) -> str:
    """A row's model name: ``name#k`` names the k-th row called ``name``."""
    hash_at = row.rfind("#")
    return row[:hash_at] if hash_at > 0 and _ORDINAL.fullmatch(row[hash_at + 1 :]) else row


def mfm_group_row_order(composition: Mapping[str, Any]) -> list[str]:
    """The order groups list a composition's loadout rows in.

    By the position of the row's model name among the composition's models,
    then in stock order. A name the models lack sorts last.
    """
    names = [model["name"] for model in composition["models"]]

    def rank(row: str) -> int:
        name = _model_name(row)
        return names.index(name) if name in names else len(names)

    rows = list(default_mfm_loadout(composition["loadout"])[0])
    return [row for _, row in sorted(enumerate(rows), key=lambda p: (rank(p[1]), p[0]))]


def _weapons_of(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [{"id": item["id"], "count": item["count"]} for item in items]


def mfm_groups(configuration: MfmConfiguration, row_order: Sequence[str]) -> list[LoadoutGroup]:
    """A configuration's models as loadout groups.

    Rows in ``row_order`` (:func:`mfm_group_row_order`), a row's bundles most
    models first (ties in search order), bundles of one model name with the
    same items merged into the first, and the unit's own wargear last as one
    unnamed group.
    """

    def rank(row: str) -> int:
        return row_order.index(row) if row in row_order else len(row_order)

    bundles = sorted(
        enumerate(configuration.groups),
        key=lambda p: (rank(p[1]["model"]), -p[1]["count"], p[0]),
    )
    out: list[LoadoutGroup] = []
    for _, bundle in bundles:
        name = _model_name(bundle["model"])
        weapons = _weapons_of(bundle["items"])
        same = next((g for g in out if g["model_name"] == name and g["weapons"] == weapons), None)
        if same is not None:
            same["count"] += bundle["count"]
        else:
            out.append({"model_name": name, "count": bundle["count"], "weapons": weapons})
    if configuration.unit:
        out.append({"model_name": None, "count": 1, "weapons": _weapons_of(configuration.unit)})
    return out


def _memo(compute: Callable[[int], T]) -> Callable[[int], T]:
    cache: dict[int, T] = {}

    def get(model_count: int) -> T:
        if model_count not in cache:
            cache[model_count] = compute(model_count)
        return cache[model_count]

    return get


def _sort_violations(violations: list[Violation]) -> list[Violation]:
    return sorted(violations, key=lambda v: (v["id"], v["code"]))


def _first_covering(
    rules: Mapping[str, Any],
    rows: Mapping[str, int],
    explicit: Mapping[str, int],
    ceiling: Mapping[str, int],
) -> MfmConfiguration | None:
    """The first configuration under ``ceiling`` carrying at least ``explicit``'s copies."""
    found: list[MfmConfiguration] = []

    def visit(configuration: MfmConfiguration) -> bool:
        if any(configuration.counts.get(i, 0) < n for i, n in explicit.items()):
            return False
        found.append(configuration)
        return True

    for_each_mfm_configuration(rules, rows, visit, ceiling)
    return found[0] if found else None


class _MfmView:
    source = "mfm"

    def __init__(self, unit: Mapping[str, Any], composition: Mapping[str, Any]) -> None:
        self._unit_id: str = unit["id"]
        self._composition = composition
        self._rules = composition["loadout"]
        self._row_order = mfm_group_row_order(composition)
        self._splits = _memo(lambda n: mfm_row_splits(composition, n))
        self._base = _memo(self._compute_base)
        self._bounds = _memo(self._compute_bounds)

    def _base_at(self, rows: Mapping[str, int]) -> Counts | None:
        found = mfm_base_loadout(self._rules, rows)
        return found[0] if found is not None else None

    def _compute_base(self, model_count: int) -> Counts | None:
        rows = mfm_rows(self._composition, model_count)
        return self._base_at(rows) if rows is not None else None

    def _compute_bounds(self, model_count: int) -> Bounds | None:
        # Bounds on any split with a legal configuration: the widest range any gives each item.
        # An item a split's bounds lack cannot be carried there, so it counts as 0-0 on it.
        found = [
            bounds
            for rows in self._splits(model_count)
            if (bounds := mfm_weapon_bounds(self._rules, rows)) is not None
        ]
        if not found:
            return None
        zero = {"min": 0, "max": 0}
        ids = sorted({item_id for bounds in found for item_id in bounds})
        return {
            item_id: {
                "min": min(bounds.get(item_id, zero)["min"] for bounds in found),
                "max": max(bounds.get(item_id, zero)["max"] for bounds in found),
            }
            for item_id in ids
        }

    def base(self, model_count: int) -> Counts | None:
        found = self._base(model_count)
        return dict(found) if found is not None else None

    def bounds(self, model_count: int) -> Bounds | None:
        found = self._bounds(model_count)
        return {k: dict(v) for k, v in found.items()} if found is not None else None

    def maximal(self, model_count: int) -> Counts | None:
        rows = mfm_rows(self._composition, model_count)
        if rows is None:
            return None
        stock = self._base_at(rows) or {}
        best: list[Counts] = []
        most = -1

        def visit(configuration: MfmConfiguration) -> bool:
            nonlocal most
            added = sum(max(0, n - stock.get(i, 0)) for i, n in configuration.counts.items())
            if added > most:
                most = added
                best[:] = [configuration.counts]
            return False

        for_each_mfm_configuration(self._rules, rows, visit)
        return best[0] if best else None

    def check(self, model_count: int, counts: Mapping[str, int]) -> list[Violation]:
        splits = self._splits(model_count)
        unit_id = self._unit_id
        if not splits:
            return [
                {
                    "id": unit_id,
                    "code": "invalid-model-count",
                    "message": f"{unit_id}: no squad size has {model_count} models",
                }
            ]
        if any(not check_mfm_loadout(self._rules, rows, counts) for rows in splits):
            return []
        ranges = self._bounds(model_count) or {}
        out: list[Violation] = []
        for item_id in dict.fromkeys([*counts, *ranges]):
            n = counts.get(item_id, 0)
            rng = ranges.get(item_id, {"min": 0, "max": 0})
            if n > rng["max"]:
                out.append(
                    {
                        "id": item_id,
                        "code": "exceeds-max",
                        "message": f"{unit_id}: {n} × {item_id} exceeds the most a legal"
                        f" loadout carries ({rng['max']})",
                    }
                )
            elif n < rng["min"]:
                out.append(
                    {
                        "id": item_id,
                        "code": "below-min",
                        "message": f"{unit_id}: {n} × {item_id} is below the fewest a legal"
                        f" loadout carries ({rng['min']})",
                    }
                )
        if not out:
            out.append(
                {
                    "id": unit_id,
                    "code": "swap-conflict",
                    "message": f"{unit_id}: no legal whole-model assignment carries exactly"
                    " these counts",
                }
            )
        return _sort_violations(out)

    def groups(self, model_count: int, counts: Mapping[str, int]) -> list[LoadoutGroup] | None:
        if model_count <= 1:
            return None
        for rows in self._splits(model_count):
            found = mfm_assignment(self._rules, rows, counts)
            if found is not None:
                return mfm_groups(found, self._row_order)
        return None

    def complete(self, model_count: int, explicit: Mapping[str, int]) -> dict[str, Any] | None:
        for rows in self._splits(model_count):
            ceiling = dict(self._base_at(rows) or {})
            for item_id, n in explicit.items():
                ceiling[item_id] = max(n, ceiling.get(item_id, 0))
            found = _first_covering(self._rules, rows, explicit, ceiling)
            if found is not None:
                return {
                    "counts": dict(found.counts),
                    "groups": mfm_groups(found, self._row_order) if model_count > 1 else None,
                }
        return None

    def candidates(self, model_count: int, limit: float | None = None) -> list[str]:
        if limit is None or not math.isfinite(limit):
            capped = LOADOUT_CANDIDATES_DEFAULT_LIMIT
        else:
            capped = max(0, math.floor(limit))
        return mfm_unit_candidates(self._composition, model_count, capped)


class _OptionsView:
    """A unit the dump gives no loadout rules: its authored wargear options decide."""

    source = "wargear-options"

    def __init__(
        self,
        unit: Mapping[str, Any],
        composition: Mapping[str, Any] | None,
        options: list[Any],
    ) -> None:
        self._unit: Any = unit
        self._options = options
        self._models: Any = (composition or {}).get("models")
        self._tiers: Any = (composition or {}).get("tiers")
        rows_per_size = (
            [tier["models"] for tier in self._tiers]
            if self._tiers
            else ([self._models] if self._models else [])
        )
        self._sizes = [
            (sum(r.get("min") or 0 for r in rows), sum(r.get("max") or 0 for r in rows))
            for rows in rows_per_size
        ]

    def _buildable(self, model_count: int) -> bool:
        # A unit without a composition has no recorded sizes; any count is taken as given.
        return not self._sizes or any(lo <= model_count <= hi for lo, hi in self._sizes)

    def base(self, model_count: int) -> Counts | None:
        if not self._buildable(model_count):
            return None
        return base_loadout(self._unit, model_count, self._options, self._models)

    def bounds(self, model_count: int) -> Bounds | None:
        if not self._buildable(model_count):
            return None
        return weapon_bounds(self._unit, model_count, self._options, self._models)

    def maximal(self, model_count: int) -> Counts | None:
        if not self._buildable(model_count):
            return None
        return maximal_loadout(self._unit, model_count, self._options, self._models)

    def check(self, model_count: int, counts: Mapping[str, int]) -> list[Violation]:
        return check_unit_legality(
            self._unit, model_count, self._options, dict(counts), self._models, self._tiers
        )

    def groups(self, model_count: int, counts: Mapping[str, int]) -> list[LoadoutGroup] | None:
        return group_loadout(self._unit, model_count, self._options, self._models, dict(counts))

    def complete(self, model_count: int, explicit: Mapping[str, int]) -> dict[str, Any] | None:
        return complete_loadout(
            self._unit, model_count, self._options, self._models, dict(explicit)
        )

    def candidates(self, model_count: int, limit: float | None = None) -> list[str]:
        return loadout_candidates(
            self._unit,
            model_count,
            self._options,
            self._models,
            self._tiers,
            None if limit is None else int(limit),
        )
