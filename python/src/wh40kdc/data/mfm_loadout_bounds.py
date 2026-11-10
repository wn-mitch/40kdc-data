"""Each item's fewest and most copies over a unit's legal MFM loadout configurations.

Port of ``tools/src/data/mfm-loadout-bounds.ts``; conformance-pinned through
the ``mfm_loadout`` corpus. Legality depends only on the items a cap or limit
counts, so the search walks those items' copies and carries, for every other
item, the fewest and most copies any path to the same state holds. Rows are
independent once their counted copies are fixed, so a unit's interval for an
item is the sum of its rows' intervals, and the bounds are exact.
"""

from __future__ import annotations

from collections.abc import Hashable, Mapping
from dataclasses import dataclass
from typing import Any

from wh40kdc.data.mfm_loadout import uniform_allows, uniform_attempts
from wh40kdc.data.mfm_loadout_search import Vector, search_tests, space_of


@dataclass
class _State:
    """Counted copies with the fewest (``lo``) and most (``hi``) copies of every other item."""

    own: Vector
    lo: list[int]
    hi: list[int]
    left: int = 0


def _merge(into: dict[Hashable, _State], key: Hashable, state: _State) -> None:
    """Adds ``state`` under ``key``, widening the intervals of a state already there."""
    known = into.get(key)
    if known is None:
        into[key] = state
        return
    for i, (lo, hi) in enumerate(zip(state.lo, state.hi, strict=True)):
        if lo < known.lo[i]:
            known.lo[i] = lo
        if hi > known.hi[i]:
            known.hi[i] = hi


def mfm_weapon_bounds(
    rules: Mapping[str, Any], models: Mapping[str, int]
) -> dict[str, dict[str, int]] | None:
    """Each item's ``{min, max}`` copies over the unit's legal configurations at ``models``.

    Covers every item the unit can carry; None when it has no legal configuration.
    """
    space = space_of(rules, models)
    counted = space.constrained
    counted_set = set(counted)
    free = [i for i in space.ids if i not in counted_set]
    tests = search_tests(rules, models, space, counted)

    def free_of(copies: Mapping[str, int]) -> list[int]:
        return [copies.get(i, 0) for i in free]

    lows: list[int | None] = [None] * len(space.ids)
    highs: list[int | None] = [None] * len(space.ids)
    position = {item_id: i for i, item_id in enumerate(space.ids)}
    counted_at = [position[i] for i in counted]
    free_at = [position[i] for i in free]
    zero_counted: Vector = (0,) * len(counted)
    legal = False

    def widen(at: int, lo: int, hi: int) -> None:
        low, high = lows[at], highs[at]
        lows[at] = lo if low is None else min(low, lo)
        highs[at] = hi if high is None else max(high, hi)

    for attempt in uniform_attempts(rules):
        row_results: list[list[_State]] = []
        for row in space.rows:
            # Bundles with the same counted copies are one choice; each other item ranges
            # over theirs.
            groups: dict[Hashable, _State] = {}
            for bundle in space.bundles[row]:
                if not uniform_allows(rules, row, bundle, attempt):
                    continue
                own = tests.vector(bundle)
                copies = free_of(bundle)
                _merge(groups, own, _State(own, copies, list(copies)))
            n = models.get(row, 0)
            layer: dict[Hashable, _State] = {
                (zero_counted, n): _State(zero_counted, [0] * len(free), [0] * len(free), n)
            }
            for group in groups.values():
                nxt: dict[Hashable, _State] = {}
                for state in layer.values():
                    for take in range(state.left + 1):
                        own = (
                            state.own
                            if take == 0
                            else tuple(
                                k + g * take for k, g in zip(state.own, group.own, strict=True)
                            )
                        )
                        # The tests only tighten as copies are added, so a failing take ends
                        # the loop.
                        if take > 0 and (
                            not tests.row_holds(row, own, True) or not tests.unit_holds(own, True)
                        ):
                            break
                        left = state.left - take
                        lo = [k + g * take for k, g in zip(state.lo, group.lo, strict=True)]
                        hi = [k + g * take for k, g in zip(state.hi, group.hi, strict=True)]
                        _merge(nxt, (own, left), _State(own, lo, hi, left))
                layer = nxt
            results: dict[Hashable, _State] = {}
            for state in layer.values():
                if state.left == 0 and tests.row_holds(row, state.own, False):
                    _merge(results, state.own, state)
            row_results.append(list(results.values()))

        for unit_pick in space.unit_picks:
            if any(unit_pick.get(i, 0) > cap for i, cap in tests.unit_caps.items()):
                continue
            start = tests.vector(unit_pick)
            if not tests.unit_holds(start, True):
                continue
            states: dict[Hashable, _State] = {
                start: _State(start, free_of(unit_pick), free_of(unit_pick))
            }
            for results_of_row in row_results:
                combined: dict[Hashable, _State] = {}
                for state in states.values():
                    for result in results_of_row:
                        own = tuple(k + r for k, r in zip(state.own, result.own, strict=True))
                        if not tests.unit_holds(own, True):
                            continue
                        _merge(
                            combined,
                            own,
                            _State(
                                own,
                                [k + r for k, r in zip(state.lo, result.lo, strict=True)],
                                [k + r for k, r in zip(state.hi, result.hi, strict=True)],
                            ),
                        )
                states = combined
            for state in states.values():
                if not tests.unit_holds(state.own, False):
                    continue
                legal = True
                for i, at in enumerate(counted_at):
                    widen(at, state.own[i], state.own[i])
                for i, at in enumerate(free_at):
                    widen(at, state.lo[i], state.hi[i])
    if not legal:
        return None
    out: dict[str, dict[str, int]] = {}
    for i, item_id in enumerate(space.ids):
        low, high = lows[i], highs[i]
        # A legal state widens every item, counted or free.
        assert low is not None and high is not None
        out[item_id] = {"min": low, "max": high}
    return out
