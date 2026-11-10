"""Wargear legality against a unit's MFM loadout (unit-composition ``loadout``).

Port of ``tools/src/data/mfm-loadout.ts``; conformance-pinned through the
``mfm_loadout`` corpus. A loadout is legal when its models can be assigned
picks that produce exactly the unit's item counts:

- each model makes ``picks`` choices from every slot on its row, or from its
  row's alternate slots instead of all of them; a slot without a row is filled
  once for the unit;
- every limit holds on the copies of its row (or of the unit): the copies above
  the row's stock, or all copies when the limit lists the stock itself, must be
  the sum of at most the limit's cap of its choices, each taken at most
  ``per_choice`` times. A stock item listed alongside a non-stock item in a
  choice is the item that model keeps, and is not counted;
- in a uniform set, every model on the row (or in the unit) that takes no
  substitute carries the same main option;
- a row (or the unit's own wargear) whose every option for an item is a
  checkbox carries at most one copy per such option, or its stock copies when
  more. A row the app shows per model (see :func:`checkbox_caps`) gets that cap
  on each of its models.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Mapping, Sequence
from functools import partial
from typing import Any

Items = Sequence[Mapping[str, Any]]
Copies = dict[str, int]

# More bundles than this on one row is reported rather than searched.
MAX_BUNDLES = 20_000


def _add(into: Copies, items: Items, times: int = 1) -> None:
    for item in items:
        into[item["id"]] = into.get(item["id"], 0) + item["count"] * times


def _copies_of(items: Items, times: int = 1) -> Copies:
    out: Copies = {}
    _add(out, items, times)
    return out


def _contains(bundle: Mapping[str, int], items: Items) -> bool:
    return len(items) > 0 and all(bundle.get(item["id"], 0) >= item["count"] for item in items)


def _template(rules: Mapping[str, Any], model: str | None) -> Items:
    for entry in rules["templates"]:
        if entry["model"] == model:
            return entry["items"]
    return []


def _pick_combinations(choices: Sequence[Items], picks: int, repeats: bool) -> list[list[Any]]:
    """Every multiset of ``picks`` choices; only the empty choice repeats unless ``repeats``."""
    out: list[list[Any]] = []
    has_empty = any(len(choice) == 0 for choice in choices)

    def walk(start: int, left: int, acc: list[Any]) -> None:
        if left == 0:
            out.append(acc)
            return
        for i in range(start, len(choices)):
            nxt = i if repeats or len(choices[i]) == 0 else i + 1
            walk(nxt, left - 1, [*acc, *choices[i]])

    walk(0, picks if repeats or has_empty else min(picks, len(choices)), [])
    return out


def _slot_choices(slot: Mapping[str, Any], stock: Mapping[str, int]) -> list[Items]:
    """A slot's choices, plus "take nothing" when none of them is part of ``stock``."""
    swap = any(_contains(stock, choice) or len(choice) == 0 for choice in slot["choices"])
    return list(slot["choices"]) if swap else [*slot["choices"], []]


def _model_stock(rules: Mapping[str, Any], model: str) -> Copies:
    """One model's start: its template, or its default copies over its model count."""
    out = _copies_of(_template(rules, model))
    row = next((entry for entry in rules["stock"] if entry.get("model") == model), None)
    if row is not None and row["models"] > 0:
        for item in row["items"]:
            out[item["id"]] = max(out.get(item["id"], 0), math.ceil(item["count"] / row["models"]))
    return out


def _bundle_key(bundle: Copies) -> str:
    return json.dumps(sorted([k, n] for k, n in bundle.items() if n > 0))


def _row_bundles(
    rules: Mapping[str, Any], model: str, counts: Mapping[str, int]
) -> list[Copies] | None:
    """The bundles one model of ``model`` can carry within ``counts``, or None past MAX_BUNDLES."""
    slots = [slot for slot in rules["slots"] if slot.get("model") == model]
    if not slots:
        return [_copies_of(_template(rules, model))]
    stock = _model_stock(rules, model)

    def fits(bundle: list[Any]) -> bool:
        return all(n <= counts.get(k, 0) for k, n in _copies_of(bundle).items())

    def product(group: list[Mapping[str, Any]]) -> list[Copies] | None:
        bundles: list[list[Any]] = [[]]
        for slot in group:
            picks = _pick_combinations(_slot_choices(slot, stock), slot["picks"], slot["repeats"])
            bundles = [
                b for b in ([*bundle, *pick] for bundle in bundles for pick in picks) if fits(b)
            ]
            if len(bundles) > MAX_BUNDLES:
                return None
        return [_copies_of(bundle) for bundle in bundles]

    base = product([slot for slot in slots if not slot["alternate"]])
    alternate = [slot for slot in slots if slot["alternate"]]
    alt = product(alternate) if alternate else []
    if base is None or alt is None:
        return None
    seen: set[str] = set()
    out: list[Copies] = []
    for bundle in [*base, *alt]:
        key = _bundle_key(bundle)
        if key not in seen:
            seen.add(key)
            out.append(bundle)
    return out


def default_mfm_loadout(rules: Mapping[str, Any]) -> tuple[dict[str, int], dict[str, int]]:
    """The default unit's ``(models, counts)``.

    A row with models but no default copies of its own carries its stock
    template on each model; unit-level stock is counted once.
    """
    models: dict[str, int] = {}
    counts: Copies = {}
    for row in rules["stock"]:
        model = row.get("model")
        if model is None:
            _add(counts, row["items"])
            continue
        models[model] = row["models"]
        # A row the default unit has no models of lists what a model brings when added.
        if row["models"] == 0:
            continue
        if row["items"]:
            _add(counts, row["items"])
        else:
            _add(counts, _template(rules, model), row["models"])
    return models, counts


def _per_model_row(rules: Mapping[str, Any], model: str) -> bool:
    """Whether the app shows ``model``'s widgets once per model rather than once for the row."""
    row = next((entry for entry in rules["stock"] if entry.get("model") == model), None)
    default_models = row["models"] if row is not None else 0
    stock = [o for o in rules["options"] if o.get("model") == model and o["default"] > 0]
    return default_models <= 1 and len(stock) > 0 and all(o["input"] == "checkbox" for o in stock)


def checkbox_caps(rules: Mapping[str, Any], model: str | None, models: int = 1) -> dict[str, int]:
    """The most copies of each checkbox-only item ``model`` (or the unit) may carry."""
    caps: dict[str, int] = {}
    steppers: set[str] = set()
    for option in rules["options"]:
        if option.get("model") != model:
            continue
        if option["input"] == "stepper":
            steppers.add(option["id"])
        else:
            caps[option["id"]] = caps.get(option["id"], 0) + 1
    for item_id in steppers:
        caps.pop(item_id, None)
    for row in rules["stock"]:
        if row.get("model") != model:
            continue
        for item in row["items"]:
            if item["id"] in caps:
                caps[item["id"]] = max(caps[item["id"]], item["count"])
    if model is not None and _per_model_row(rules, model):
        caps = {item_id: cap * models for item_id, cap in caps.items()}
    return caps


def limit_cap(limit: Mapping[str, Any], models: int) -> tuple[int, int | None]:
    """The ``(cap, per_choice)`` a limit's breakpoints give a unit of ``models`` models."""
    points = [
        p for p in sorted(limit["breakpoints"], key=lambda p: p["models"]) if p["models"] <= models
    ]
    if not points:
        return 0, None
    return points[-1]["choices"], points[-1].get("per_choice")


def _limit_holds(
    limit: Mapping[str, Any],
    unit_models: int,
    copies: Mapping[str, int],
    baseline: Mapping[str, int],
) -> bool:
    cap, per_choice = limit_cap(limit, unit_models)

    def is_stock(item_id: str) -> bool:
        return baseline.get(item_id, 0) > 0

    stock_choice = any(
        len(choice) > 0
        and all(item["id"] in baseline and baseline[item["id"]] == item["count"] for item in choice)
        for choice in limit["choices"]
    )
    choices = [
        [item for item in choice if not is_stock(item["id"])]
        if any(not is_stock(item["id"]) for item in choice)
        else list(choice)
        for choice in limit["choices"]
    ]
    ids = list(dict.fromkeys(item["id"] for choice in limit["choices"] for item in choice))
    target = [max(0, copies.get(i, 0) - (0 if stock_choice else baseline.get(i, 0))) for i in ids]
    vectors = [
        [sum(item["count"] for item in choice if item["id"] == i) for i in ids]
        for choice in choices
    ]
    failed: set[tuple[int, int, tuple[int, ...]]] = set()

    def fits(index: int, left: int, rest: list[int]) -> bool:
        if all(n == 0 for n in rest):
            return True
        if index >= len(vectors) or left == 0:
            return False
        key = (index, left, tuple(rest))
        if key in failed:
            return False
        most = min(left, per_choice if per_choice is not None else left)
        for use in range(most, -1, -1):
            nxt = [n - v * use for n, v in zip(rest, vectors[index], strict=True)]
            if any(n < 0 for n in nxt):
                continue
            if fits(index + 1, left - use, nxt):
                return True
        failed.add(key)
        return False

    return fits(0, cap, target)


def _held(copies: Mapping[str, int], item_id: str) -> int:
    return copies.get(item_id, 0)


def _violation(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def check_mfm_loadout(
    rules: Mapping[str, Any], models: Mapping[str, int], counts: Mapping[str, int]
) -> list[dict[str, str]]:
    """Violations of ``rules`` by a unit with ``models`` per row carrying ``counts`` copies.

    An empty result means some assignment of picks to models produces exactly ``counts``.
    """
    rows = sorted(model for model, n in models.items() if n > 0)
    unit_models = sum(models.values())

    def baseline_of(model: str | None) -> Copies:
        out: Copies = {}
        for row in rows:
            if model is not None and row != model:
                continue
            _add(out, _template(rules, row), models.get(row, 0))
        return out

    bundles_by_row: dict[str, list[Copies]] = {}
    for row in rows:
        bundles = _row_bundles(rules, row, counts)
        if bundles is None:
            return [
                _violation(
                    "too-many-options",
                    f"{row}: more than {MAX_BUNDLES} wargear combinations to search",
                )
            ]
        bundles_by_row[row] = bundles
    unit_caps = checkbox_caps(rules, None)
    row_caps = {row: checkbox_caps(rules, row, models.get(row, 0)) for row in rows}
    unit_stock = _copies_of(
        [item for row in rules["stock"] if row.get("model") is None for item in row["items"]]
    )
    unit_picks: list[Copies] = [{}]
    for slot in (slot for slot in rules["slots"] if slot.get("model") is None):
        picks = _pick_combinations(_slot_choices(slot, unit_stock), slot["picks"], slot["repeats"])
        nxt: list[Copies] = []
        for acc in unit_picks:
            for pick in picks:
                merged = dict(acc)
                _add(merged, pick)
                nxt.append(merged)
        unit_picks = nxt

    reachable: set[str] = set()
    for bundles in bundles_by_row.values():
        for bundle in bundles:
            reachable.update(k for k, n in bundle.items() if n > 0)
    for unit_pick in unit_picks:
        reachable.update(k for k, n in unit_pick.items() if n > 0)
    # Items a model or the unit could carry at all, before bundles are pruned
    # against the counts, so a count no assignment fits is reported as that.
    carriable: set[str] = set()

    def scoped(model: str | None) -> bool:
        return model is None or model in rows

    for slot in rules["slots"]:
        if scoped(slot.get("model")):
            for choice in slot["choices"]:
                carriable.update(item["id"] for item in choice)
    for entry in [*rules["templates"], *rules["stock"]]:
        if scoped(entry.get("model")):
            carriable.update(item["id"] for item in entry["items"])
    unknown = sorted(k for k, n in counts.items() if n > 0 and k not in carriable)
    if not unknown and any(n > 0 and k not in reachable for k, n in counts.items()):
        return [
            _violation(
                "no-assignment", "no assignment of wargear choices to models gives these counts"
            )
        ]
    if unknown:
        return [_violation("unknown-item", f"no model of this unit can carry {', '.join(unknown)}")]

    ids = sorted({*counts.keys(), *reachable})
    index_of = {item_id: i for i, item_id in enumerate(ids)}

    def vector(copies: Mapping[str, int]) -> list[int]:
        out = [0] * len(ids)
        for item_id, n in copies.items():
            out[index_of[item_id]] += n
        return out

    uniform = rules["uniform"]
    uniform_options = [
        [c for c in s["choices"] if not c["substitute"] and len(c["items"]) > 0] for s in uniform
    ]
    attempts: list[list[int]] = [[]]
    for mains in uniform_options:
        attempts = [[*a, k] for a in attempts for k in range(max(1, len(mains)))]

    def bundle_allowed(row: str, bundle: Copies, attempt: list[int]) -> bool:
        for s, uniform_set in enumerate(uniform):
            model = uniform_set.get("model")
            if model is not None and model != row:
                continue
            mains = uniform_options[s]
            if not mains:
                continue
            if any(
                c["substitute"] and _contains(bundle, c["items"]) for c in uniform_set["choices"]
            ):
                continue
            if not all(
                k == attempt[s] or not _contains(bundle, m["items"]) for k, m in enumerate(mains)
            ):
                return False
        return True

    def within_caps(copies: Callable[[str], int], caps: Mapping[str, int]) -> bool:
        return all(copies(item_id) <= cap for item_id, cap in caps.items())

    def row_limits(row: str, totals: list[int]) -> bool:
        def row_copies(item_id: str) -> int:
            i = index_of.get(item_id)
            return totals[i] if i is not None else 0

        if not within_caps(row_copies, row_caps[row]):
            return False
        for limit in rules["limits"]:
            if limit.get("model") != row:
                continue
            copies = {ids[i]: n for i, n in enumerate(totals) if n > 0}
            if not _limit_holds(limit, unit_models, copies, baseline_of(row)):
                return False
        return True

    total = vector(counts)
    for attempt in attempts:
        allowed = {
            row: [vector(b) for b in bundles_by_row[row] if bundle_allowed(row, b, attempt)]
            for row in rows
        }
        for unit_pick in unit_picks:
            if not within_caps(partial(_held, unit_pick), unit_caps):
                continue
            pick = vector(unit_pick)
            rest = [n - p for n, p in zip(total, pick, strict=True)]
            if any(n < 0 for n in rest):
                continue
            # A unit-wide limit counts the unit's copies, which the counts fix.
            if not all(
                limit.get("model") is not None
                or _limit_holds(limit, unit_models, counts, baseline_of(None))
                for limit in rules["limits"]
            ):
                continue
            if _assign(rows, allowed, models, rest, row_limits):
                return []
    return [
        _violation(
            "no-assignment",
            "no assignment of wargear choices to models gives these counts"
            " within the unit's limits",
        )
    ]


def _assign(
    rows: Sequence[str],
    allowed: Mapping[str, list[list[int]]],
    models: Mapping[str, int],
    rest: list[int],
    row_accepts: Callable[[str, list[int]], bool],
) -> bool:
    """Whether per-row bundle counts use every model and exactly ``rest`` copies."""
    # Failures depend only on the row, the copies left at the row's start and the
    # search position within it, so they are cached on those.
    failed: set[tuple[Any, ...]] = set()

    def walk_row(r: int, left: list[int]) -> bool:
        if r == len(rows):
            return all(n == 0 for n in left)
        row = rows[r]
        bundles = allowed[row]
        start = left
        start_key = tuple(start)

        def walk_bundle(b: int, models_left: int, current: list[int]) -> bool:
            if models_left == 0:
                used = [s - c for s, c in zip(start, current, strict=True)]
                return row_accepts(row, used) and walk_row(r + 1, current)
            if b >= len(bundles):
                return False
            key = (r, start_key, b, models_left, tuple(current))
            if key in failed:
                return False
            bundle = bundles[b]
            most = models_left
            for i, n in enumerate(bundle):
                if n > 0:
                    most = min(most, current[i] // n)
            for take in range(most, -1, -1):
                nxt = (
                    current
                    if take == 0
                    else [c - n * take for c, n in zip(current, bundle, strict=True)]
                )
                if walk_bundle(b + 1, models_left - take, nxt):
                    return True
            failed.add(key)
            return False

        return walk_bundle(0, models.get(row, 0), left)

    return walk_row(0, rest)
