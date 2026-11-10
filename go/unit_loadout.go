package wh40kdc

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
)

// One unit's wargear legality at any model count, behind one interface: its
// MFM loadout rules (unit-composition `loadout`) where the dump provides them,
// else the authored wargear options. Dataset.loadoutOf hands these out. Port of
// tools/src/data/unit-loadout.ts.
//
// Under MFM rules a unit's model count can split across its loadout rows more
// than one way when its tiers allow it (MfmRowSplits). A loadout is legal when
// it is legal on any split. Defaults, the maximal loadout and candidates use
// the bulk split (MfmRows).
//
// A search too large to run panics with *MfmSearchTooLarge, as the TS view
// throws; RunnerState.Dispatch answers it with INTERNAL_ERROR.

// MfmSearchTooLarge is a configuration search that cannot run: a row with more
// bundle choices than the search takes on.
type MfmSearchTooLarge struct{ Row string }

func (e *MfmSearchTooLarge) Error() string {
	return fmt.Sprintf("%s: more than %d wargear combinations to search", e.Row, mfmMaxSearchBundles)
}

// mfmMust panics with a search error, which is always *MfmSearchTooLarge.
func mfmMust(err error) {
	if err != nil {
		panic(err)
	}
}

// recoverMfmSearchTooLarge turns a *MfmSearchTooLarge panic into an
// INTERNAL_ERROR response in *resp; any other panic propagates.
func recoverMfmSearchTooLarge(resp *map[string]any) {
	r := recover()
	if r == nil {
		return
	}
	var tooLarge *MfmSearchTooLarge
	if err, ok := r.(error); ok && errors.As(err, &tooLarge) {
		*resp = errResp("INTERNAL_ERROR", detail(tooLarge.Error()))
		return
	}
	panic(r)
}

// UnitLoadout is a unit's wargear legality at a model count. Counts are copies
// across the whole unit.
type UnitLoadout interface {
	// Source is "mfm" when MFM loadout rules decide, "wargear-options" when
	// the unit's authored options do.
	Source() string
	// Base is the out-of-the-box loadout; nil when no squad size has
	// modelCount models.
	Base(modelCount int) map[string]int
	// Bounds is each item's fewest and most copies on any legal loadout; nil
	// when the size cannot be built.
	Bounds(modelCount int) map[string]intRange
	// Maximal is the legal loadout adding the most copies over Base
	// (Σ max(0, count − base)), ties to the first in search order; nil when
	// the size has no legal loadout.
	Maximal(modelCount int) map[string]int
	// Check is the violations of counts on a unit of modelCount models, by id
	// then code; empty when legal.
	Check(modelCount int, counts map[string]int) []map[string]string
	// Groups is how counts sit on the models; nil for one model, or when no
	// legal assignment exists.
	Groups(modelCount int, counts map[string]int) []any
	// Complete is a legal loadout holding at least explicit's copies of each
	// item and nothing beyond the greater of explicit and the default; nil
	// when none exists.
	Complete(modelCount int, explicit map[string]int) *completedLoadout
	// Candidates is legal loadouts as encoded candidate strings, up to limit
	// (nil for the default), then a truncation marker.
	Candidates(modelCount int, limit *int) []string
}

// loadoutOf is the unit's wargear legality view, faction-scoped like
// unitCompositionOf; one view per unit, shared by every game-mode view.
func (ds *Dataset) loadoutOf(unit map[string]any) UnitLoadout {
	key := getStr(unit, "faction_id") + "::" + getStr(unit, "id")
	views := ds.views
	views.mu.Lock()
	defer views.mu.Unlock()
	if view, ok := views.loadouts[key]; ok {
		return view
	}
	view := newUnitLoadout(unit, ds.unitCompositionRawOf(unit), ds.wargearOptionsOf(unit))
	views.loadouts[key] = view
	return view
}

// unitCompositionRawOf is the unit's faction-scoped composition, or nil.
func (ds *Dataset) unitCompositionRawOf(unit map[string]any) map[string]any {
	fid, uid := getStr(unit, "faction_id"), getStr(unit, "id")
	for _, cAny := range ds.allUnitCompositions {
		c, _ := asMap(cAny)
		if getStr(c, "unit_id") == uid && getStr(c, "faction_id") == fid {
			return c
		}
	}
	return nil
}

// newUnitLoadout is the view for unit with its faction-scoped composition and
// options.
func newUnitLoadout(unit, composition map[string]any, options []any) UnitLoadout {
	if composition != nil && composition["loadout"] != nil {
		decoded, err := decodeMfmComposition(composition)
		if err == nil && decoded.Loadout != nil {
			return newMfmUnitLoadout(getStr(unit, "id"), decoded)
		}
	}
	return &optionsUnitLoadout{unit: unit, composition: composition, options: options}
}

// mfmModelName is a row's model name: `name#k` names the k-th row called name.
func mfmModelName(row string) string {
	for hash := len(row) - 1; hash > 0; hash-- {
		if row[hash] == '#' {
			if mfmRowOrdinal.MatchString(row[hash+1:]) {
				return row[:hash]
			}
			return row
		}
	}
	return row
}

// mfmGroupRowOrder is the order groups list a composition's loadout rows in:
// by the position of the row's model name among the composition's models, then
// in stock order. A name the models lack sorts last.
func mfmGroupRowOrder(composition *MfmComposition) []string {
	rank := func(row string) int {
		name := mfmModelName(row)
		for i, model := range composition.Models {
			if model.Name == name {
				return i
			}
		}
		return len(composition.Models)
	}
	var order []string
	for _, row := range composition.Loadout.Stock {
		if row.Model != nil && !containsString(order, *row.Model) {
			order = append(order, *row.Model)
		}
	}
	sort.SliceStable(order, func(a, b int) bool { return rank(order[a]) < rank(order[b]) })
	return order
}

func mfmWeaponsOf(items []mfmItem) []any {
	out := make([]any, len(items))
	for i, item := range items {
		out[i] = map[string]any{"id": item.ID, "count": item.Count}
	}
	return out
}

// mfmGroups is a configuration's models as loadout groups: rows in rowOrder, a
// row's bundles most models first (ties in search order), bundles of one model
// name with the same items merged into the first, and the unit's own wargear
// last as one unnamed group.
func mfmGroups(configuration MfmConfiguration, rowOrder []string) []any {
	rank := func(row string) int {
		for i, r := range rowOrder {
			if r == row {
				return i
			}
		}
		return len(rowOrder)
	}
	bundles := append([]mfmRowBundle(nil), configuration.Groups...)
	sort.SliceStable(bundles, func(a, b int) bool {
		if ra, rb := rank(bundles[a].Model), rank(bundles[b].Model); ra != rb {
			return ra < rb
		}
		return bundles[a].Count > bundles[b].Count
	})
	type group struct {
		name  string
		count int
		items []mfmItem
	}
	var merged []*group
	for _, bundle := range bundles {
		name := mfmModelName(bundle.Model)
		var same *group
		for _, g := range merged {
			if g.name == name && reflect.DeepEqual(g.items, bundle.Items) {
				same = g
				break
			}
		}
		if same != nil {
			same.count += bundle.Count
		} else {
			merged = append(merged, &group{name: name, count: bundle.Count, items: bundle.Items})
		}
	}
	out := make([]any, 0, len(merged)+1)
	for _, g := range merged {
		out = append(out, map[string]any{"model_name": g.name, "count": g.count, "weapons": mfmWeaponsOf(g.items)})
	}
	if len(configuration.Unit) > 0 {
		out = append(out, map[string]any{"model_name": nil, "count": 1, "weapons": mfmWeaponsOf(configuration.Unit)})
	}
	return out
}

func mfmCloneCounts(m map[string]int) map[string]int {
	if m == nil {
		return nil
	}
	out := make(map[string]int, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
