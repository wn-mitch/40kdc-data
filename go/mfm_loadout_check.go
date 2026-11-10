package wh40kdc

import (
	"fmt"
	"sort"
	"strings"
)

// CheckMfmLoadout returns the violations of rules by a unit with `models`
// models per row carrying `counts` item copies. An empty result means some
// assignment of picks to models produces exactly counts.
func CheckMfmLoadout(r *MfmLoadoutRules, models, counts map[string]int) []MfmLoadoutViolation {
	var rows []string
	unitModels := 0
	for model, n := range models {
		unitModels += n
		if n > 0 {
			rows = append(rows, model)
		}
	}
	sort.Strings(rows)
	inRows := map[string]bool{}
	for _, row := range rows {
		inRows[row] = true
	}

	baselineOf := func(model *string) mfmCopies {
		out := mfmCopies{}
		for _, row := range rows {
			if model != nil && row != *model {
				continue
			}
			mfmAdd(out, r.template(row), models[row])
		}
		return out
	}

	bundlesByRow := map[string][]mfmCopies{}
	for _, row := range rows {
		bundles, ok := r.rowBundles(row, func(bundle mfmCopies) bool {
			for id, n := range bundle {
				if n > counts[id] {
					return false
				}
			}
			return true
		}, mfmMaxBundles)
		if !ok {
			return []MfmLoadoutViolation{{Code: "too-many-options", Message: fmt.Sprintf("%s: more than %d wargear combinations to search", row, mfmMaxBundles)}}
		}
		bundlesByRow[row] = bundles
	}
	unitCaps := r.checkboxCaps(nil, 1)
	rowCaps := map[string]map[string]int{}
	for _, row := range rows {
		model := row
		rowCaps[row] = r.checkboxCaps(&model, models[row])
	}
	unitPicks := r.unitPicksOf()

	reachable := map[string]bool{}
	for _, bundles := range bundlesByRow {
		for _, bundle := range bundles {
			for id, n := range bundle {
				if n > 0 {
					reachable[id] = true
				}
			}
		}
	}
	for _, pick := range unitPicks {
		for id, n := range pick {
			if n > 0 {
				reachable[id] = true
			}
		}
	}
	// Items a model or the unit could carry at all, before bundles are pruned
	// against the counts, so a count no assignment fits is reported as that.
	carriable := map[string]bool{}
	scoped := func(model *string) bool { return model == nil || inRows[*model] }
	for _, slot := range r.Slots {
		if scoped(slot.Model) {
			for _, choice := range slot.Choices {
				for _, item := range choice {
					carriable[item.ID] = true
				}
			}
		}
	}
	for _, entry := range r.Templates {
		if inRows[entry.Model] {
			for _, item := range entry.Items {
				carriable[item.ID] = true
			}
		}
	}
	for _, entry := range r.Stock {
		if scoped(entry.Model) {
			for _, item := range entry.Items {
				carriable[item.ID] = true
			}
		}
	}
	var unknown []string
	unreachable := false
	for id, n := range counts {
		if n <= 0 {
			continue
		}
		if !carriable[id] {
			unknown = append(unknown, id)
		}
		if !reachable[id] {
			unreachable = true
		}
	}
	sort.Strings(unknown)
	if len(unknown) == 0 && unreachable {
		return []MfmLoadoutViolation{{Code: "no-assignment", Message: "no assignment of wargear choices to models gives these counts"}}
	}
	if len(unknown) > 0 {
		return []MfmLoadoutViolation{{Code: "unknown-item", Message: "no model of this unit can carry " + strings.Join(unknown, ", ")}}
	}

	idSet := map[string]bool{}
	for id := range counts {
		idSet[id] = true
	}
	for id := range reachable {
		idSet[id] = true
	}
	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	indexOf := map[string]int{}
	for i, id := range ids {
		indexOf[id] = i
	}
	vector := func(copies mfmCopies) []int {
		out := make([]int, len(ids))
		for id, n := range copies {
			out[indexOf[id]] += n
		}
		return out
	}

	mains := r.uniformMains()
	attempts := r.uniformAttempts()
	rowAccepts := func(row string, totals []int) bool {
		for id, cap := range rowCaps[row] {
			held := 0
			if i, ok := indexOf[id]; ok {
				held = totals[i]
			}
			if held > cap {
				return false
			}
		}
		for i := range r.Limits {
			limit := &r.Limits[i]
			if limit.Model == nil || *limit.Model != row {
				continue
			}
			copies := mfmCopies{}
			for j, n := range totals {
				if n > 0 {
					copies[ids[j]] = n
				}
			}
			model := row
			if !limit.limitHolds(unitModels, copies, baselineOf(&model), false) {
				return false
			}
		}
		return true
	}

	total := vector(counts)
	for _, attempt := range attempts {
		allowed := map[string][][]int{}
		for _, row := range rows {
			var vectors [][]int
			for _, bundle := range bundlesByRow[row] {
				if r.uniformAllows(mains, row, bundle, attempt) {
					vectors = append(vectors, vector(bundle))
				}
			}
			allowed[row] = vectors
		}
	picks:
		for _, unitPick := range unitPicks {
			for id, cap := range unitCaps {
				if unitPick[id] > cap {
					continue picks
				}
			}
			pick := vector(unitPick)
			rest := make([]int, len(total))
			for i := range total {
				rest[i] = total[i] - pick[i]
				if rest[i] < 0 {
					continue picks
				}
			}
			// A unit-wide limit counts the unit's copies, which the counts fix.
			for i := range r.Limits {
				limit := &r.Limits[i]
				if limit.Model == nil && !limit.limitHolds(unitModels, counts, baselineOf(nil), false) {
					continue picks
				}
			}
			if mfmAssign(rows, allowed, models, rest, rowAccepts) {
				return []MfmLoadoutViolation{}
			}
		}
	}
	return []MfmLoadoutViolation{{Code: "no-assignment", Message: "no assignment of wargear choices to models gives these counts within the unit's limits"}}
}

// mfmAssign searches for per-row bundle counts that use every model and
// exactly `rest` copies, where each row's own copies pass rowAccepts.
func mfmAssign(rows []string, allowed map[string][][]int, models map[string]int, rest []int, rowAccepts func(string, []int) bool) bool {
	// Failures depend only on the row, the copies left at the row's start and
	// the search position within it, so they are cached on those.
	failed := map[string]bool{}
	var walkRow func(r int, left []int) bool
	walkRow = func(r int, left []int) bool {
		if r == len(rows) {
			return mfmAllZero(left)
		}
		row := rows[r]
		bundles := allowed[row]
		start := left
		startKey := fmt.Sprint(start)
		var walkBundle func(b, modelsLeft int, current []int) bool
		walkBundle = func(b, modelsLeft int, current []int) bool {
			if modelsLeft == 0 {
				used := make([]int, len(start))
				for i := range start {
					used[i] = start[i] - current[i]
				}
				return rowAccepts(row, used) && walkRow(r+1, current)
			}
			if b >= len(bundles) {
				return false
			}
			key := fmt.Sprint(r, "|", startKey, "|", b, "|", modelsLeft, "|", current)
			if failed[key] {
				return false
			}
			bundle := bundles[b]
			most := modelsLeft
			for i, n := range bundle {
				if n > 0 && current[i]/n < most {
					most = current[i] / n
				}
			}
			for take := most; take >= 0; take-- {
				next := current
				if take > 0 {
					next = make([]int, len(current))
					for i := range current {
						next[i] = current[i] - bundle[i]*take
					}
				}
				if walkBundle(b+1, modelsLeft-take, next) {
					return true
				}
			}
			failed[key] = true
			return false
		}
		return walkBundle(0, models[row], left)
	}
	return walkRow(0, rest)
}
