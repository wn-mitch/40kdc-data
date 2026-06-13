package wh40kdc

import (
	"math"
	"sort"
)

// Wargear-loadout maths shared by every consumer of the dataset. Go mirror of
// python .../data/loadout.py.

// optionCap is the maximum number of models that may take an option in a unit
// of modelCount.
func optionCap(option map[string]any, modelCount int) int {
	c, _ := getMap(option, "model_constraint")
	if len(c) == 0 {
		return maxInt(0, modelCount)
	}
	var cap int
	switch {
	case truthy(c["any_number"]):
		cap = modelCount
	case truthy(c["per_n_models"]):
		per := asInt(c["per_n_models"])
		cap = int(math.Floor(float64(modelCount) / float64(per)))
	default:
		if c["max_count"] != nil {
			cap = asInt(c["max_count"])
		} else {
			cap = 1
		}
	}
	if c["max_count"] != nil {
		cap = minInt(cap, asInt(c["max_count"]))
	}
	return maxInt(0, cap)
}

func addedIDs(option map[string]any, choiceIndex int) []string {
	if r := getStrList(option, "replacement"); len(r) > 0 {
		return r
	}
	choices := getList(option, "replacement_choice")
	if choiceIndex >= 0 && choiceIndex < len(choices) {
		return toStrList(choices[choiceIndex])
	}
	return nil
}

func allReplacementIDs(options []any) map[string]struct{} {
	out := map[string]struct{}{}
	for _, oAny := range options {
		o, _ := asMap(oAny)
		for _, id := range getStrList(o, "replacement") {
			out[id] = struct{}{}
		}
		for _, group := range getList(o, "replacement_choice") {
			for _, id := range toStrList(group) {
				out[id] = struct{}{}
			}
		}
	}
	return out
}

func baseWeaponIDs(unit map[string]any, options []any) []string {
	replacements := allReplacementIDs(options)
	var out []string
	for _, id := range getStrList(unit, "weapon_ids") {
		if _, isRepl := replacements[id]; !isRepl {
			out = append(out, id)
		}
	}
	return out
}

// maximalLoadout is the maximal (take-every-swap) loadout: id -> count.
func maximalLoadout(unit map[string]any, modelCount int, options []any) map[string]int {
	counts := map[string]int{}
	for _, id := range baseWeaponIDs(unit, options) {
		counts[id] += modelCount
	}
	for _, oAny := range options {
		o, _ := asMap(oAny)
		cap := optionCap(o, modelCount)
		if cap == 0 {
			continue
		}
		for _, id := range getStrList(o, "replaces") {
			counts[id] -= cap
		}
		for _, id := range addedIDs(o, 0) {
			counts[id] += cap
		}
	}
	for id, n := range counts {
		if n == 0 {
			delete(counts, id)
		}
	}
	return counts
}

type intRange struct{ min, max int }

func weaponBounds(unit map[string]any, modelCount int, options []any) map[string]intRange {
	bounds := map[string]intRange{}
	for _, id := range baseWeaponIDs(unit, options) {
		bounds[id] = intRange{modelCount, modelCount}
	}
	for _, oAny := range options {
		o, _ := asMap(oAny)
		cap := optionCap(o, modelCount)
		for _, id := range getStrList(o, "replaces") {
			b := bounds[id]
			bounds[id] = intRange{maxInt(0, b.min-cap), b.max}
		}
		adds := map[string]struct{}{}
		for _, id := range getStrList(o, "replacement") {
			adds[id] = struct{}{}
		}
		for _, group := range getList(o, "replacement_choice") {
			for _, id := range toStrList(group) {
				adds[id] = struct{}{}
			}
		}
		for id := range adds {
			b := bounds[id]
			bounds[id] = intRange{b.min, b.max + cap}
		}
	}
	return bounds
}

func validateLoadout(unit map[string]any, modelCount int, options []any, counts map[string]int) []map[string]string {
	bounds := weaponBounds(unit, modelCount, options)
	var out []map[string]string
	for id, n := range counts {
		b, ok := bounds[id]
		if !ok {
			continue
		}
		if n > b.max {
			out = append(out, map[string]string{"id": id, "code": "exceeds-max", "message": id + ": " + itoa(n) + " exceeds max " + itoa(b.max)})
		} else if n < b.min {
			out = append(out, map[string]string{"id": id, "code": "below-min", "message": id + ": " + itoa(n) + " below min " + itoa(b.min)})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i]["id"] != out[j]["id"] {
			return out[i]["id"] < out[j]["id"]
		}
		return out[i]["code"] < out[j]["code"]
	})
	return out
}

func toStrList(v any) []string {
	l, _ := asList(v)
	out := make([]string, 0, len(l))
	for _, e := range l {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
