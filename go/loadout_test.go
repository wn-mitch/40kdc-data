package wh40kdc

import (
	"reflect"
	"testing"
	"time"
)

// A lone plain single-target swap (base weapon → one replacement, max 1): a
// model takes one or the other, never both. Each id is independently in [0,1],
// so only the swap-conservation check catches keeping both. Uses a synthetic
// unit/options (data-independent) rather than a live unit, since dump-primary
// wargear data is regenerated per ingest. Mirror of the TS/Rust/Python tests.
func TestValidateLoadoutSwapConflict(t *testing.T) {
	unit := map[string]any{"weapon_ids": []any{"diabolus-heavy-stubber"}}
	opts := []any{
		map[string]any{
			"replaces":         []any{"diabolus-heavy-stubber"},
			"replacement":      []any{"havoc-multi-launcher"},
			"model_constraint": map[string]any{"max_count": float64(1)},
		},
	}

	both := map[string]int{"diabolus-heavy-stubber": 1, "havoc-multi-launcher": 1}
	v := validateLoadout(unit, 1, opts, both, nil)
	if len(v) != 1 || v[0]["id"] != "diabolus-heavy-stubber" || v[0]["code"] != "swap-conflict" {
		t.Fatalf("expected one swap-conflict on diabolus-heavy-stubber, got %v", v)
	}

	if got := validateLoadout(unit, 1, opts, map[string]int{"diabolus-heavy-stubber": 1}, nil); len(got) != 0 {
		t.Fatalf("keeping the stubber should be legal, got %v", got)
	}
	if got := validateLoadout(unit, 1, opts, map[string]int{"havoc-multi-launcher": 1}, nil); len(got) != 0 {
		t.Fatalf("swapping to the havoc launcher should be legal, got %v", got)
	}
}

// A 1-model unit with two slots that can each add "sword" (cf. the Knight
// Destrier): without the single-weapon flat-budget clamp the weapon sums to 2.
// The "max one" rule is modelled as a single-item per-unit budget, and
// maximalLoadout/weaponBounds must honour it. Mirror of the TS/Rust/Python tests.
func TestSingleWeaponFlatBudgetCaps(t *testing.T) {
	unit := map[string]any{
		"weapon_ids":      []any{"gun-a", "gun-b"},
		"wargear_budgets": []any{map[string]any{"items": []any{"sword"}, "count": float64(1), "per_models": float64(0)}},
	}
	opts := []any{
		map[string]any{"replaces": []any{"gun-a"}, "replacement": []any{"sword"}, "model_constraint": map[string]any{"any_number": true}},
		map[string]any{"replaces": []any{"gun-b"}, "replacement": []any{"sword"}, "model_constraint": map[string]any{"any_number": true}},
	}

	if b := weaponBounds(unit, 1, opts, nil)["sword"]; b.min != 0 || b.max != 1 {
		t.Fatalf("expected sword bound {0,1}, got {%d,%d}", b.min, b.max)
	}
	if got := maximalLoadout(unit, 1, opts, nil)["sword"]; got != 1 {
		t.Fatalf("expected maximal sword count 1, got %d", got)
	}
}

func TestVariantBudgetCap(t *testing.T) {
	unit := map[string]any{"count": float64(1), "per_models": float64(10), "scope": "unit"}
	row := map[string]any{"count": float64(1), "per_models": float64(5), "scope": "model-row"}
	flat := map[string]any{"count": float64(2), "per_models": float64(0), "scope": "unit"}
	if got := variantBudgetCap(unit, 20, 5); got != 2 {
		t.Fatalf("expected unit cap 2, got %d", got)
	}
	if got := variantBudgetCap(row, 20, 5); got != 1 {
		t.Fatalf("expected row cap 1, got %d", got)
	}
	if got := variantBudgetCap(flat, 20, 5); got != 2 {
		t.Fatalf("expected flat cap 2, got %d", got)
	}
	// Two per full five models; the proportional 2-per-5 gives 1 at four and 3 at eight.
	stepped := map[string]any{"count": float64(2), "per_models": float64(5), "scope": "unit", "stepped": true}
	for n, want := range map[int]int{4: 0, 5: 2, 8: 2, 9: 2, 10: 4} {
		if got := variantBudgetCap(stepped, n, n); got != want {
			t.Fatalf("expected stepped cap %d at %d models, got %d", want, n, got)
		}
	}
	stepped["stepped"] = false
	if got := variantBudgetCap(stepped, 8, 8); got != 3 {
		t.Fatalf("expected proportional cap 3 at 8 models, got %d", got)
	}
}

func TestVariantLoadoutUsesNamedCapsAndExactLegality(t *testing.T) {
	unit := map[string]any{"id": "variant-unit"}
	models := []any{map[string]any{
		"name": "Trooper", "min": float64(2), "max": float64(2),
		"default_weapon_ids": []any{"gun"},
		"loadout_variants": []any{
			map[string]any{"name": "gunner", "weapon_ids": []any{"gun"}},
			map[string]any{"name": "plasma", "weapon_ids": []any{"plasma"}, "max_count": float64(1)},
		},
	}}
	got := LoadoutCandidates(unit, 2, nil, models, nil, nil)
	for _, candidate := range got {
		if candidate == "plasma×2 => plasma:2" {
			t.Fatalf("variant max_count must constrain candidates: %v", got)
		}
	}
	if got, want := validateLoadout(unit, 2, nil, map[string]int{"plasma": 2}, models), []map[string]string{
		{"id": "plasma", "code": "exceeds-max", "message": "plasma: 2 exceeds the most any legal loadout of 2 models fields"},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("a variant max_count breach must report exceeds-max on its item: got %v, want %v", got, want)
	}
	if violations := validateLoadout(unit, 2, nil, map[string]int{"plasma": 1}, models); len(violations) != 0 {
		t.Fatalf("an explicit variant with omitted defaults should be completed legally, got %v", violations)
	}
	if violations := validateLoadout(unit, 2, nil, map[string]int{"gun": 1, "plasma": 1}, models); len(violations) != 0 {
		t.Fatalf("one of each declared variant should be legal, got %v", violations)
	}

	scannerOptions := []any{
		map[string]any{"replaces": []any{"rifle"}, "replacement": []any{"plasma"}, "model_constraint": map[string]any{"any_number": true}},
		map[string]any{"replacement": []any{"scanner"}, "model_constraint": map[string]any{"max_count": float64(1)}},
	}
	sharedRow := map[string]any{
		"name": "Trooper", "min": float64(2), "max": float64(2),
		"loadout_variants": []any{
			map[string]any{"name": "Rifle", "weapon_ids": []any{"rifle"}},
			map[string]any{"name": "Plasma", "weapon_ids": []any{"plasma"}, "max_count": float64(1)},
		},
		"loadout_variant_budgets": []any{
			map[string]any{"variant_names": []any{"Plasma"}, "count": float64(1), "per_models": float64(0), "scope": "unit"},
		},
	}
	sharedModels := []any{sharedRow}
	hasPlasmaOptionRoute := false
	for _, candidate := range rowCandidates(sharedRow, 0, 2, 2, scannerOptions).candidates {
		if candidate.key == "1:plasma" && candidate.variantName == "Plasma" && len(candidate.usedOptions) == 1 && candidate.usedOptions[0] == 0 {
			hasPlasmaOptionRoute = true
			break
		}
	}
	if !hasPlasmaOptionRoute {
		t.Fatal("expected rifle-to-plasma option provenance under the canonical Plasma variant")
	}
	scannerCandidates := LoadoutCandidates(unit, 2, scannerOptions, sharedModels, nil, nil)
	legal := "Rifle×1;Plasma×1 => plasma:1,rifle:1,scanner:1"
	foundLegal := false
	for _, candidate := range scannerCandidates {
		if candidate == legal {
			foundLegal = true
			break
		}
	}
	if !foundLegal {
		t.Fatalf("expected legal rifle/plasma scanner candidate, got %v", scannerCandidates)
	}
	if violations := validateLoadout(unit, 2, scannerOptions, map[string]int{"rifle": 1, "plasma": 1, "scanner": 1}, sharedModels); len(violations) != 0 {
		t.Fatalf("rifle, plasma, and scanner should be legal, got %v", violations)
	}
	if violations := validateLoadout(unit, 2, scannerOptions, map[string]int{"plasma": 2, "scanner": 1}, sharedModels); len(violations) != 1 || violations[0]["code"] != "exceeds-max" || violations[0]["id"] != "plasma" {
		t.Fatalf("scanner must not bypass plasma cap, got %v", violations)
	}
}

func TestVariantLoadoutReportsBoundsAndBudgetsBeforeSwapConflict(t *testing.T) {
	models := []any{map[string]any{
		"name": "Trooper", "min": float64(2), "max": float64(2),
		"default_weapon_ids": []any{"gun"},
		"loadout_variants": []any{
			map[string]any{"name": "gunner", "weapon_ids": []any{"gun"}},
			map[string]any{"name": "plasma", "weapon_ids": []any{"plasma"}},
		},
	}}

	if got, want := validateLoadout(map[string]any{"id": "variant-unit"}, 2, nil, map[string]int{"gun": 3}, models), []map[string]string{
		{"id": "gun", "code": "exceeds-max", "message": "gun: 3 exceeds max 2"},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("variant bound violations must not add swap-conflict: got %v, want %v", got, want)
	}

	unit := map[string]any{
		"id": "variant-unit",
		"wargear_budgets": []any{
			map[string]any{"items": []any{"plasma"}, "count": float64(1), "per_models": float64(0)},
		},
	}
	if got, want := validateLoadout(unit, 2, nil, map[string]int{"plasma": 2}, models), []map[string]string{
		{"id": "plasma", "code": "exceeds-max", "message": "plasma: 2 exceeds allowance 1 (1 per unit)"},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("variant budget violations must not add swap-conflict: got %v, want %v", got, want)
	}
}

func TestCompleteLoadoutRanksExplicitRequirementsFirst(t *testing.T) {
	candidates := []rowCandidate{
		{weapons: map[string]int{"gun": 1}, key: "gun"},
		{weapons: map[string]int{"plasma": 1}, usedOptions: []int{0}, key: "plasma"},
		{weapons: map[string]int{"plasma": 1}, usedOptions: []int{0, 1}, key: "plasma-slow"},
	}
	sortCompletionCandidates(candidates, map[string]int{"plasma": 2})
	if got, want := []string{candidates[0].key, candidates[1].key, candidates[2].key}, []string{"plasma", "plasma-slow", "gun"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("completion candidates must prioritize explicit requirements: got %v, want %v", got, want)
	}
}

func TestRowCandidatesRequireDuplicateReplacementPrerequisites(t *testing.T) {
	options := []any{map[string]any{
		"replaces": []any{"gun", "gun"}, "replacement": []any{"launcher"},
		"model_constraint": map[string]any{"max_count": float64(1)},
	}}
	candidates := enumerateRowCandidates(map[string]int{"gun": 1}, "Trooper", options, nil)
	for _, candidate := range candidates {
		if candidate.weapons["launcher"] > 0 {
			t.Fatalf("replacement requiring two guns applied with one prerequisite: %#v", candidate)
		}
	}
}

func TestLoadoutCandidatesSmallLimitMatchesCanonicalPrefix(t *testing.T) {
	unit := map[string]any{"id": "candidate-prefix"}
	models := []any{
		map[string]any{"name": "Leader", "min": float64(1), "max": float64(1), "default_weapon_ids": []any{"pistol"}},
		map[string]any{"name": "Trooper", "min": float64(1), "max": float64(3), "default_weapon_ids": []any{"rifle", "knife"}},
		map[string]any{"name": "Specialist", "min": float64(0), "max": float64(2), "default_weapon_ids": []any{"special", "knife"}},
	}
	all := LoadoutCandidates(unit, 4, nil, models, nil, nil)
	for _, cap := range []int{1, 2} {
		limit := cap
		got := LoadoutCandidates(unit, 4, nil, models, nil, &limit)
		want := append([]string(nil), all[:cap]...)
		if len(all) > cap {
			want = append(want, LoadoutCandidatesTruncated)
		}
		if len(got) != len(want) {
			t.Fatalf("limit %d returned %v, want %v", cap, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("limit %d returned %v, want %v", cap, got, want)
			}
		}
	}
}

func TestLoadoutCandidatesFiveModels257VariantsLimitZeroReturnsMarker(t *testing.T) {
	variants := make([]any, 257)
	for i := range variants {
		variants[i] = map[string]any{
			"name":       "Variant " + itoa(i),
			"weapon_ids": []any{"weapon-" + itoa(i)},
		}
	}
	models := []any{map[string]any{
		"name": "Trooper", "min": float64(5), "max": float64(5),
		"loadout_variants": variants,
	}}
	limit := 0
	if got := LoadoutCandidates(map[string]any{"id": "candidate-limit-zero"}, 5, nil, models, nil, &limit); len(got) != 1 || got[0] != LoadoutCandidatesTruncated {
		t.Fatalf("limit zero should return only the truncation marker, got %v", got)
	}
}

// manyCandidateBag is ten models that each swap a gun for one of six ranged
// picks and a knife for one of six melee picks: 49 per-model candidates.
func manyCandidateBag(meleeCounts []int) ([]any, []any, map[string]int) {
	ranged, melee := []any{}, []any{}
	counts := map[string]int{}
	for i := 0; i < 6; i++ {
		r, m := "r"+string(rune('0'+i)), "m"+string(rune('0'+i))
		ranged, melee = append(ranged, []any{r}), append(melee, []any{m})
		counts[r] = 1
		if i < 4 {
			counts[r] = 2
		}
		if meleeCounts[i] > 0 {
			counts[m] = meleeCounts[i]
		}
	}
	options := []any{
		map[string]any{"replaces": []any{"gun"}, "replacement_choice": ranged, "model_constraint": map[string]any{"any_number": true}},
		map[string]any{"replaces": []any{"knife"}, "replacement_choice": melee, "model_constraint": map[string]any{"any_number": true}},
	}
	models := []any{map[string]any{"name": "Trooper", "min": float64(10), "max": float64(10), "default_weapon_ids": []any{"gun", "knife"}}}
	return options, models, counts
}

// Eleven melee picks for ten models: exhausting every split of the models
// across the candidates took seconds; failed sub-states are now cut. Mirror of
// the TS/Rust/Python tests.
func TestGroupLoadoutInfeasibleBagOverManyCandidates(t *testing.T) {
	options, models, counts := manyCandidateBag([]int{2, 2, 2, 2, 2, 1})
	started := time.Now()
	if got := GroupLoadout(map[string]any{"id": "fabricated-unit"}, 10, options, models, counts); got != nil {
		t.Fatalf("eleven melee picks for ten models should not group, got %v", got)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("infeasible bag took %v", elapsed)
	}
	options, models, counts = manyCandidateBag([]int{2, 2, 2, 2, 2, 0})
	groups := GroupLoadout(map[string]any{"id": "fabricated-unit"}, 10, options, models, counts)
	total := 0
	for _, group := range groups {
		total += asInt(group.(map[string]any)["count"])
	}
	if total != 10 {
		t.Fatalf("feasible bag should group ten models, got %v", groups)
	}
}
