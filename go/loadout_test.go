package wh40kdc

import "testing"

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
	if violations := validateLoadout(unit, 2, nil, map[string]int{"plasma": 2}, models); len(violations) == 0 || violations[len(violations)-1]["code"] != "swap-conflict" {
		t.Fatalf("two capped variants must fail exact legality, got %v", violations)
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
	if violations := validateLoadout(unit, 2, scannerOptions, map[string]int{"plasma": 2, "scanner": 1}, sharedModels); len(violations) == 0 || violations[len(violations)-1]["code"] != "swap-conflict" {
		t.Fatalf("scanner must not bypass plasma cap, got %v", violations)
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
