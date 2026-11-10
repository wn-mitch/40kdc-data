package wh40kdc

import (
	"sort"
	"strconv"
)

// Enumerates the legal wargear configurations of a unit under its MFM loadout
// rules (see CheckMfmLoadout for what legal means). Port of
// tools/src/data/mfm-loadout-search.ts; conformance-pinned through the
// mfm_loadout corpus, whose candidates and groups depend on search order.
//
// Each row's distinct copies are found once, lazily: the walk decides how many
// of the row's models carry each bundle (in bundle order, most first). Rows
// then combine in code-unit order, after the unit's own picks. A partial
// configuration stops as soon as a checkbox cap is exceeded or no allowed sum
// of a limit's choices can still cover its copies; both only tighten as copies
// are added, so no legal configuration is cut.

// mfmMaxSearchBundles caps the bundles one row may have for the search.
const mfmMaxSearchBundles = 200_000

// mfmRowBundle is Count models of loadout row Model, each carrying Items (per
// model, ascending by id).
type mfmRowBundle struct {
	Model string
	Count int
	Items []mfmItem
}

// MfmConfiguration is a legal configuration: the unit's item copies and the
// models that carry them. Groups are rows in code-unit order, bundles in bundle
// order; Unit is the unit's own wargear (slots and stock without a row).
type MfmConfiguration struct {
	Counts map[string]int
	Groups []mfmRowBundle
	Unit   []mfmItem
}

// mfmSpace is the rows, bundles and unit picks a search walks.
type mfmSpace struct {
	rows       []string
	unitModels int
	bundles    map[string][]mfmCopies
	unitPicks  []mfmCopies
	// ids is every item the unit can carry, ascending.
	ids []string
	// constrained is the items a cap or limit counts, ascending.
	constrained []string
}

// rowBaseline is the stock a limit on model (or on the unit, when nil)
// measures above: templates per model.
func (r *MfmLoadoutRules) rowBaseline(models map[string]int, rows []string, model *string) mfmCopies {
	out := mfmCopies{}
	for _, row := range rows {
		if model != nil && row != *model {
			continue
		}
		mfmAdd(out, r.template(row), models[row])
	}
	return out
}

// spaceOf builds the search space at `models` models per row, or an error when
// a row has more than mfmMaxSearchBundles bundles.
func (r *MfmLoadoutRules) spaceOf(models map[string]int) (*mfmSpace, error) {
	var rows []string
	unitModels := 0
	for model, n := range models {
		unitModels += n
		if n > 0 {
			rows = append(rows, model)
		}
	}
	sort.Strings(rows)
	bundles := map[string][]mfmCopies{}
	for _, row := range rows {
		// One model's bundle is part of its row's copies, so a bundle its row's
		// caps or limits already refuse is never carried.
		model := row
		caps := r.checkboxCaps(&model, models[row])
		baseline := r.rowBaseline(models, rows, &model)
		var limits []mfmCompiledLimit
		for i := range r.Limits {
			if r.Limits[i].Model != nil && *r.Limits[i].Model == row {
				limits = append(limits, r.Limits[i].compileLimit(unitModels, baseline))
			}
		}
		found, ok := r.rowBundles(row, func(bundle mfmCopies) bool {
			for id, cap := range caps {
				if bundle[id] > cap {
					return false
				}
			}
			for _, limit := range limits {
				at := make([]int, len(limit.ids))
				for i, id := range limit.ids {
					at[i] = bundle[id]
				}
				if !limit.holds(at, true) {
					return false
				}
			}
			return true
		}, mfmMaxSearchBundles)
		if !ok {
			return nil, &MfmSearchTooLarge{Row: row}
		}
		bundles[row] = found
	}
	unitPicks := r.unitPicksOf()
	idSet := map[string]bool{}
	for _, row := range rows {
		for _, copies := range bundles[row] {
			for id, n := range copies {
				if n > 0 {
					idSet[id] = true
				}
			}
		}
	}
	for _, copies := range unitPicks {
		for id, n := range copies {
			if n > 0 {
				idSet[id] = true
			}
		}
	}
	constrainedSet := map[string]bool{}
	for id := range r.checkboxCaps(nil, 1) {
		constrainedSet[id] = true
	}
	for _, row := range rows {
		model := row
		for id := range r.checkboxCaps(&model, 1) {
			constrainedSet[id] = true
		}
	}
	for _, limit := range r.Limits {
		for _, choice := range limit.Choices {
			for _, item := range choice {
				constrainedSet[item.ID] = true
			}
		}
	}
	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var constrained []string
	for _, id := range ids {
		if constrainedSet[id] {
			constrained = append(constrained, id)
		}
	}
	return &mfmSpace{rows: rows, unitModels: unitModels, bundles: bundles, unitPicks: unitPicks, ids: ids, constrained: constrained}, nil
}

// mfmKey is a search-state key: a number where the state fits one, else a
// string. Either encoding is injective on the states a search visits.
type mfmKey struct {
	n uint64
	s string
}

// mfmCap is a checkbox cap on the item at a tracked index.
type mfmCap struct{ at, cap int }

// mfmTests is the rule tests a search over tracked items runs.
type mfmTests struct {
	indexOf    map[string]int
	width      int
	unitCaps   map[string]int
	rowCaps    map[string][]mfmCap
	rowLimits  map[string][]func([]int, bool) bool
	unitLimits []func([]int, bool) bool
	ceiling    []int
	numeric    bool
	weights    []uint64
	maxModels  int
	maxBundles int
}

// searchTests compiles the tests a search over `tracked` items runs: the
// tracked copies of a set of copies, each row's caps and limits on its own
// copies, the unit's limits on its copies, and a key for a vector of tracked
// copies. A nil ceiling cuts nothing.
func (r *MfmLoadoutRules) searchTests(models map[string]int, space *mfmSpace, tracked []string, ceiling []int) *mfmTests {
	t := &mfmTests{indexOf: map[string]int{}, width: len(tracked), ceiling: ceiling, rowCaps: map[string][]mfmCap{}, rowLimits: map[string][]func([]int, bool) bool{}}
	for i, id := range tracked {
		t.indexOf[id] = i
	}
	t.unitCaps = r.checkboxCaps(nil, 1)
	// Each limit's test reads its items from the tracked copies; every item a
	// limit counts is tracked.
	compiled := func(limit *mfmLimit, baseline mfmCopies) func([]int, bool) bool {
		c := limit.compileLimit(space.unitModels, baseline)
		at := make([]int, len(c.ids))
		for i, id := range c.ids {
			at[i] = -1
			if k, ok := t.indexOf[id]; ok {
				at[i] = k
			}
		}
		return func(totals []int, atLeast bool) bool {
			copies := make([]int, len(at))
			for i, k := range at {
				if k >= 0 {
					copies[i] = totals[k]
				}
			}
			return c.holds(copies, atLeast)
		}
	}
	for _, row := range space.rows {
		model := row
		var caps []mfmCap
		for id, cap := range r.checkboxCaps(&model, models[row]) {
			if k, ok := t.indexOf[id]; ok {
				caps = append(caps, mfmCap{k, cap})
			}
		}
		t.rowCaps[row] = caps
		baseline := r.rowBaseline(models, space.rows, &model)
		for i := range r.Limits {
			if r.Limits[i].Model != nil && *r.Limits[i].Model == row {
				t.rowLimits[row] = append(t.rowLimits[row], compiled(&r.Limits[i], baseline))
			}
		}
	}
	unitBaseline := r.rowBaseline(models, space.rows, nil)
	for i := range r.Limits {
		if r.Limits[i].Model == nil {
			t.unitLimits = append(t.unitLimits, compiled(&r.Limits[i], unitBaseline))
		}
	}

	// States are keyed by number where they fit: each tracked item's copies in a
	// radix one more than the most the unit could carry, then the position in
	// the walk.
	span := 1.0
	for _, id := range tracked {
		n := 0
		for _, row := range space.rows {
			per := 0
			for _, bundle := range space.bundles[row] {
				per = max(per, bundle[id])
			}
			n += per * models[row]
		}
		most := 0
		for _, pick := range space.unitPicks {
			most = max(most, pick[id])
		}
		n += most
		t.weights = append(t.weights, uint64(span))
		span *= float64(n + 1)
	}
	for _, row := range space.rows {
		t.maxModels = max(t.maxModels, models[row])
		t.maxBundles = max(t.maxBundles, len(space.bundles[row]))
	}
	t.numeric = span*float64(t.maxModels+1)*float64(t.maxBundles+1)*float64(len(space.rows)+1) < float64(1<<53-1)
	return t
}

func (t *mfmTests) vector(copies mfmCopies) []int {
	out := make([]int, t.width)
	for id, n := range copies {
		if i, ok := t.indexOf[id]; ok {
			out[i] += n
		}
	}
	return out
}

func (t *mfmTests) rowHolds(row string, own []int, atLeast bool) bool {
	for _, c := range t.rowCaps[row] {
		if own[c.at] > c.cap {
			return false
		}
	}
	for _, holds := range t.rowLimits[row] {
		if !holds(own, atLeast) {
			return false
		}
	}
	return true
}

func (t *mfmTests) unitHolds(totals []int, atLeast bool) bool {
	for _, holds := range t.unitLimits {
		if !holds(totals, atLeast) {
			return false
		}
	}
	return true
}

func (t *mfmTests) withinUnitCaps(pick mfmCopies) bool {
	for id, cap := range t.unitCaps {
		if pick[id] > cap {
			return false
		}
	}
	return true
}

func (t *mfmTests) underCeiling(totals []int) bool {
	if t.ceiling == nil {
		return true
	}
	for i, n := range totals {
		if n > t.ceiling[i] {
			return false
		}
	}
	return true
}

func (t *mfmTests) keyOf(totals []int) mfmKey {
	if t.numeric {
		var n uint64
		for i, k := range totals {
			n += uint64(k) * t.weights[i]
		}
		return mfmKey{n: n}
	}
	b := make([]byte, 0, 4*len(totals))
	for i, k := range totals {
		if i > 0 {
			b = append(b, ',')
		}
		b = strconv.AppendInt(b, int64(k), 10)
	}
	return mfmKey{s: string(b)}
}

func (t *mfmTests) at(key mfmKey, radix, position int) mfmKey {
	if t.numeric {
		return mfmKey{n: key.n*uint64(radix) + uint64(position)}
	}
	return mfmKey{s: key.s + "|" + strconv.Itoa(position)}
}

func mfmAddScaled(own, bundle []int, take int) []int {
	next := make([]int, len(own))
	for i := range own {
		next[i] = own[i] + bundle[i]*take
	}
	return next
}

// mfmItemsOf is copies as items, ascending by id, without zero counts.
func mfmItemsOf(copies mfmCopies) []mfmItem {
	out := []mfmItem{}
	for id, n := range copies {
		if n > 0 {
			out = append(out, mfmItem{ID: id, Count: n})
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a].ID < out[b].ID })
	return out
}

func (space *mfmSpace) configurationOf(leaf mfmLeaf) MfmConfiguration {
	counts := map[string]int{}
	for i, n := range leaf.totals {
		if n > 0 {
			counts[space.ids[i]] = n
		}
	}
	groups := make([]mfmRowBundle, 0, len(leaf.picks))
	for _, p := range leaf.picks {
		groups = append(groups, mfmRowBundle{Model: p.row, Count: p.take, Items: mfmItemsOf(space.bundles[p.row][p.bundle])})
	}
	return MfmConfiguration{Counts: counts, Groups: groups, Unit: mfmItemsOf(space.unitPicks[leaf.unitPick])}
}

// MfmConfigurations is the unit's distinct legal configurations at `models`
// models per row, in search order, up to limit; truncated says more exist.
func MfmConfigurations(r *MfmLoadoutRules, models map[string]int, limit int) (configurations []MfmConfiguration, truncated bool, err error) {
	space, err := r.spaceOf(models)
	if err != nil {
		return nil, false, err
	}
	configurations = []MfmConfiguration{}
	r.search(models, space, space.ids, nil, func(leaf mfmLeaf) bool {
		if len(configurations) == limit {
			truncated = true
			return true
		}
		configurations = append(configurations, space.configurationOf(leaf))
		return false
	})
	return configurations, truncated, nil
}

// MfmAssignment is how counts sit on the unit's models at `models` models per
// row: the first configuration the search finds with exactly these copies, or
// nil when none is legal.
func MfmAssignment(r *MfmLoadoutRules, models, counts map[string]int) (*MfmConfiguration, error) {
	space, err := r.spaceOf(models)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, id := range space.ids {
		known[id] = true
	}
	for id, n := range counts {
		if n > 0 && !known[id] {
			return nil, nil
		}
	}
	ceiling := make([]int, len(space.ids))
	for i, id := range space.ids {
		ceiling[i] = counts[id]
	}
	var found *MfmConfiguration
	r.search(models, space, space.ids, ceiling, func(leaf mfmLeaf) bool {
		for i, n := range leaf.totals {
			if n != ceiling[i] {
				return false
			}
		}
		configuration := space.configurationOf(leaf)
		found = &configuration
		return true
	})
	return found, nil
}

// forEachMfmConfiguration calls visit on each distinct legal configuration at
// `models` models per row, in search order, until it returns true. With a
// non-nil ceiling, only configurations carrying no more than its copies of
// each item are walked; an item it leaves out may not be carried.
func forEachMfmConfiguration(r *MfmLoadoutRules, models map[string]int, visit func(MfmConfiguration) bool, ceiling map[string]int) error {
	space, err := r.spaceOf(models)
	if err != nil {
		return err
	}
	var bound []int
	if ceiling != nil {
		bound = make([]int, len(space.ids))
		for i, id := range space.ids {
			bound[i] = ceiling[id]
		}
	}
	r.search(models, space, space.ids, bound, func(leaf mfmLeaf) bool { return visit(space.configurationOf(leaf)) })
	return nil
}
