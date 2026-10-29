package wh40kdc

import (
	"encoding/json"
	"testing"
)

// Describer pins for the phase-4 shapes. Each expected string is the exact TS
// render pinned by tools/test/translate-phase4-shapes.test.ts; a drift in any
// port's wording breaks byte parity with the reference describer.

func j(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("bad fixture %s: %v", s, err)
	}
	return m
}

// renderAbility renders an effect as a permanent ability; extra merges in
// record-level fields (usage, scope).
func renderAbility(t *testing.T, effect string, extra string) string {
	t.Helper()
	a := map[string]any{"effect": j(t, effect), "scope": map[string]any{"duration": "permanent"}}
	if extra != "" {
		for k, v := range j(t, extra) {
			a[k] = v
		}
	}
	return describeAbility(a)
}

// Warlord is the model chosen at mustering; its label is the definite noun phrase in both plural forms.
func TestWarlordDesignationTerm(t *testing.T) {
	for _, plural := range []bool{false, true} {
		term, ok := designationTerm("warlord", plural)
		if !ok || term != "the Warlord" {
			t.Fatalf("designationTerm(warlord, %v) = %q, %v; want \"the Warlord\", true", plural, term, ok)
		}
	}
}

func TestUnlimitedMoveModifierKeepsRestrictionsAndMoveScope(t *testing.T) {
	got := moveModifierLeaf(map[string]any{
		"maximum": "unlimited", "applies_to_moves": []any{"advance"}, "no_end_in_engagement": true,
	}, "this unit", effCtx{})
	want := "this unit can move any distance; this unit cannot end a move within Engagement Range of any enemy unit, during its Advance moves"
	if got != want {
		t.Fatalf("unlimited move render = %q, want %q", got, want)
	}
}

func TestUsedAbilityPhraseRendersSourceAndUsage(t *testing.T) {
	got := usedAbilityPhrase(map[string]any{
		"source": []any{"unit", "enhancement"},
		"usage":  map[string]any{"frequency": "n-per-battle", "count": 1.0},
	})
	want := "an ability from its datasheet or an Enhancement that can be used once per battle"
	if got != want {
		t.Fatalf("used ability phrase = %q, want %q", got, want)
	}
}

func TestCanonicalMatchesPredicateRendersInsteadOfFallback(t *testing.T) {
	condition := map[string]any{
		"type": "matches",
		"parameters": map[string]any{
			"subject": "this-unit",
			"filter":  map[string]any{"all_of": []any{"INFANTRY", "PSYKER"}},
		},
	}
	if got, want := describeCondition(condition), `the unit has the INFANTRY and PSYKER keywords`; got != want {
		t.Fatalf("matches render = %q, want %q", got, want)
	}
}

func TestCanonicalAppliesToPreservesAllFilterPredicates(t *testing.T) {
	got := describeAppliesTo(map[string]any{
		"all_of":     []any{"INFANTRY"},
		"any_of":     []any{"PSYKER", "CHARACTER"},
		"none_of":    []any{"MONSTER"},
		"not_all_of": []any{"EPIC HERO", "VEHICLE"},
	})
	want := "Applies to: units with INFANTRY and at least one of PSYKER or CHARACTER (excluding MONSTER) (excluding units with all of EPIC HERO, VEHICLE)."
	if got != want {
		t.Fatalf("applies_to render = %q, want %q", got, want)
	}
}

func TestStructuredWeaponAbilityGrantUsesCanonicalKeywordsField(t *testing.T) {
	effect := map[string]any{
		"type":   "weapon-ability-grant",
		"target": "this-model",
		"modifier": map[string]any{
			"keywords": []any{map[string]any{
				"keyword_id": "anti",
				"parameters": map[string]any{"target_keyword": "MONSTER", "threshold": 4.0},
			}},
		},
	}
	if got, want := describeEffectInline(effect, effCtx{}), `this model's weapons gain [ANTI-MONSTER 4+]`; got != want {
		t.Fatalf("structured weapon ability render = %q, want %q", got, want)
	}
}

func TestControlsStructuredComparisonRendersCanonicalScope(t *testing.T) {
	condition := map[string]any{
		"type": "controls",
		"parameters": map[string]any{
			"by":        "friendly",
			"objective": map[string]any{"role": "non-home"},
			"count":     map[string]any{"min": 2.0, "max": 3.0},
			"compare":   map[string]any{"owner": "enemy", "comparison": "gte"},
		},
	}
	want := "you control 2-3 objectives (excluding home) and the number of objectives (excluding home) you control is at least the number the opponent controls"
	if got := describeCondition(condition); got != want {
		t.Fatalf("controls render = %q, want %q", got, want)
	}
}
