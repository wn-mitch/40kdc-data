package wh40kdc

import "testing"

func atOrBelowHalfCondition() map[string]any {
	return map[string]any{"type": "strength", "parameters": map[string]any{
		"subject": "this-unit", "below": "half", "at_or_below": true,
	}}
}

func TestAtOrBelowHalfStrengthRender(t *testing.T) {
	if got := describeCondition(atOrBelowHalfCondition()); got != "the unit is at or below half strength" {
		t.Fatalf("at or below = %q", got)
	}
	below := map[string]any{"type": "strength", "parameters": map[string]any{"subject": "this-unit", "below": "half"}}
	if got := describeCondition(below); got != "the unit is below half strength" {
		t.Fatalf("below = %q", got)
	}
}

// A unit known only to be below starting may sit exactly at half, so that outcome stays undecided.
func TestAtOrBelowHalfStrengthOutcomes(t *testing.T) {
	effect := map[string]any{"type": "conditional", "condition": atOrBelowHalfCondition(), "effect": map[string]any{
		"type": "roll-modifier", "target": "this-unit",
		"modifier": map[string]any{"roll": "hit", "operation": "add", "value": 1.0},
	}}
	source := map[string]any{"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
	for _, tc := range []struct {
		strength             string
		applied, unsupported int
	}{{"below-half", 1, 0}, {"full", 0, 0}, {"below-starting", 0, 1}} {
		out := effectToBuffs(effect, source, map[string]any{"phase": "shooting", "attackerStrength": tc.strength}, "attacker")
		if len(out.applied) != tc.applied || len(out.unsupported) != tc.unsupported {
			t.Errorf("%s: applied=%d unsupported=%d", tc.strength, len(out.applied), len(out.unsupported))
		}
	}
}
