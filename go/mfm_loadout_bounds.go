package wh40kdc

import "math"

// Each item's fewest and most copies over a unit's legal configurations under
// its MFM loadout rules. Port of tools/src/data/mfm-loadout-bounds.ts.
//
// Legality depends only on the items a cap or limit counts, so the search
// walks those items' copies and carries, for every other item, the fewest and
// most copies any path to the same state holds. Rows are independent once
// their counted copies are fixed, so a unit's interval for an item is the sum
// of its rows' intervals, and the bounds are exact.

// MfmBound is an item's fewest and most copies.
type MfmBound struct{ Min, Max int }

// mfmBoundState is counted copies with the fewest (lo) and most (hi) copies of
// every other item, and the models a row still has to place.
type mfmBoundState struct {
	own, lo, hi []int
	left        int
}

// mfmBoundStates is states by key, in first-insertion order.
type mfmBoundStates struct {
	order []mfmKey
	byKey map[mfmKey]*mfmBoundState
}

func newMfmBoundStates() *mfmBoundStates {
	return &mfmBoundStates{byKey: map[mfmKey]*mfmBoundState{}}
}

// merge adds state under key, widening the intervals of a state already there.
// The stored state owns its slices.
func (m *mfmBoundStates) merge(key mfmKey, state mfmBoundState) {
	known, ok := m.byKey[key]
	if !ok {
		m.order = append(m.order, key)
		m.byKey[key] = &state
		return
	}
	for i := range state.lo {
		known.lo[i] = min(known.lo[i], state.lo[i])
		known.hi[i] = max(known.hi[i], state.hi[i])
	}
}

func (m *mfmBoundStates) each(f func(*mfmBoundState)) {
	for _, key := range m.order {
		f(m.byKey[key])
	}
}

// MfmWeaponBounds is each item's fewest and most copies over the unit's legal
// configurations at `models` models per row, for every item it can carry; nil
// when it has no legal configuration.
func MfmWeaponBounds(r *MfmLoadoutRules, models map[string]int) (map[string]MfmBound, error) {
	space, err := r.spaceOf(models)
	if err != nil {
		return nil, err
	}
	counted := space.constrained
	countedSet := map[string]bool{}
	for _, id := range counted {
		countedSet[id] = true
	}
	var free []string
	for _, id := range space.ids {
		if !countedSet[id] {
			free = append(free, id)
		}
	}
	t := r.searchTests(models, space, counted, nil)
	freeOf := func(copies mfmCopies) []int {
		out := make([]int, len(free))
		for i, id := range free {
			out[i] = copies[id]
		}
		return out
	}
	position := map[string]int{}
	for i, id := range space.ids {
		position[id] = i
	}
	lows := make([]int, len(space.ids))
	highs := make([]int, len(space.ids))
	for i := range lows {
		lows[i], highs[i] = math.MaxInt, math.MinInt
	}
	legal := false
	mains := r.uniformMains()

	for _, attempt := range r.uniformAttempts() {
		rowResults := make([][]*mfmBoundState, len(space.rows))
		for ri, row := range space.rows {
			// Bundles with the same counted copies are one choice; each other item
			// ranges over theirs.
			groups := newMfmBoundStates()
			for _, bundle := range space.bundles[row] {
				if !r.uniformAllows(mains, row, bundle, attempt) {
					continue
				}
				own := t.vector(bundle)
				copies := freeOf(bundle)
				groups.merge(t.keyOf(own), mfmBoundState{own: own, lo: copies, hi: append([]int(nil), copies...)})
			}
			n := models[row]
			layer := newMfmBoundStates()
			zero := make([]int, len(counted))
			layer.merge(t.at(t.keyOf(zero), t.maxModels+1, n), mfmBoundState{own: zero, lo: make([]int, len(free)), hi: make([]int, len(free)), left: n})
			groups.each(func(group *mfmBoundState) {
				next := newMfmBoundStates()
				layer.each(func(state *mfmBoundState) {
					for take := 0; take <= state.left; take++ {
						own := state.own
						if take > 0 {
							own = mfmAddScaled(state.own, group.own, take)
							// The tests only tighten as copies are added, so a failing
							// take ends the loop.
							if !t.rowHolds(row, own, true) || !t.unitHolds(own, true) {
								break
							}
						}
						left := state.left - take
						next.merge(t.at(t.keyOf(own), t.maxModels+1, left), mfmBoundState{
							own:  own,
							lo:   mfmAddScaled(state.lo, group.lo, take),
							hi:   mfmAddScaled(state.hi, group.hi, take),
							left: left,
						})
					}
				})
				layer = next
			})
			results := newMfmBoundStates()
			layer.each(func(state *mfmBoundState) {
				if state.left == 0 && t.rowHolds(row, state.own, false) {
					results.merge(t.keyOf(state.own), mfmBoundState{own: state.own, lo: append([]int(nil), state.lo...), hi: append([]int(nil), state.hi...)})
				}
			})
			results.each(func(state *mfmBoundState) { rowResults[ri] = append(rowResults[ri], state) })
		}

		for _, unitPick := range space.unitPicks {
			if !t.withinUnitCaps(unitPick) {
				continue
			}
			start := t.vector(unitPick)
			if !t.unitHolds(start, true) {
				continue
			}
			states := newMfmBoundStates()
			states.merge(t.keyOf(start), mfmBoundState{own: start, lo: freeOf(unitPick), hi: freeOf(unitPick)})
			for _, results := range rowResults {
				next := newMfmBoundStates()
				states.each(func(state *mfmBoundState) {
					for _, result := range results {
						own := mfmAddScaled(state.own, result.own, 1)
						if !t.unitHolds(own, true) {
							continue
						}
						next.merge(t.keyOf(own), mfmBoundState{
							own: own,
							lo:  mfmAddScaled(state.lo, result.lo, 1),
							hi:  mfmAddScaled(state.hi, result.hi, 1),
						})
					}
				})
				states = next
			}
			states.each(func(state *mfmBoundState) {
				if !t.unitHolds(state.own, false) {
					return
				}
				legal = true
				for i, id := range counted {
					at := position[id]
					lows[at] = min(lows[at], state.own[i])
					highs[at] = max(highs[at], state.own[i])
				}
				for i, id := range free {
					at := position[id]
					lows[at] = min(lows[at], state.lo[i])
					highs[at] = max(highs[at], state.hi[i])
				}
			})
		}
	}
	if !legal {
		return nil, nil
	}
	out := make(map[string]MfmBound, len(space.ids))
	for i, id := range space.ids {
		out[id] = MfmBound{Min: lows[i], Max: highs[i]}
	}
	return out, nil
}
