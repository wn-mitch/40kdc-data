package wh40kdc

import "testing"

// Fabricated rules only. Mirrors the negated-conjunction case of
// tools/test/from-dsl-weapon-scope.test.ts.

func fabricatedGun(id string, keywords ...string) map[string]any {
	refs := make([]any, 0, len(keywords))
	for _, keyword := range keywords {
		refs = append(refs, map[string]any{"keyword_id": keyword})
	}
	return map[string]any{
		"id": id, "name": id, "type": "ranged",
		"profiles": []any{map[string]any{
			"name": id, "range": 24.0,
			"stats":    map[string]any{"A": 6.0, "BS": 4.0, "S": 4.0, "AP": 0.0, "D": 1.0},
			"keywords": refs,
		}},
		"game_version": map[string]any{"edition": "11th", "dataslate": "launch"},
	}
}

func fabricatedHits(t *testing.T, weapon map[string]any, buffs []any) float64 {
	t.Helper()
	target := map[string]any{
		"id": "target", "name": "Target", "faction_id": "test",
		"profiles":         []any{map[string]any{"name": "target", "M": 6.0, "T": 4.0, "W": 1.0, "Sv": 7.0, "Ld": 7.0, "OC": 1.0}},
		"keywords":         []any{"Infantry"},
		"faction_keywords": []any{},
		"game_version":     map[string]any{"edition": "11th", "dataslate": "launch"},
	}
	stages, _, err := crunch(map[string]any{
		"attacker":     map[string]any{"weapon": weapon, "profileIndex": 0.0},
		"target":       map[string]any{"unit": target, "profileIndex": 0.0, "modelCount": 1.0},
		"modelsFiring": 1.0,
		"buffs":        buffs,
		"context":      shootingCtx(),
	}, EmbeddedDataset())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range stages {
		if s["name"] == "hits" {
			return s["expected"].(float64)
		}
	}
	t.Fatal("no hits stage")
	return 0
}

// Blight Bombardment's shape, "ranged, and not (ranged and Blast)": the phase decides the negated
// conjunction's unit-level operand, leaving the Blast exclusion as the per-weapon gate.
func TestNegatedConjunctionDecidesUnitOperandsAndGatesTheRestPerWeapon(t *testing.T) {
	ranged := map[string]any{"type": "attack-is", "parameters": map[string]any{"attack_type": "ranged"}}
	blast := map[string]any{"type": "attack-is", "parameters": map[string]any{"weapons": map[string]any{"keyword": map[string]any{"keyword_id": "blast"}}}}
	effect := map[string]any{
		"type": "conditional",
		"condition": map[string]any{"operator": "and", "operands": []any{ranged, map[string]any{
			"operator": "not", "operands": []any{map[string]any{"operator": "and", "operands": []any{ranged, blast}}},
		}}},
		"effect": map[string]any{"type": "re-roll", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "subset": "ones"}},
	}
	out := effectToBuffs(effect, leverSource(), shootingCtx(), "attacker")
	if len(out.unsupported) != 0 {
		t.Fatalf("unsupported: %v", out.unsupported)
	}
	if len(out.applied) != 1 {
		t.Fatalf("applied: %v", out.applied)
	}
	gate, _ := out.applied[0].(map[string]any)["applicableWhen"].(map[string]any)
	if gate == nil || gate["excludedWeaponKeywords"] == nil {
		t.Fatalf("want a Blast exclusion gate, got %v", gate)
	}
	rifle := fabricatedGun("rifle")
	cannon := fabricatedGun("cannon", "blast")
	if fabricatedHits(t, rifle, out.applied) <= fabricatedHits(t, rifle, nil) {
		t.Fatal("the re-roll should lift the non-Blast gun's hits")
	}
	if fabricatedHits(t, cannon, out.applied) != fabricatedHits(t, cannon, nil) {
		t.Fatal("the re-roll should leave the Blast gun's hits alone")
	}
}
