package wh40kdc

import "iter"

// The configuration search's walk (port of `search` in
// tools/src/data/mfm-loadout-search.ts). Its order is load-bearing: unit picks
// in order, rows in code-unit order, and within a row the next bundle any
// remaining model carries, from the current bundle on, with the most models
// first. A configuration is the first to reach its tracked counts.

// mfmPick is `take` models of row carrying the row's bundle at index bundle.
type mfmPick struct {
	row          string
	bundle, take int
}

// mfmLeaf is one leaf of a search: the tracked copies and the witness that
// reached them.
type mfmLeaf struct {
	totals   []int
	picks    []mfmPick
	unitPick int
}

// mfmRowResult is one distinct set of a row's own tracked copies, with the
// first picks found for it.
type mfmRowResult struct {
	own   []int
	picks []mfmPick
}

// mfmKept is a bundle the walk takes: its index in the row's bundles and its
// tracked copies.
type mfmKept struct {
	index  int
	vector []int
}

// mfmLazy is a sequence's items by position, produced on first request and
// kept for later ones.
type mfmLazy struct {
	next  func() (mfmRowResult, bool)
	stop  func()
	cache []mfmRowResult
	done  bool
}

func (l *mfmLazy) get(k int) (mfmRowResult, bool) {
	for !l.done && len(l.cache) <= k {
		item, ok := l.next()
		if !ok {
			l.done = true
		} else {
			l.cache = append(l.cache, item)
		}
	}
	if k < len(l.cache) {
		return l.cache[k], true
	}
	return mfmRowResult{}, false
}

// search walks every legal configuration of space, tracking only tracked
// items, and calls visit on each distinct tracked total (the first
// configuration to reach it). visit returns true to stop.
func (r *MfmLoadoutRules) search(models map[string]int, space *mfmSpace, tracked []string, ceiling []int, visit func(mfmLeaf) bool) {
	t := r.searchTests(models, space, tracked, ceiling)
	mains := r.uniformMains()
	seen := map[mfmKey]bool{}
	for _, attempt := range r.uniformAttempts() {
		if r.searchAttempt(t, models, space, mains, attempt, seen, visit) {
			return
		}
	}
}

// searchAttempt walks the configurations under one uniform attempt; true when
// visit stopped the search.
func (r *MfmLoadoutRules) searchAttempt(t *mfmTests, models map[string]int, space *mfmSpace, mains [][][]mfmItem, attempt []int, seen map[mfmKey]bool, visit func(mfmLeaf) bool) bool {
	// Bundles with the same tracked copies are interchangeable to the search, so
	// only the first of each is walked.
	rowResults := make([]*mfmLazy, len(space.rows))
	for i, row := range space.rows {
		var kept []mfmKept
		keys := map[mfmKey]bool{}
		for index, bundle := range space.bundles[row] {
			if !r.uniformAllows(mains, row, bundle, attempt) {
				continue
			}
			projected := t.vector(bundle)
			key := t.keyOf(projected)
			if keys[key] {
				continue
			}
			keys[key] = true
			kept = append(kept, mfmKept{index, projected})
		}
		next, stop := iter.Pull(t.rowCopies(row, kept, models[row]))
		rowResults[i] = &mfmLazy{next: next, stop: stop}
	}
	defer func() {
		for _, lazy := range rowResults {
			lazy.stop()
		}
	}()
	for u, unitPick := range space.unitPicks {
		if !t.withinUnitCaps(unitPick) {
			continue
		}
		start := t.vector(unitPick)
		if !t.underCeiling(start) || !t.unitHolds(start, true) {
			continue
		}
		// Combinations already walked under this unit pick: their completions
		// were visited.
		walked := map[mfmKey]bool{}
		var picks [][]mfmPick
		var combine func(ri int, totals []int) bool
		combine = func(ri int, totals []int) bool {
			if ri == len(space.rows) {
				if !t.unitHolds(totals, false) {
					return false
				}
				key := t.keyOf(totals)
				if seen[key] {
					return false
				}
				seen[key] = true
				var flat []mfmPick
				for _, p := range picks {
					flat = append(flat, p...)
				}
				return visit(mfmLeaf{totals: totals, picks: flat, unitPick: u})
			}
			key := t.at(t.keyOf(totals), len(space.rows)+1, ri)
			if walked[key] {
				return false
			}
			walked[key] = true
			for k := 0; ; k++ {
				result, ok := rowResults[ri].get(k)
				if !ok {
					break
				}
				next := mfmAddScaled(totals, result.own, 1)
				if !t.underCeiling(next) || !t.unitHolds(next, true) {
					continue
				}
				picks = append(picks, result.picks)
				stop := combine(ri+1, next)
				picks = picks[:len(picks)-1]
				if stop {
					return true
				}
			}
			return false
		}
		if combine(0, start) {
			return true
		}
	}
	return false
}

// rowCopies yields the distinct copies n models of row can carry within its
// caps and limits, each with the first picks found for it. The walk picks the
// next bundle any remaining model carries, from bundle b on, and how many carry
// it (most first), so it recurses no deeper than the row's models.
func (t *mfmTests) rowCopies(row string, bundles []mfmKept, n int) iter.Seq[mfmRowResult] {
	return func(yield func(mfmRowResult) bool) {
		found := map[mfmKey]bool{}
		walked := map[mfmKey]bool{}
		var picks []mfmPick
		// walk returns false once yield asks to stop.
		var walk func(b, left int, own []int) bool
		walk = func(b, left int, own []int) bool {
			if left == 0 {
				key := t.keyOf(own)
				if !found[key] && t.rowHolds(row, own, false) {
					found[key] = true
					return yield(mfmRowResult{own: own, picks: append([]mfmPick(nil), picks...)})
				}
				return true
			}
			prefix := t.at(t.keyOf(own), t.maxModels+1, left)
			for j := b; j < len(bundles); j++ {
				// Walking on from bundle j with these copies covers every later
				// bundle too, so a position already walked ends the loop.
				key := t.at(prefix, t.maxBundles+1, j)
				if walked[key] {
					return true
				}
				walked[key] = true
				for take := left; take >= 1; take-- {
					next := mfmAddScaled(own, bundles[j].vector, take)
					if !t.underCeiling(next) || !t.rowHolds(row, next, true) || !t.unitHolds(next, true) {
						continue
					}
					picks = append(picks, mfmPick{row: row, bundle: bundles[j].index, take: take})
					if !walk(j+1, left-take, next) {
						return false
					}
					picks = picks[:len(picks)-1]
				}
			}
			return true
		}
		walk(0, n, make([]int, t.width))
	}
}
