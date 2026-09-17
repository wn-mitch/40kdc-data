package wh40kdc

import (
	"sort"
	"strings"
)

// Unit point-cost maths shared by every consumer of the dataset: given a unit, a
// model count, and the unit's army ordinal, which `points` tier applies.
//
// 11e prices some datasheets by army ordinal — how many copies of that datasheet
// you have already taken. The schema models this with optional unit_count_min /
// unit_count_max bands on each points tier (1-based, inclusive; an open-ended top
// band has unit_count_max: null). Selecting a cost is a two-step filter: keep the
// tiers whose ordinal band contains this copy, then pick the highest model-count
// tier the count reaches. A tier with no unit_count_min is unbanded and applies
// to every copy (the common case).
//
// Some units also carry allied_points — alternate tiers scoped to a
// host_faction that apply when the unit is fielded in another faction's army
// (an Agents of the Imperium unit allied into any IMPERIUM army; a shared
// Space Marine datasheet a chapter section reprices). hostPointsTiers selects
// the tier table in effect for a host army and hostUnitPoints prices from it;
// baseUnitPoints stays native-only for callers without army context. Mirror of
// tools/src/data/pricing.ts.

// tierCoversOrdinal reports whether ordinal (1-based army copy) falls within
// tier's ordinal band.
func tierCoversOrdinal(tier map[string]any, ordinal int) bool {
	if tier["unit_count_min"] == nil {
		return true // unbanded: applies to every copy
	}
	if ordinal < asInt(tier["unit_count_min"]) {
		return false
	}
	if tier["unit_count_max"] == nil {
		return true // open-ended top band (absent or JSON null)
	}
	return ordinal <= asInt(tier["unit_count_max"])
}

// baseUnitPoints is the base point cost for a unit of modelCount models taken as
// its ordinal-th army copy (1-based). Among the tiers whose ordinal band covers
// this copy, returns the cost of the highest models threshold the count reaches
// (lowest tier when none is reached). models is the tier's range floor (a
// range-priced tier spans models..models_max at one cost, e.g. Venatari 4-6
// @320), so a count inside a range resolves to that range's cost. Returns 0 when
// no tier applies — the caller surfaces a violation rather than guessing.
func baseUnitPoints(unit map[string]any, modelCount, ordinal int) int {
	return tierCost(getList(unit, "points"), modelCount, ordinal)
}

// tierCost is the two-step tier selection over an explicit tier table (native
// or allied).
func tierCost(table []any, modelCount, ordinal int) int {
	var tiers []map[string]any
	for _, tAny := range table {
		t, ok := asMap(tAny)
		if ok && tierCoversOrdinal(t, ordinal) {
			tiers = append(tiers, t)
		}
	}
	if len(tiers) == 0 {
		return 0
	}
	sort.SliceStable(tiers, func(i, j int) bool {
		return asInt(tiers[i]["models"]) < asInt(tiers[j]["models"])
	})
	chosen := tiers[0]
	for _, t := range tiers {
		if modelCount >= asInt(t["models"]) {
			chosen = t
		}
	}
	return asInt(chosen["cost"])
}

// keywordSlug maps "Imperium" → "imperium": faction keywords are display
// names, host_faction values are id slugs.
func keywordSlug(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(name))), "-")
}

// hostPointsTiers is the points tier table in effect for a unit fielded in
// hostFaction's army. A unit native to the host army (its faction_id IS the
// army's faction) always prices from points — allied_points only ever applies
// to a unit included in ANOTHER faction's army. For a foreign unit, entries
// whose host_faction names the army's faction id exactly win (a chapter
// reprice); otherwise entries naming a super-faction keyword the army's
// faction carries apply (an Agents unit's imperium price). With no matching
// entry — or a nil hostFaction — the native table stands. Mirror of
// tools/src/data/pricing.ts hostPointsTiers.
func hostPointsTiers(unit, hostFaction map[string]any) []any {
	native := getList(unit, "points")
	entries := getList(unit, "allied_points")
	if hostFaction == nil || len(entries) == 0 {
		return native
	}
	hostID, _ := hostFaction["id"].(string)
	if unitFaction, _ := unit["faction_id"].(string); unitFaction == hostID {
		return native
	}
	var exact []any
	for _, tAny := range entries {
		if t, ok := asMap(tAny); ok && t["host_faction"] == hostID {
			exact = append(exact, tAny)
		}
	}
	if len(exact) > 0 {
		return exact
	}
	owned := map[string]bool{}
	for _, k := range getStrList(hostFaction, "keywords") {
		owned[keywordSlug(k)] = true
	}
	var grouped []any
	for _, tAny := range entries {
		if t, ok := asMap(tAny); ok {
			if host, _ := t["host_faction"].(string); owned[host] {
				grouped = append(grouped, tAny)
			}
		}
	}
	if len(grouped) > 0 {
		return grouped
	}
	return native
}

// hostUnitPoints is baseUnitPoints priced from the tier table in effect
// inside hostFaction's army (see hostPointsTiers). With a nil hostFaction
// this IS baseUnitPoints. Size coverage is identical across tables (allied
// tiers reprice the native sizes), so pointsTierMissing stays native-only.
func hostUnitPoints(unit map[string]any, modelCount, ordinal int, hostFaction map[string]any) int {
	return tierCost(hostPointsTiers(unit, hostFaction), modelCount, ordinal)
}

// pointsTierMissing reports whether no points tier covers modelCount for this
// ordinal — the count falls outside every tier's [models, models_max] range
// (below the smallest tier, above the largest, or in a gap between non-contiguous
// tiers), or the ordinal has no banded price. A single-size tier (no models_max)
// covers only models. Mirrors the band filter of baseUnitPoints.
func pointsTierMissing(unit map[string]any, modelCount, ordinal int) bool {
	for _, tAny := range getList(unit, "points") {
		t, ok := asMap(tAny)
		if !ok || !tierCoversOrdinal(t, ordinal) {
			continue
		}
		lo := asInt(t["models"])
		hi := lo
		if t["models_max"] != nil {
			hi = asInt(t["models_max"])
		}
		if lo <= modelCount && modelCount <= hi {
			return false
		}
	}
	// Reached only when no covering tier exists (none present, or none contains
	// the count) — the count is unpriced.
	return true
}

// wargearPoints returns the per-item MFM wargear surcharge for a unit whose final
// loadout has counts copies of each weapon/wargear id. Each wargear_costs entry
// charges cost for every copy of item_id present — a Terminator Assault Squad's
// five thunder hammers add 25, a Chapter Ancient's Banner of Macragge adds 10.
// Items with no cost entry are free; absent wargear_costs contributes 0, so a
// unit's total is baseUnitPoints + wargearPoints + enhancement. Mirror of
// tools/src/data/pricing.ts wargearPoints.
func wargearPoints(unit map[string]any, counts map[string]int) int {
	total := 0
	for _, wcAny := range getList(unit, "wargear_costs") {
		wc, ok := asMap(wcAny)
		if !ok {
			continue
		}
		id, _ := wc["item_id"].(string)
		n := counts[id]
		if n < 0 {
			n = 0
		}
		total += asInt(wc["cost"]) * n
	}
	return total
}
