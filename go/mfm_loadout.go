package wh40kdc

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Wargear legality against a unit's MFM loadout (unit-composition `loadout`).
// Port of tools/src/data/mfm-loadout.ts; conformance-pinned through the
// mfm_loadout corpus. A loadout is legal when its models can be assigned picks
// that produce exactly the unit's item counts:
//
//   - each model makes `picks` choices from every slot on its row, or from its
//     row's alternate slots instead of all of them; a slot without a row is
//     filled once for the unit;
//   - every limit holds on the copies of its row (or of the unit): the copies
//     above the row's stock, or all copies when the limit lists the stock
//     itself, must be the sum of at most the limit's cap of its choices, each
//     taken at most `per_choice` times. A stock item listed alongside a
//     non-stock item in a choice is the item that model keeps, and is not
//     counted;
//   - in a uniform set, every model on the row (or in the unit) that takes no
//     substitute carries the same main option;
//   - a slot choice holding its model's whole stock plus items the row offers
//     only as unticked checkboxes may be taken without them;
//   - up to bareModels models of a row may carry nothing, as the default
//     unit's do;
//   - a row (or the unit's own wargear) whose every option for an item is a
//     checkbox carries at most one copy per such option, or its stock copies
//     when more. A row the app shows per model gets that cap on each model.

// mfmItem is one item id with its copy count.
type mfmItem struct {
	ID    string `json:"id"`
	Count int    `json:"count"`
}

// MfmLoadoutRules is a unit composition's `loadout`.
type MfmLoadoutRules struct {
	Stock []struct {
		Model  *string   `json:"model"`
		Models int       `json:"models"`
		Items  []mfmItem `json:"items"`
		// Individual: the app lists the row's models one by one, each with its
		// own widgets.
		Individual bool `json:"individual"`
	} `json:"stock"`
	Templates []struct {
		Model string    `json:"model"`
		Items []mfmItem `json:"items"`
	} `json:"templates"`
	Slots []struct {
		Model     *string     `json:"model"`
		Picks     int         `json:"picks"`
		Repeats   bool        `json:"repeats"`
		Alternate bool        `json:"alternate"`
		Choices   [][]mfmItem `json:"choices"`
	} `json:"slots"`
	Limits  []mfmLimit `json:"limits"`
	Uniform []struct {
		Model   *string `json:"model"`
		Choices []struct {
			Items      []mfmItem `json:"items"`
			Substitute bool      `json:"substitute"`
		} `json:"choices"`
	} `json:"uniform"`
	Options []struct {
		Model   *string `json:"model"`
		ID      string  `json:"id"`
		Input   string  `json:"input"`
		Default int     `json:"default"`
	} `json:"options"`
}

type mfmLimit struct {
	Model       *string `json:"model"`
	Breakpoints []struct {
		Models    int  `json:"models"`
		Choices   int  `json:"choices"`
		PerChoice *int `json:"per_choice"`
	} `json:"breakpoints"`
	Choices [][]mfmItem `json:"choices"`
}

// MfmLoadoutViolation is one reason a loadout is illegal.
type MfmLoadoutViolation struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// mfmMaxBundles caps the bundles searched on one row; more is reported.
const mfmMaxBundles = 20_000

type mfmCopies = map[string]int

// decodeMfmLoadout reads a composition's raw `loadout` object into rules.
func decodeMfmLoadout(raw any) (*MfmLoadoutRules, error) {
	if raw == nil {
		return nil, nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var rules MfmLoadoutRules
	if err := json.Unmarshal(b, &rules); err != nil {
		return nil, err
	}
	return &rules, nil
}

// sameModel compares an optional row name with a row (nil is the unit).
func sameModel(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func mfmAdd(into mfmCopies, items []mfmItem, times int) {
	for _, item := range items {
		into[item.ID] += item.Count * times
	}
}

func mfmCopiesOf(items []mfmItem, times int) mfmCopies {
	out := mfmCopies{}
	mfmAdd(out, items, times)
	return out
}

func mfmContains(bundle mfmCopies, items []mfmItem) bool {
	if len(items) == 0 {
		return false
	}
	for _, item := range items {
		if bundle[item.ID] < item.Count {
			return false
		}
	}
	return true
}

func (r *MfmLoadoutRules) template(model string) []mfmItem {
	for _, entry := range r.Templates {
		if entry.Model == model {
			return entry.Items
		}
	}
	return nil
}

// mfmPickCombinations is every multiset of `picks` choices; only the empty
// choice repeats unless `repeats`.
func mfmPickCombinations(choices [][]mfmItem, picks int, repeats bool) [][]mfmItem {
	var out [][]mfmItem
	hasEmpty := false
	for _, choice := range choices {
		if len(choice) == 0 {
			hasEmpty = true
		}
	}
	var walk func(from, left int, acc []mfmItem)
	walk = func(from, left int, acc []mfmItem) {
		if left == 0 {
			out = append(out, acc)
			return
		}
		for i := from; i < len(choices); i++ {
			next := i + 1
			if repeats || len(choices[i]) == 0 {
				next = i
			}
			joined := make([]mfmItem, 0, len(acc)+len(choices[i]))
			joined = append(append(joined, acc...), choices[i]...)
			walk(next, left-1, joined)
		}
	}
	start := picks
	if !repeats && !hasEmpty && len(choices) < picks {
		start = len(choices)
	}
	walk(0, start, nil)
	return out
}

// mfmSlotChoices adds "take nothing" to a slot none of whose choices is stock.
func mfmSlotChoices(choices [][]mfmItem, stock mfmCopies) [][]mfmItem {
	for _, choice := range choices {
		if len(choice) == 0 || mfmContains(stock, choice) {
			return choices
		}
	}
	out := make([][]mfmItem, 0, len(choices)+1)
	return append(append(out, choices...), []mfmItem{})
}

// rowSlotChoices is a row slot's choices, plus the stock alone for each add-on
// choice that lacks it: a choice holding the model's whole stock and items the
// row offers only as checkboxes that start unticked lets the model leave those
// items off, as the app's default for it does (Purge Corps Sulphurhounds).
func (r *MfmLoadoutRules) rowSlotChoices(model string, choices [][]mfmItem, stock mfmCopies) [][]mfmItem {
	choices = mfmSlotChoices(choices, stock)
	if len(stock) == 0 {
		return choices
	}
	unticked := func(id string) bool {
		seen := false
		for _, option := range r.Options {
			if option.Model == nil || *option.Model != model || option.ID != id {
				continue
			}
			if option.Input != "checkbox" || option.Default != 0 {
				return false
			}
			seen = true
		}
		return seen
	}
	same := func(a, b []mfmItem) bool {
		copies := mfmCopiesOf(a, 1)
		if len(a) != len(b) {
			return false
		}
		for _, item := range b {
			if n, ok := copies[item.ID]; !ok || n != item.Count {
				return false
			}
		}
		return true
	}
	out := append([][]mfmItem(nil), choices...)
	for _, choice := range choices {
		holds := true
		for id, n := range stock {
			found := false
			for _, item := range choice {
				if item.ID == id && item.Count >= n {
					found = true
					break
				}
			}
			if !found {
				holds = false
				break
			}
		}
		if !holds {
			continue
		}
		var plain []mfmItem
		extras, pure := 0, true
		for _, item := range choice {
			if item.Count > stock[item.ID] {
				extras++
				if stock[item.ID] != 0 || !unticked(item.ID) {
					pure = false
				}
			} else {
				plain = append(plain, item)
			}
		}
		if extras == 0 || !pure {
			continue
		}
		known := false
		for _, other := range out {
			if same(other, plain) {
				known = true
				break
			}
		}
		if !known {
			out = append(out, plain)
		}
	}
	return out
}

// bareModels is the models of `model` the default unit leaves bare: its
// default models less the most models any one of its stock items covers, at
// the template's copies per model (one for an item the template lacks). Noise
// Marines: five models, four of each template item. The app starts the unit
// that way, so up to that many models of the row may carry nothing.
func (r *MfmLoadoutRules) bareModels(model string) int {
	template := r.template(model)
	for _, row := range r.Stock {
		if row.Model == nil || *row.Model != model {
			continue
		}
		if row.Models == 0 || len(row.Items) == 0 || len(template) == 0 {
			return 0
		}
		per := mfmCopiesOf(template, 1)
		covered := 0
		for _, item := range row.Items {
			each, ok := per[item.ID]
			if !ok || each <= 0 {
				each = 1
			}
			if n := (item.Count + each - 1) / each; n > covered {
				covered = n
			}
		}
		if row.Models > covered {
			return row.Models - covered
		}
		return 0
	}
	return 0
}

// modelStock is what one model starts with: its template, or its default
// copies over its model count, rounded up.
func (r *MfmLoadoutRules) modelStock(model string) mfmCopies {
	out := mfmCopiesOf(r.template(model), 1)
	for _, row := range r.Stock {
		if row.Model == nil || *row.Model != model {
			continue
		}
		if row.Models > 0 {
			for _, item := range row.Items {
				per := (item.Count + row.Models - 1) / row.Models
				if per > out[item.ID] {
					out[item.ID] = per
				}
			}
		}
		break
	}
	return out
}

func mfmBundleKey(bundle mfmCopies) string {
	keys := make([]string, 0, len(bundle))
	for id, n := range bundle {
		if n > 0 {
			keys = append(keys, id)
		}
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, id := range keys {
		fmt.Fprintf(&sb, "%s=%d;", id, bundle[id])
	}
	return sb.String()
}

// rowBundles is the bundles one model of `model` can carry: one pick
// combination per slot, multiplied out, dropping any partial bundle fitsCopies
// refuses. A partial bundle only gains copies as slots are added, so fitsCopies
// must refuse every bundle that grows from one it refuses. More than maxBundles
// gives ok=false.
func (r *MfmLoadoutRules) rowBundles(model string, fitsCopies func(mfmCopies) bool, maxBundles int) ([]mfmCopies, bool) {
	var regular, alternate []int
	for i, slot := range r.Slots {
		if slot.Model != nil && *slot.Model == model {
			if slot.Alternate {
				alternate = append(alternate, i)
			} else {
				regular = append(regular, i)
			}
		}
	}
	if len(regular)+len(alternate) == 0 {
		return []mfmCopies{mfmCopiesOf(r.template(model), 1)}, true
	}
	stock := r.modelStock(model)
	fits := func(bundle []mfmItem) bool { return fitsCopies(mfmCopiesOf(bundle, 1)) }
	product := func(group []int) ([]mfmCopies, bool) {
		bundles := [][]mfmItem{{}}
		for _, s := range group {
			slot := r.Slots[s]
			picks := mfmPickCombinations(r.rowSlotChoices(model, slot.Choices, stock), slot.Picks, slot.Repeats)
			var next [][]mfmItem
			for _, bundle := range bundles {
				for _, pick := range picks {
					joined := make([]mfmItem, 0, len(bundle)+len(pick))
					joined = append(append(joined, bundle...), pick...)
					if fits(joined) {
						next = append(next, joined)
					}
				}
			}
			bundles = next
			if len(bundles) > maxBundles {
				return nil, false
			}
		}
		out := make([]mfmCopies, len(bundles))
		for i, bundle := range bundles {
			out[i] = mfmCopiesOf(bundle, 1)
		}
		return out, true
	}
	base, ok := product(regular)
	if !ok {
		return nil, false
	}
	var alt []mfmCopies
	if len(alternate) > 0 {
		if alt, ok = product(alternate); !ok {
			return nil, false
		}
	}
	seen := map[string]bool{}
	var out []mfmCopies
	for _, bundle := range append(base, alt...) {
		key := mfmBundleKey(bundle)
		if !seen[key] {
			seen[key] = true
			out = append(out, bundle)
		}
	}
	return out, true
}

// DefaultMfmLoadout is the default unit's model counts and item copies. A row
// with models but no default copies of its own carries its stock template on
// each model; unit-level stock is counted once.
func DefaultMfmLoadout(r *MfmLoadoutRules) (models, counts map[string]int) {
	models = map[string]int{}
	counts = map[string]int{}
	for _, row := range r.Stock {
		if row.Model == nil {
			mfmAdd(counts, row.Items, 1)
			continue
		}
		models[*row.Model] = row.Models
		// A row the default unit has no models of lists what a model brings when added.
		if row.Models == 0 {
			continue
		}
		if len(row.Items) > 0 {
			mfmAdd(counts, row.Items, 1)
		} else {
			mfmAdd(counts, r.template(*row.Model), row.Models)
		}
	}
	return models, counts
}

// checkboxCaps is the most copies of each checkbox-only item model (or the
// unit, when nil) may carry with `models` models on the row: one copy per
// checkbox, raised to the row's stock copies where the default holds more. A
// row the app lists model by model (`individual`) gives each model its own
// checkboxes, so its caps are per model.
func (r *MfmLoadoutRules) checkboxCaps(model *string, models int) map[string]int {
	caps := map[string]int{}
	steppers := map[string]bool{}
	for _, option := range r.Options {
		if !sameModel(option.Model, model) {
			continue
		}
		if option.Input == "stepper" {
			steppers[option.ID] = true
		} else {
			caps[option.ID]++
		}
	}
	for id := range steppers {
		delete(caps, id)
	}
	for _, row := range r.Stock {
		if !sameModel(row.Model, model) {
			continue
		}
		for _, item := range row.Items {
			if cap, ok := caps[item.ID]; ok && item.Count > cap {
				caps[item.ID] = item.Count
			}
		}
	}
	individual := false
	for _, row := range r.Stock {
		if model != nil && row.Model != nil && *row.Model == *model && row.Individual {
			individual = true
		}
	}
	if individual {
		for id, cap := range caps {
			caps[id] = cap * models
		}
	}
	return caps
}
