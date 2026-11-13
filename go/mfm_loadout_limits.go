package wh40kdc

import (
	"sort"
	"strconv"
)

// Limits, uniform sets and the unit's own picks of an MFM loadout, shared by
// the checker (mfm_loadout_check.go) and the configuration search
// (mfm_loadout_search.go). Port of the matching tools/src/data/mfm-loadout.ts
// functions.

// limitCap is the cap (and per-choice ceiling, -1 for none) a limit's
// breakpoints give a unit of `models` models.
func (l *mfmLimit) limitCap(models int) (int, int) {
	order := make([]int, len(l.Breakpoints))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return l.Breakpoints[order[a]].Models < l.Breakpoints[order[b]].Models })
	cap, perChoice := 0, -1
	for _, i := range order {
		point := l.Breakpoints[i]
		if point.Models <= models {
			cap, perChoice = point.Choices, -1
			if point.PerChoice != nil {
				perChoice = *point.PerChoice
			}
		}
	}
	return cap, perChoice
}

// mfmCompiledLimit is a limit's test fixed to a scope's stock baseline and a
// unit size: holds takes the scope's copies of each of ids, in that order.
type mfmCompiledLimit struct {
	ids   []string
	holds func(copies []int, atLeast bool) bool
}

// compileLimit fixes a limit to a scope's stock baseline and a unit of
// unitModels models. Its test says whether copies of the limit's items fit it,
// or with atLeast, whether some allowed sum of its choices covers them, which
// holds for every partial count a fitting count can grow from. The copies above
// the baseline, or all copies when the limit lists the baseline itself as a
// choice, must be the sum of at most the cap of its choices.
func (l *mfmLimit) compileLimit(unitModels int, baseline mfmCopies) mfmCompiledLimit {
	cap, perChoice := l.limitCap(unitModels)
	isStock := func(id string) bool { return baseline[id] > 0 }
	stockChoice := false
	for _, choice := range l.Choices {
		if len(choice) == 0 {
			continue
		}
		all := true
		for _, item := range choice {
			if n, ok := baseline[item.ID]; !ok || n != item.Count {
				all = false
				break
			}
		}
		if all {
			stockChoice = true
			break
		}
	}
	var ids []string
	seenID := map[string]bool{}
	for _, choice := range l.Choices {
		for _, item := range choice {
			if !seenID[item.ID] {
				seenID[item.ID] = true
				ids = append(ids, item.ID)
			}
		}
	}
	over := make([]int, len(ids))
	if !stockChoice {
		for i, id := range ids {
			over[i] = baseline[id]
		}
	}
	vectors := make([][]int, len(l.Choices))
	for c, choice := range l.Choices {
		keep := choice
		for _, item := range choice {
			if !isStock(item.ID) {
				keep = nil
				for _, kept := range choice {
					if !isStock(kept.ID) {
						keep = append(keep, kept)
					}
				}
				break
			}
		}
		vectors[c] = make([]int, len(ids))
		for i, id := range ids {
			for _, item := range keep {
				if item.ID == id {
					vectors[c][i] += item.Count
				}
			}
		}
	}
	answers := map[string]bool{}
	holds := func(copies []int, atLeast bool) bool {
		target := make([]int, len(ids))
		for i := range ids {
			target[i] = max(0, copies[i]-over[i])
		}
		flag := 0
		if atLeast {
			flag = 1
		}
		answerKey := string(mfmIntsKey(nil, flag, target))
		if known, ok := answers[answerKey]; ok {
			return known
		}
		failed := map[string]bool{}
		var fits func(index, left int, rest []int) bool
		fits = func(index, left int, rest []int) bool {
			if mfmAllAtMostZero(rest) {
				return true
			}
			if index >= len(vectors) || left == 0 {
				return false
			}
			key := string(mfmIntsKey(mfmIntsKey(nil, index, nil), left, rest))
			if failed[key] {
				return false
			}
			most := left
			if perChoice >= 0 && perChoice < most {
				most = perChoice
			}
			for use := most; use >= 0; use-- {
				next := make([]int, len(rest))
				negative := false
				for i := range rest {
					next[i] = rest[i] - vectors[index][i]*use
					if atLeast && next[i] < 0 {
						next[i] = 0
					}
					if next[i] < 0 {
						negative = true
					}
				}
				if negative {
					continue
				}
				if fits(index+1, left-use, next) {
					return true
				}
			}
			failed[key] = true
			return false
		}
		answer := fits(0, cap, target)
		answers[answerKey] = answer
		return answer
	}
	return mfmCompiledLimit{ids: ids, holds: holds}
}

// limitHolds reports whether copies of a limit's items fit it, given the
// scope's stock baseline (see compileLimit).
func (l *mfmLimit) limitHolds(unitModels int, copies, baseline mfmCopies, atLeast bool) bool {
	compiled := l.compileLimit(unitModels, baseline)
	at := make([]int, len(compiled.ids))
	for i, id := range compiled.ids {
		at[i] = copies[id]
	}
	return compiled.holds(at, atLeast)
}

// mfmIntsKey appends `head` and then `xs` to key, each followed by a separator.
func mfmIntsKey(key []byte, head int, xs []int) []byte {
	key = strconv.AppendInt(key, int64(head), 10)
	key = append(key, '|')
	for _, x := range xs {
		key = strconv.AppendInt(key, int64(x), 10)
		key = append(key, ',')
	}
	return key
}

func mfmAllZero(xs []int) bool {
	for _, x := range xs {
		if x != 0 {
			return false
		}
	}
	return true
}

func mfmAllAtMostZero(xs []int) bool {
	for _, x := range xs {
		if x > 0 {
			return false
		}
	}
	return true
}

// unitPicksOf is the unit's own picks: one pick combination per slot without a
// row, multiplied out.
func (r *MfmLoadoutRules) unitPicksOf() []mfmCopies {
	unitStock := mfmCopies{}
	for _, row := range r.Stock {
		if row.Model == nil {
			mfmAdd(unitStock, row.Items, 1)
		}
	}
	unitPicks := []mfmCopies{{}}
	for _, slot := range r.Slots {
		if slot.Model != nil {
			continue
		}
		picks := mfmPickCombinations(mfmSlotChoices(slot.Choices, unitStock), slot.Picks, slot.Repeats)
		var next []mfmCopies
		for _, acc := range unitPicks {
			for _, pick := range picks {
				merged := mfmCopies{}
				for id, n := range acc {
					merged[id] = n
				}
				mfmAdd(merged, pick, 1)
				next = append(next, merged)
			}
		}
		unitPicks = next
	}
	return unitPicks
}

// uniformMains is each uniform set's main options: its choices that are not
// substitutes and carry an item.
func (r *MfmLoadoutRules) uniformMains() [][][]mfmItem {
	mains := make([][][]mfmItem, len(r.Uniform))
	for s, set := range r.Uniform {
		for _, choice := range set.Choices {
			if !choice.Substitute && len(choice.Items) > 0 {
				mains[s] = append(mains[s], choice.Items)
			}
		}
	}
	return mains
}

// uniformAttempts is every way to fix each uniform set's main option: one index
// per set into its main options.
func (r *MfmLoadoutRules) uniformAttempts() [][]int {
	attempts := [][]int{{}}
	for _, mains := range r.uniformMains() {
		var next [][]int
		for _, attempt := range attempts {
			for k := 0; k < max(1, len(mains)); k++ {
				next = append(next, append(append([]int{}, attempt...), k))
			}
		}
		attempts = next
	}
	return attempts
}

// uniformAllows reports whether a model of row may carry bundle when each
// uniform set's main option is the one attempt fixes: a model in a set's scope
// that takes another main option without a substitute is excluded. mains is
// uniformMains().
func (r *MfmLoadoutRules) uniformAllows(mains [][][]mfmItem, row string, bundle mfmCopies, attempt []int) bool {
	for s, set := range r.Uniform {
		if set.Model != nil && *set.Model != row {
			continue
		}
		if len(mains[s]) == 0 {
			continue
		}
		substituted := false
		for _, choice := range set.Choices {
			if choice.Substitute && mfmContains(bundle, choice.Items) {
				substituted = true
				break
			}
		}
		if substituted {
			continue
		}
		for k, main := range mains[s] {
			if k != attempt[s] && mfmContains(bundle, main) {
				return false
			}
		}
	}
	return true
}
