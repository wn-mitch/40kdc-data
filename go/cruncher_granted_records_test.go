package wh40kdc

import "testing"

func TestResolveGrantedRecordsPrintsARecordAndLeavesItselfAndCoreAbilitiesAlone(t *testing.T) {
	record := map[string]any{
		"effect": map[string]any{"type": "roll-modifier", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "operation": "add", "value": 1.0}},
		"usage":  map[string]any{"frequency": "once-per-turn", "per": "unit"},
	}
	lookup := func(id string) map[string]any {
		if id == "fabricated-rite" {
			return record
		}
		return nil
	}
	grant := func(ability string) map[string]any {
		return map[string]any{"type": "ability-grant", "target": "this-unit", "modifier": map[string]any{"ability": ability}}
	}
	seen := map[string]bool{"fabricated-banner": true}
	resolved := ResolveGrantedRecords(map[string]any{"type": "sequence", "steps": []any{grant("fabricated-rite")}}, lookup, seen)
	steps := resolved.(map[string]any)["steps"].([]any)
	definition := steps[0].(map[string]any)["modifier"].(map[string]any)["definition"]
	want := map[string]any{"type": "ability-part", "effect": record["effect"], "usage": record["usage"]}
	if got := canon(t, definition); got != canon(t, want) {
		t.Errorf("definition = %s, want %s", got, canon(t, want))
	}
	for _, ability := range []string{"stealth", "fabricated-banner"} {
		if _, changed := resolveGrantedRecords(grant(ability), lookup, seen); changed {
			t.Errorf("grant of %s was resolved", ability)
		}
	}
}
