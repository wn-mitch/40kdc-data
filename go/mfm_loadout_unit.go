package wh40kdc

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// A unit's MFM loadout at a model count: how the count splits across the
// loadout's model rows, and the default wargear at that size. Port of
// tools/src/data/mfm-loadout-unit.ts.

// mfmRowOrdinal is the `k` of a `name#k` loadout row.
var mfmRowOrdinal = regexp.MustCompile(`^[1-9][0-9]*$`)

// mfmCompositionRow is a composition model row's name and model-count range.
type mfmCompositionRow struct {
	Name string `json:"name"`
	Min  int    `json:"min"`
	Max  int    `json:"max"`
}

// MfmComposition is the composition fields the split reads: its model rows,
// squad-size tiers and loadout.
type MfmComposition struct {
	Models []mfmCompositionRow `json:"models"`
	Tiers  []struct {
		Models []mfmCompositionRow `json:"models"`
	} `json:"tiers"`
	Loadout *MfmLoadoutRules `json:"loadout"`
}

// decodeMfmComposition reads a raw composition object, or nil for none.
func decodeMfmComposition(raw any) (*MfmComposition, error) {
	if raw == nil {
		return nil, nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var composition MfmComposition
	if err := json.Unmarshal(b, &composition); err != nil {
		return nil, err
	}
	return &composition, nil
}

// mfmRowRange is the model-count range a loadout row has in a tier. A row
// written `name#k`, k a positive decimal with no sign or leading zero, is the
// k-th of the tier's rows of that name; any other row is a plain name, which
// covers every tier row of exactly that name.
func mfmRowRange(tier []mfmCompositionRow, row string) (lo, hi int, ok bool) {
	if hash := strings.LastIndex(row, "#"); hash > 0 && mfmRowOrdinal.MatchString(row[hash+1:]) {
		// A k past every row (even one too large for an int) names no row.
		k, err := strconv.Atoi(row[hash+1:])
		if err != nil {
			return 0, 0, false
		}
		seen := 0
		for _, model := range tier {
			if model.Name == row[:hash] {
				seen++
				if seen == k {
					return model.Min, model.Max, true
				}
			}
		}
		return 0, 0, false
	}
	for _, model := range tier {
		if model.Name == row {
			lo, hi, ok = lo+model.Min, hi+model.Max, true
		}
	}
	return lo, hi, ok
}

// mfmRange is a loadout row's model-count range in a tier.
type mfmRange struct{ lo, hi int }

// mfmTierRanges is the composition's default loadout rows in stock order (each
// once), their default model counts, and each tier's range per row in that
// order, tiers in declaration order (the composition's models when it has no
// tiers). A row a tier does not list keeps its default count. ok is false
// without a loadout.
func mfmTierRanges(composition *MfmComposition) (order []string, defaults map[string]int, tiers [][]mfmRange, ok bool) {
	rules := composition.Loadout
	if rules == nil {
		return nil, nil, nil, false
	}
	tierRows := [][]mfmCompositionRow{composition.Models}
	if len(composition.Tiers) > 0 {
		tierRows = tierRows[:0]
		for _, tier := range composition.Tiers {
			tierRows = append(tierRows, tier.Models)
		}
	}
	defaults, _ = DefaultMfmLoadout(rules)
	for _, row := range rules.Stock {
		if row.Model != nil && !containsString(order, *row.Model) {
			order = append(order, *row.Model)
		}
	}
	for _, tier := range tierRows {
		ranges := make([]mfmRange, len(order))
		for i, row := range order {
			lo, hi, found := mfmRowRange(tier, row)
			if !found {
				lo, hi = defaults[row], defaults[row]
			}
			ranges[i] = mfmRange{lo, hi}
		}
		tiers = append(tiers, ranges)
	}
	return order, defaults, tiers, true
}

// MfmRows is the loadout rows' model counts for a unit of modelCount models,
// or nil when no tier holds that count. The first tier (in declaration order)
// whose range holds the count fixes each row's range; the default unit's rows
// are clamped into it, and the difference goes to (or comes from) the row with
// the most default models that has room, ties to the first in stock order,
// until the count is reached.
func MfmRows(composition *MfmComposition, modelCount int) map[string]int {
	order, defaults, tiers, ok := mfmTierRanges(composition)
	if !ok {
		return nil
	}
	for _, ranges := range tiers {
		mins, maxes := map[string]int{}, map[string]int{}
		low, high := 0, 0
		for i, row := range order {
			mins[row], maxes[row] = ranges[i].lo, ranges[i].hi
			low, high = low+ranges[i].lo, high+ranges[i].hi
		}
		if modelCount < low || modelCount > high {
			continue
		}
		rows := map[string]int{}
		total := 0
		for _, row := range order {
			rows[row] = min(maxes[row], max(mins[row], defaults[row]))
			total += rows[row]
		}
		for delta := modelCount - total; delta != 0; {
			grow := delta > 0
			// The tier's range holds the count, so some row has room.
			bestAt := -1
			for i, row := range order {
				room := rows[row] > mins[row]
				if grow {
					room = rows[row] < maxes[row]
				}
				if room && (bestAt < 0 || defaults[row] > defaults[order[bestAt]]) {
					bestAt = i
				}
			}
			best := order[bestAt]
			room := rows[best] - mins[best]
			if grow {
				room = maxes[best] - rows[best]
			}
			step := min(room, abs(delta))
			if grow {
				rows[best] += step
				delta -= step
			} else {
				rows[best] -= step
				delta += step
			}
		}
		return rows
	}
	return nil
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// MfmRowSplits is every way a unit of modelCount models splits across its
// loadout rows under some tier: the MfmRows split first, then the rest by tier
// in declaration order, each tier's in ascending order of the rows' counts
// (rows in stock order). Each split is listed once. Empty when no tier holds
// the count.
func MfmRowSplits(composition *MfmComposition, modelCount int) []map[string]int {
	bulk := MfmRows(composition, modelCount)
	order, _, tiers, ok := mfmTierRanges(composition)
	if bulk == nil || !ok {
		return nil
	}
	keyOf := func(counts []int) string { return string(mfmIntsKey(nil, 0, counts)) }
	bulkCounts := make([]int, len(order))
	for i, row := range order {
		bulkCounts[i] = bulk[row]
	}
	out := []map[string]int{bulk}
	seen := map[string]bool{keyOf(bulkCounts): true}
	for _, ranges := range tiers {
		counts := make([]int, 0, len(order))
		var walk func(i, left int)
		walk = func(i, left int) {
			if i == len(order) {
				if left != 0 {
					return
				}
				if key := keyOf(counts); !seen[key] {
					seen[key] = true
					rows := make(map[string]int, len(order))
					for at, row := range order {
						rows[row] = counts[at]
					}
					out = append(out, rows)
				}
				return
			}
			// The rows after this one must still be able to take what is left.
			restLow, restHigh := 0, 0
			for _, r := range ranges[i+1:] {
				restLow, restHigh = restLow+r.lo, restHigh+r.hi
			}
			for n := max(ranges[i].lo, left-restHigh); n <= min(ranges[i].hi, left-restLow); n++ {
				counts = append(counts, n)
				walk(i+1, left-n)
				counts = counts[:len(counts)-1]
			}
		}
		walk(0, modelCount)
	}
	return out
}

// MfmResizedDefault is the default wargear of a unit with rows models per
// loadout row: the default unit's copies, plus a row's template for each model
// it has beyond the default and less one for each it has fewer. Nil when
// removing models would take copies the default does not have.
func MfmResizedDefault(r *MfmLoadoutRules, rows map[string]int) map[string]int {
	models, counts := DefaultMfmLoadout(r)
	out := map[string]int{}
	for id, n := range counts {
		out[id] = n
	}
	for row, n := range rows {
		if delta := n - models[row]; delta != 0 {
			mfmAdd(out, r.template(row), delta)
		}
	}
	for id, n := range out {
		if n < 0 {
			return nil
		}
		if n == 0 {
			delete(out, id)
		}
	}
	return out
}

// MfmScaledDefault is the default wargear of a unit with rows models per
// loadout row, scaling each row's default copies per model. Nil when a row's
// copies do not split evenly over its default models, or a row the default
// unit has none of is given models.
func MfmScaledDefault(r *MfmLoadoutRules, rows map[string]int) map[string]int {
	out := map[string]int{}
	for _, row := range r.Stock {
		if row.Model == nil {
			mfmAdd(out, row.Items, 1)
			continue
		}
		n := rows[*row.Model]
		if n == 0 {
			continue
		}
		if row.Models == 0 {
			return nil
		}
		items := row.Items
		if len(items) == 0 {
			items = nil
			for _, item := range r.template(*row.Model) {
				items = append(items, mfmItem{ID: item.ID, Count: item.Count * row.Models})
			}
		}
		for _, item := range items {
			if (item.Count*n)%row.Models != 0 {
				return nil
			}
			out[item.ID] += item.Count * n / row.Models
		}
	}
	return out
}

// MfmBaseLoadout is the base loadout of a unit with rows models per loadout
// row: the default resized by templates when it is legal, else the default
// scaled per model when that is, else the resized default with legal false.
// ok is false when neither can be built.
func MfmBaseLoadout(r *MfmLoadoutRules, rows map[string]int) (counts map[string]int, legal, ok bool) {
	resized := MfmResizedDefault(r, rows)
	scaled := MfmScaledDefault(r, rows)
	for _, candidate := range []map[string]int{resized, scaled} {
		if candidate != nil && len(CheckMfmLoadout(r, rows, candidate)) == 0 {
			return candidate, true, true
		}
	}
	if resized != nil {
		return resized, false, true
	}
	if scaled != nil {
		return scaled, false, true
	}
	return nil, false, false
}

// MfmUnitViolations is the violations of a unit of modelCount models carrying
// counts, under its composition's loadout split by MfmRows; nil when the
// composition has no loadout.
func MfmUnitViolations(composition *MfmComposition, modelCount int, counts map[string]int) []MfmLoadoutViolation {
	if composition.Loadout == nil {
		return nil
	}
	rows := MfmRows(composition, modelCount)
	if rows == nil {
		return []MfmLoadoutViolation{{Code: "invalid-model-count", Message: fmt.Sprintf("no squad size of this unit has %d models", modelCount)}}
	}
	return CheckMfmLoadout(composition.Loadout, rows, counts)
}

// MfmCandidatesTruncated is the marker that ends a candidate list cut at its
// limit.
const MfmCandidatesTruncated = "…truncated"

func mfmItemList(items []mfmItem) string {
	parts := make([]string, len(items))
	for i, item := range items {
		parts[i] = item.ID + ":" + strconv.Itoa(item.Count)
	}
	return strings.Join(parts, ",")
}

// EncodeMfmConfiguration is a configuration as `<witness> => <counts>`: each
// group as `<row>×<models>[<items per model>]` in search order, then the unit's
// own wargear as `unit[<items>]` when it has any, joined by `; `; counts as
// ascending `id:count` pairs joined by `,`.
func EncodeMfmConfiguration(configuration MfmConfiguration) string {
	groups := make([]string, 0, len(configuration.Groups)+1)
	for _, group := range configuration.Groups {
		groups = append(groups, fmt.Sprintf("%s×%d[%s]", group.Model, group.Count, mfmItemList(group.Items)))
	}
	if len(configuration.Unit) > 0 {
		groups = append(groups, "unit["+mfmItemList(configuration.Unit)+"]")
	}
	counts := make([]mfmItem, 0, len(configuration.Counts))
	for id, n := range configuration.Counts {
		counts = append(counts, mfmItem{ID: id, Count: n})
	}
	sort.Slice(counts, func(a, b int) bool { return counts[a].ID < counts[b].ID })
	return strings.Join(groups, "; ") + " => " + mfmItemList(counts)
}

// MfmUnitCandidates is the legal configurations of a unit of modelCount
// models, encoded by EncodeMfmConfiguration in search order, up to limit, then
// MfmCandidatesTruncated when more exist. Empty when the size cannot be built.
func MfmUnitCandidates(composition *MfmComposition, modelCount, limit int) ([]string, error) {
	out := []string{}
	if composition.Loadout == nil {
		return out, nil
	}
	rows := MfmRows(composition, modelCount)
	if rows == nil {
		return out, nil
	}
	configurations, truncated, err := MfmConfigurations(composition.Loadout, rows, limit)
	if err != nil {
		return nil, err
	}
	for _, configuration := range configurations {
		out = append(out, EncodeMfmConfiguration(configuration))
	}
	if truncated {
		out = append(out, MfmCandidatesTruncated)
	}
	return out, nil
}
