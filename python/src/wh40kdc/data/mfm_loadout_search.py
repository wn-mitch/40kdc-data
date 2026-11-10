"""Legal wargear configurations of a unit under its MFM loadout rules.

Port of ``tools/src/data/mfm-loadout-search.ts``; conformance-pinned through
the ``mfm_loadout`` corpus (see :func:`~wh40kdc.data.mfm_loadout.check_mfm_loadout`
for what legal means). Gives the configurations themselves, and how a given
configuration's copies sit on its models.

Each row's distinct copies are found once, lazily: the walk decides how many of
the row's models carry each bundle (in bundle order, most first). Rows then
combine in code-unit order, after the unit's own picks. A partial configuration
stops as soon as a checkbox cap is exceeded or no allowed sum of a limit's
choices can still cover its copies; both only tighten as copies are added, so
no legal configuration is cut. States are keyed on the copies of the items the
search tracks, so a search that tracks few items visits few states.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from wh40kdc.data.mfm_loadout import (
    Copies,
    _add,
    _template,
    checkbox_caps,
    compile_limit,
    row_bundles,
    uniform_allows,
    uniform_attempts,
    unit_picks_of,
)

# More bundles than this on one row is refused rather than searched.
MAX_SEARCH_BUNDLES = 200_000

Vector = tuple[int, ...]
# One row pick of a leaf: (row, bundle index into the row's bundles, models taking it).
Pick = tuple[str, int, int]


class MfmSearchTooLarge(Exception):
    """A search that cannot run: a row with more bundle choices than the search takes on."""

    def __init__(self, row: str) -> None:
        super().__init__(f"{row}: more than {MAX_SEARCH_BUNDLES} wargear combinations to search")
        self.row = row


def _row_baseline(
    rules: Mapping[str, Any], models: Mapping[str, int], rows: Sequence[str], model: str | None
) -> Copies:
    """The stock a limit on ``model`` (or on the unit, when None) measures above."""
    out: Copies = {}
    for row in rows:
        if model is not None and row != model:
            continue
        _add(out, _template(rules, row), models.get(row, 0))
    return out


@dataclass
class Space:
    """The rows, bundles and unit picks a search over ``rules`` at ``models`` walks."""

    rows: list[str]
    unit_models: int
    bundles: dict[str, list[Copies]]
    unit_picks: list[Copies]
    # Every item the unit can carry, ascending.
    ids: list[str]
    # Items a cap or limit counts, ascending.
    constrained: list[str]


def space_of(rules: Mapping[str, Any], models: Mapping[str, int]) -> Space:
    rows = sorted(model for model, n in models.items() if n > 0)
    unit_models = sum(models.values())
    bundles: dict[str, list[Copies]] = {}
    for row in rows:
        # One model's bundle is part of its row's copies, so a bundle its row's
        # caps or limits already refuse is never carried.
        caps = checkbox_caps(rules, row, models.get(row, 0))
        baseline = _row_baseline(rules, models, rows, row)
        limits = [
            compile_limit(limit, unit_models, baseline)
            for limit in rules["limits"]
            if limit.get("model") == row
        ]

        def fits(
            bundle: Copies,
            caps: Mapping[str, int] = caps,
            limits: list[Any] = limits,
        ) -> bool:
            return all(bundle.get(i, 0) <= cap for i, cap in caps.items()) and all(
                holds([bundle.get(i, 0) for i in ids], True) for ids, holds in limits
            )

        found = row_bundles(rules, row, fits, MAX_SEARCH_BUNDLES)
        if found is None:
            raise MfmSearchTooLarge(row)
        bundles[row] = found
    unit_picks = unit_picks_of(rules)
    ids: set[str] = set()
    for copies in [*(b for row in rows for b in bundles[row]), *unit_picks]:
        ids.update(i for i, n in copies.items() if n > 0)
    constrained: set[str] = set()
    for model in [None, *rows]:
        constrained.update(checkbox_caps(rules, model).keys())
    for limit in rules["limits"]:
        constrained.update(item["id"] for choice in limit["choices"] for item in choice)
    return Space(
        rows=rows,
        unit_models=unit_models,
        bundles=bundles,
        unit_picks=unit_picks,
        ids=sorted(ids),
        constrained=sorted(i for i in constrained if i in ids),
    )


@dataclass
class SearchTests:
    """The rule tests a search over ``tracked`` items runs.

    ``vector`` gives the tracked copies of a set of copies; ``row_holds`` tests
    a row's caps and limits on its own copies; ``unit_holds`` the unit's limits
    on its copies; ``under_ceiling`` the partial-copy ceiling.
    """

    vector: Callable[[Mapping[str, int]], Vector]
    unit_caps: dict[str, int]
    row_holds: Callable[[str, Vector, bool], bool]
    unit_holds: Callable[[Vector, bool], bool]
    under_ceiling: Callable[[Vector], bool]


def search_tests(
    rules: Mapping[str, Any],
    models: Mapping[str, int],
    space: Space,
    tracked: Sequence[str],
    ceiling: Sequence[int] | None = None,
) -> SearchTests:
    index_of = {item_id: i for i, item_id in enumerate(tracked)}
    width = len(tracked)

    def vector(copies: Mapping[str, int]) -> Vector:
        out = [0] * width
        for item_id, n in copies.items():
            i = index_of.get(item_id)
            if i is not None:
                out[i] += n
        return tuple(out)

    def compiled(limit: Mapping[str, Any], baseline: Copies) -> Callable[[Vector, bool], bool]:
        # Each limit's test reads its items from the tracked copies; every item a limit counts
        # is tracked.
        ids, holds = compile_limit(limit, space.unit_models, baseline)
        at = [index_of.get(i) for i in ids]
        return lambda totals, at_least: holds([0 if i is None else totals[i] for i in at], at_least)

    def caps_at(caps: Mapping[str, int]) -> list[tuple[int, int]]:
        # A cap on an untracked item never binds the tracked copies.
        return [(index_of[i], cap) for i, cap in caps.items() if i in index_of]

    unit_caps = checkbox_caps(rules, None)
    row_caps = {row: caps_at(checkbox_caps(rules, row, models.get(row, 0))) for row in space.rows}
    row_limits = {
        row: [
            compiled(limit, _row_baseline(rules, models, space.rows, row))
            for limit in rules["limits"]
            if limit.get("model") == row
        ]
        for row in space.rows
    }
    unit_baseline = _row_baseline(rules, models, space.rows, None)
    unit_limits = [
        compiled(limit, unit_baseline) for limit in rules["limits"] if limit.get("model") is None
    ]

    def row_holds(row: str, own: Vector, at_least: bool) -> bool:
        return all(own[i] <= cap for i, cap in row_caps[row]) and all(
            holds(own, at_least) for holds in row_limits[row]
        )

    def unit_holds(totals: Vector, at_least: bool) -> bool:
        return all(holds(totals, at_least) for holds in unit_limits)

    def under_ceiling(totals: Vector) -> bool:
        return ceiling is None or all(n <= c for n, c in zip(totals, ceiling, strict=True))

    return SearchTests(vector, unit_caps, row_holds, unit_holds, under_ceiling)


@dataclass
class _Leaf:
    """One leaf of a search: the tracked copies and the witness that reached them."""

    totals: Vector
    picks: list[Pick]
    unit_pick: int


class _Lazy:
    """A generator's items by position, produced on first request and kept for later ones."""

    def __init__(self, items: Iterator[tuple[Vector, list[Pick]]]) -> None:
        self._items = items
        self._cache: list[tuple[Vector, list[Pick]]] = []
        self._done = False

    def get(self, k: int) -> tuple[Vector, list[Pick]] | None:
        while not self._done and len(self._cache) <= k:
            try:
                self._cache.append(next(self._items))
            except StopIteration:
                self._done = True
        return self._cache[k] if k < len(self._cache) else None


def _search(
    rules: Mapping[str, Any],
    models: Mapping[str, int],
    space: Space,
    tracked: Sequence[str],
    visit: Callable[[_Leaf], bool],
    ceiling: Sequence[int] | None = None,
) -> None:
    """Calls ``visit`` on each distinct tracked total, the first configuration to reach it.

    ``visit`` returns True to stop.
    """
    tests = search_tests(rules, models, space, tracked, ceiling)
    vector, row_holds, unit_holds, under_ceiling = (
        tests.vector,
        tests.row_holds,
        tests.unit_holds,
        tests.under_ceiling,
    )
    zero: Vector = (0,) * len(tracked)

    def row_copies(
        row: str, bundles: list[tuple[int, Vector]], n: int
    ) -> Iterator[tuple[Vector, list[Pick]]]:
        """The distinct copies ``n`` models of ``row`` can carry within its caps and limits.

        Each comes with the first picks found for it. The walk picks the next
        bundle any remaining model carries, from bundle ``b`` on, and how many
        carry it (most first), so it recurses no deeper than the row's models.
        """
        found: set[Vector] = set()
        walked: set[tuple[Vector, int, int]] = set()
        picks: list[Pick] = []

        def walk(b: int, left: int, own: Vector) -> Iterator[tuple[Vector, list[Pick]]]:
            if left == 0:
                if own not in found and row_holds(row, own, False):
                    found.add(own)
                    yield own, list(picks)
                return
            for j in range(b, len(bundles)):
                # Walking on from bundle j with these copies covers every later bundle too,
                # so a position already walked ends the loop.
                key = (own, left, j)
                if key in walked:
                    return
                walked.add(key)
                index, bundle = bundles[j]
                for take in range(left, 0, -1):
                    nxt = tuple(k + v * take for k, v in zip(own, bundle, strict=True))
                    if (
                        not under_ceiling(nxt)
                        or not row_holds(row, nxt, True)
                        or not unit_holds(nxt, True)
                    ):
                        continue
                    picks.append((row, index, take))
                    yield from walk(j + 1, left - take, nxt)
                    picks.pop()

        yield from walk(0, n, zero)

    def combine(
        r: int,
        totals: Vector,
        u: int,
        row_results: list[_Lazy],
        walked: set[tuple[Vector, int]],
        stack: list[list[Pick]],
    ) -> bool:
        """Combines rows ``r`` on onto ``totals``; True when ``visit`` stops the search.

        ``walked`` holds the combinations already walked under unit pick ``u``,
        whose completions were visited; ``stack`` the picks of rows before ``r``.
        """
        if r == len(space.rows):
            if not unit_holds(totals, False) or totals in seen:
                return False
            seen.add(totals)
            return visit(_Leaf(totals, [p for group in stack for p in group], u))
        key = (totals, r)
        if key in walked:
            return False
        walked.add(key)
        k = 0
        while True:
            result = row_results[r].get(k)
            k += 1
            if result is None:
                return False
            own, picks = result
            nxt = tuple(a + b for a, b in zip(totals, own, strict=True))
            if not under_ceiling(nxt) or not unit_holds(nxt, True):
                continue
            stack.append(picks)
            stop = combine(r + 1, nxt, u, row_results, walked, stack)
            stack.pop()
            if stop:
                return True

    seen: set[Vector] = set()
    for attempt in uniform_attempts(rules):
        # Bundles with the same tracked copies are interchangeable to the search, so only the
        # first of each is walked.
        allowed: dict[str, list[tuple[int, Vector]]] = {}
        for row in space.rows:
            kept: list[tuple[int, Vector]] = []
            keys: set[Vector] = set()
            for index, bundle in enumerate(space.bundles[row]):
                if not uniform_allows(rules, row, bundle, attempt):
                    continue
                projected = vector(bundle)
                if projected in keys:
                    continue
                keys.add(projected)
                kept.append((index, projected))
            allowed[row] = kept
        # Each row's distinct own copies, found once: a row's copies are part of the unit's, so
        # a row the unit's limits or the ceiling already refuse is cut here too.
        row_results = [
            _Lazy(row_copies(row, allowed[row], models.get(row, 0))) for row in space.rows
        ]
        for u, unit_pick in enumerate(space.unit_picks):
            if any(unit_pick.get(i, 0) > cap for i, cap in tests.unit_caps.items()):
                continue
            start = vector(unit_pick)
            if not under_ceiling(start) or not unit_holds(start, True):
                continue
            # Combinations already walked under this unit pick: their completions were visited.
            if combine(0, start, u, row_results, set(), []):
                return


def _items_of(copies: Mapping[str, int]) -> list[dict[str, Any]]:
    return [{"id": i, "count": n} for i, n in sorted(copies.items()) if n > 0]


@dataclass
class MfmConfiguration:
    """A legal configuration: the unit's item copies and the models that carry them."""

    counts: dict[str, int]
    # Row groups as {model, count, items}: rows in code-unit order, bundles in bundle order.
    groups: list[dict[str, Any]] = field(default_factory=list)
    # The unit's own wargear (slots and stock without a row).
    unit: list[dict[str, Any]] = field(default_factory=list)


def _configuration_of(space: Space, leaf: _Leaf) -> MfmConfiguration:
    return MfmConfiguration(
        counts={space.ids[i]: n for i, n in enumerate(leaf.totals) if n > 0},
        groups=[
            {"model": row, "count": take, "items": _items_of(space.bundles[row][bundle])}
            for row, bundle, take in leaf.picks
        ],
        unit=_items_of(space.unit_picks[leaf.unit_pick]),
    )


def mfm_configurations(
    rules: Mapping[str, Any], models: Mapping[str, int], limit: int
) -> tuple[list[MfmConfiguration], bool]:
    """The unit's distinct legal configurations at ``models``, in search order, up to ``limit``.

    The second value says more exist.
    """
    space = space_of(rules, models)
    configurations: list[MfmConfiguration] = []
    truncated = False

    def visit(leaf: _Leaf) -> bool:
        nonlocal truncated
        if len(configurations) == limit:
            truncated = True
            return True
        configurations.append(_configuration_of(space, leaf))
        return False

    _search(rules, models, space, space.ids, visit)
    return configurations, truncated


def mfm_assignment(
    rules: Mapping[str, Any], models: Mapping[str, int], counts: Mapping[str, int]
) -> MfmConfiguration | None:
    """How ``counts`` sit on the unit's models at ``models`` models per row.

    The first configuration the search finds with exactly these copies, or
    None when none is legal.
    """
    space = space_of(rules, models)
    known = set(space.ids)
    if any(n > 0 and i not in known for i, n in counts.items()):
        return None
    ceiling = tuple(counts.get(i, 0) for i in space.ids)
    found: list[MfmConfiguration] = []

    def visit(leaf: _Leaf) -> bool:
        if leaf.totals != ceiling:
            return False
        found.append(_configuration_of(space, leaf))
        return True

    _search(rules, models, space, space.ids, visit, ceiling)
    return found[0] if found else None


def for_each_mfm_configuration(
    rules: Mapping[str, Any],
    models: Mapping[str, int],
    visit: Callable[[MfmConfiguration], bool | None],
    ceiling: Mapping[str, int] | None = None,
) -> None:
    """Calls ``visit`` on each distinct legal configuration, in search order, until it returns True.

    With ``ceiling``, only configurations carrying no more than its copies of
    each item are walked; an item it leaves out may not be carried.
    """
    space = space_of(rules, models)
    bound = None if ceiling is None else tuple(ceiling.get(i, 0) for i in space.ids)
    _search(
        rules,
        models,
        space,
        space.ids,
        lambda leaf: visit(_configuration_of(space, leaf)) is True,
        bound,
    )
