package wh40kdc

import (
	"fmt"
	"math"
	"sort"
	"sync"
)

// The two UnitLoadout implementations: MFM loadout rules, and the authored
// wargear options for a unit the dump gives no rules. Port of mfmView and
// optionsView in tools/src/data/unit-loadout.ts.

// mfmUnitLoadout is the view of a unit with MFM loadout rules. Splits, bases
// and bounds are cached per model count.
type mfmUnitLoadout struct {
	unitID      string
	composition *MfmComposition
	rules       *MfmLoadoutRules
	rowOrder    []string
	mu          sync.Mutex // guards the caches below
	splits      map[int][]map[string]int
	bases       map[int]map[string]int
	bounds      map[int]map[string]intRange
}

func newMfmUnitLoadout(unitID string, composition *MfmComposition) *mfmUnitLoadout {
	return &mfmUnitLoadout{
		unitID:      unitID,
		composition: composition,
		rules:       composition.Loadout,
		rowOrder:    mfmGroupRowOrder(composition),
		splits:      map[int][]map[string]int{},
		bases:       map[int]map[string]int{},
		bounds:      map[int]map[string]intRange{},
	}
}

func (v *mfmUnitLoadout) Source() string { return "mfm" }

func (v *mfmUnitLoadout) splitsAt(modelCount int) []map[string]int {
	v.mu.Lock()
	found, ok := v.splits[modelCount]
	v.mu.Unlock()
	if !ok {
		found = MfmRowSplits(v.composition, modelCount)
		v.mu.Lock()
		v.splits[modelCount] = found
		v.mu.Unlock()
	}
	return found
}

// baseAt is the base loadout's counts at a split, or nil.
func (v *mfmUnitLoadout) baseAt(rows map[string]int) map[string]int {
	counts, _, ok := MfmBaseLoadout(v.rules, rows)
	if !ok {
		return nil
	}
	return counts
}

func (v *mfmUnitLoadout) baseOf(modelCount int) map[string]int {
	v.mu.Lock()
	found, ok := v.bases[modelCount]
	v.mu.Unlock()
	if ok {
		return found
	}
	if rows := MfmRows(v.composition, modelCount); rows != nil {
		found = v.baseAt(rows)
	}
	v.mu.Lock()
	v.bases[modelCount] = found
	v.mu.Unlock()
	return found
}

// boundsOf is each item's widest range over every split with a legal
// configuration, an item a split cannot carry counting as 0–0 there; nil when
// no split has a legal loadout.
func (v *mfmUnitLoadout) boundsOf(modelCount int) map[string]intRange {
	v.mu.Lock()
	cached, ok := v.bounds[modelCount]
	v.mu.Unlock()
	if ok {
		return cached
	}
	// Every split with a legal configuration; an item a split's bounds lack
	// cannot be carried there, so it counts as 0–0 on that split.
	var legal []map[string]MfmBound
	ids := map[string]bool{}
	for _, rows := range v.splitsAt(modelCount) {
		found, err := MfmWeaponBounds(v.rules, rows)
		mfmMust(err)
		if found == nil {
			continue
		}
		legal = append(legal, found)
		for id := range found {
			ids[id] = true
		}
	}
	var out map[string]intRange
	if len(legal) > 0 {
		out = make(map[string]intRange, len(ids))
		for id := range ids {
			r := intRange{min: math.MaxInt, max: math.MinInt}
			for _, found := range legal {
				b := found[id] // zero value {0, 0} when the split lacks id
				r = intRange{min: min(r.min, b.Min), max: max(r.max, b.Max)}
			}
			out[id] = r
		}
	}
	v.mu.Lock()
	v.bounds[modelCount] = out
	v.mu.Unlock()
	return out
}

func (v *mfmUnitLoadout) Base(modelCount int) map[string]int {
	return mfmCloneCounts(v.baseOf(modelCount))
}

func (v *mfmUnitLoadout) Bounds(modelCount int) map[string]intRange {
	found := v.boundsOf(modelCount)
	if found == nil {
		return nil
	}
	out := make(map[string]intRange, len(found))
	for id, r := range found {
		out[id] = r
	}
	return out
}

func (v *mfmUnitLoadout) Maximal(modelCount int) map[string]int {
	rows := MfmRows(v.composition, modelCount)
	if rows == nil {
		return nil
	}
	stock := v.baseAt(rows)
	var best map[string]int
	most := -1
	mfmMust(forEachMfmConfiguration(v.rules, rows, func(configuration MfmConfiguration) bool {
		added := 0
		for id, n := range configuration.Counts {
			added += max(0, n-stock[id])
		}
		if added > most {
			most = added
			best = configuration.Counts
		}
		return false
	}, nil))
	return best
}

func (v *mfmUnitLoadout) Check(modelCount int, counts map[string]int) []map[string]string {
	splits := v.splitsAt(modelCount)
	if len(splits) == 0 {
		return []map[string]string{{
			"id":      v.unitID,
			"code":    "invalid-model-count",
			"message": fmt.Sprintf("%s: no squad size has %d models", v.unitID, modelCount),
		}}
	}
	for _, rows := range splits {
		if len(CheckMfmLoadout(v.rules, rows, counts)) == 0 {
			return []map[string]string{}
		}
	}
	ranges := v.boundsOf(modelCount)
	ids := map[string]bool{}
	for id := range counts {
		ids[id] = true
	}
	for id := range ranges {
		ids[id] = true
	}
	out := []map[string]string{}
	for id := range ids {
		n := counts[id]
		r := ranges[id] // an item no legal loadout carries has range 0..0
		if n > r.max {
			out = append(out, map[string]string{"id": id, "code": "exceeds-max", "message": fmt.Sprintf("%s: %d × %s exceeds the most a legal loadout carries (%d)", v.unitID, n, id, r.max)})
		} else if n < r.min {
			out = append(out, map[string]string{"id": id, "code": "below-min", "message": fmt.Sprintf("%s: %d × %s is below the fewest a legal loadout carries (%d)", v.unitID, n, id, r.min)})
		}
	}
	if len(out) == 0 {
		out = append(out, map[string]string{"id": v.unitID, "code": "swap-conflict", "message": v.unitID + ": no legal whole-model assignment carries exactly these counts"})
	}
	sort.Slice(out, func(a, b int) bool {
		if out[a]["id"] != out[b]["id"] {
			return out[a]["id"] < out[b]["id"]
		}
		return out[a]["code"] < out[b]["code"]
	})
	return out
}

func (v *mfmUnitLoadout) Groups(modelCount int, counts map[string]int) []any {
	if modelCount <= 1 {
		return nil
	}
	for _, rows := range v.splitsAt(modelCount) {
		found, err := MfmAssignment(v.rules, rows, counts)
		mfmMust(err)
		if found != nil {
			return mfmGroups(*found, v.rowOrder)
		}
	}
	return nil
}

func (v *mfmUnitLoadout) Complete(modelCount int, explicit map[string]int) *completedLoadout {
	for _, rows := range v.splitsAt(modelCount) {
		ceiling := mfmCloneCounts(v.baseAt(rows))
		if ceiling == nil {
			ceiling = map[string]int{}
		}
		for id, n := range explicit {
			ceiling[id] = max(n, ceiling[id])
		}
		var found *MfmConfiguration
		mfmMust(forEachMfmConfiguration(v.rules, rows, func(configuration MfmConfiguration) bool {
			for id, n := range explicit {
				if configuration.Counts[id] < n {
					return false
				}
			}
			found = &configuration
			return true
		}, ceiling))
		if found == nil {
			continue
		}
		// The configuration's counts are in ascending id order.
		order := make([]string, 0, len(found.Counts))
		for id := range found.Counts {
			order = append(order, id)
		}
		sort.Strings(order)
		completed := &completedLoadout{counts: mfmCloneCounts(found.Counts), order: order}
		if modelCount > 1 {
			completed.groups = mfmGroups(*found, v.rowOrder)
		}
		return completed
	}
	return nil
}

func (v *mfmUnitLoadout) Candidates(modelCount int, limit *int) []string {
	n := LoadoutCandidatesDefaultLimit
	if limit != nil {
		n = max(0, *limit)
	}
	out, err := MfmUnitCandidates(v.composition, modelCount, n)
	mfmMust(err)
	return out
}

// optionsUnitLoadout is the view of a unit the dump gives no loadout rules:
// its authored wargear options decide.
type optionsUnitLoadout struct {
	unit        map[string]any
	composition map[string]any
	options     []any
}

func (v *optionsUnitLoadout) Source() string { return "wargear-options" }

func (v *optionsUnitLoadout) models() []any { return getList(v.composition, "models") }
func (v *optionsUnitLoadout) tiers() []any  { return getList(v.composition, "tiers") }

// buildable reports whether some tier (or the models, without tiers) holds
// modelCount. A unit without a composition has no recorded sizes; any count is
// taken as given.
func (v *optionsUnitLoadout) buildable(modelCount int) bool {
	var sizes [][]any
	if tiers := v.tiers(); len(tiers) > 0 {
		for _, tierAny := range tiers {
			tier, _ := asMap(tierAny)
			sizes = append(sizes, getList(tier, "models"))
		}
	} else if v.composition != nil && v.composition["models"] != nil {
		sizes = append(sizes, v.models())
	}
	if len(sizes) == 0 {
		return true
	}
	for _, rows := range sizes {
		lo, hi := 0, 0
		for _, rowAny := range rows {
			row, _ := asMap(rowAny)
			lo += asInt(row["min"])
			hi += asInt(row["max"])
		}
		if modelCount >= lo && modelCount <= hi {
			return true
		}
	}
	return false
}

func (v *optionsUnitLoadout) Base(modelCount int) map[string]int {
	if !v.buildable(modelCount) {
		return nil
	}
	return baseLoadout(v.unit, modelCount, v.options, v.models())
}

func (v *optionsUnitLoadout) Bounds(modelCount int) map[string]intRange {
	if !v.buildable(modelCount) {
		return nil
	}
	return weaponBounds(v.unit, modelCount, v.options, v.models())
}

func (v *optionsUnitLoadout) Maximal(modelCount int) map[string]int {
	if !v.buildable(modelCount) {
		return nil
	}
	return maximalLoadout(v.unit, modelCount, v.options, v.models())
}

func (v *optionsUnitLoadout) Check(modelCount int, counts map[string]int) []map[string]string {
	return checkUnitLegality(v.unit, modelCount, v.options, counts, v.models(), v.tiers())
}

func (v *optionsUnitLoadout) Groups(modelCount int, counts map[string]int) []any {
	return GroupLoadout(v.unit, modelCount, v.options, v.models(), counts)
}

func (v *optionsUnitLoadout) Complete(modelCount int, explicit map[string]int) *completedLoadout {
	return completeLoadout(v.unit, modelCount, v.options, v.models(), explicit)
}

func (v *optionsUnitLoadout) Candidates(modelCount int, limit *int) []string {
	return LoadoutCandidates(v.unit, modelCount, v.options, v.models(), v.tiers(), limit)
}
