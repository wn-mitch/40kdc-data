package wh40kdc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestAuthoredAbilitiesValidate runs every authored enrichment ability through
// the hand-rolled validator. The ability schema leans on oneOf/const/$ref
// branches (the condition predicates, the trigger event families); a keyword
// the validator mishandles surfaces here as a false rejection of valid data.
func TestAuthoredAbilitiesValidate(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "data", "enrichment", "*", "abilities.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no ability files found: %v", err)
	}
	v := NewSchemaValidator()
	checked := 0
	for _, file := range files {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var abilities []any
		if err := json.Unmarshal(b, &abilities); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		for _, a := range abilities {
			checked++
			if errs := v.validateTarget("ability", a); len(errs) > 0 {
				t.Errorf("%s %v: %v", file, mGet(a, "ability_id"), errs)
			}
		}
	}
	if checked < 1000 {
		t.Fatalf("validated only %d abilities", checked)
	}
}

// TestConditionShapesTheValidatorMustReject pins keywords the condition schema
// needs beyond the basic subset: minProperties (a battle-round with no bound),
// a two-operand `not`, and the retired `negated` flag. Each is valid under
// some oneOf branch unless the keyword is enforced.
func TestConditionShapesTheValidatorMustReject(t *testing.T) {
	v := NewSchemaValidator()
	ability := func(condition map[string]any) map[string]any {
		return map[string]any{
			"ability_id": "fixture-condition", "ability_type": "unit", "name": "Fixture", "behavior": "passive",
			"authored_by": "40kdc-community", "scope": map[string]any{"range": "unit", "duration": "battle"},
			"game_version": map[string]any{"edition": "11th", "dataslate": "launch"},
			"effect": map[string]any{
				"type": "conditional", "condition": condition,
				"effect": map[string]any{"type": "re-roll", "target": "unit", "modifier": map[string]any{"roll": "hit", "subset": "ones"}},
			},
		}
	}
	valid := map[string]any{"type": "battle-round", "parameters": map[string]any{"min": 2.0}}
	if errs := v.validateTarget("ability", ability(valid)); len(errs) > 0 {
		t.Fatalf("baseline fixture rejected: %v", errs)
	}
	cases := map[string]map[string]any{
		"unbounded battle-round": {"type": "battle-round", "parameters": map[string]any{}},
		"two-operand not":        {"operator": "not", "operands": []any{valid, valid}},
		"legacy negated flag":    {"type": "battle-round", "parameters": map[string]any{"min": 2.0}, "negated": true},
	}
	for name, condition := range cases {
		if errs := v.validateTarget("ability", ability(condition)); len(errs) == 0 {
			t.Errorf("%s: accepted, want at least one error", name)
		}
	}
}

// TestTriggerBindingConstraints pins the trigger allOf if/then rules: a
// source_ability belongs only to an ability-targeting trigger that names its
// subject, and a bound die variable only to its own event. Each mutation of a
// valid authored trigger must be rejected.
func TestTriggerBindingConstraints(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "data", "enrichment", "grey-knights", "abilities.json"))
	if err != nil {
		t.Fatal(err)
	}
	var abilities []map[string]any
	if err := json.Unmarshal(b, &abilities); err != nil {
		t.Fatal(err)
	}
	var base map[string]any
	for _, a := range abilities {
		if a["ability_id"] == "searing-soulflame" {
			base = a
		}
	}
	if base == nil {
		t.Fatal("searing-soulflame missing")
	}
	v := NewSchemaValidator()
	if errs := v.validateTarget("ability", base); len(errs) > 0 {
		t.Fatalf("baseline rejected: %v", errs)
	}
	mutate := func(edit func(trigger map[string]any)) map[string]any {
		var clone map[string]any
		raw, _ := json.Marshal(base)
		_ = json.Unmarshal(raw, &clone)
		edit(clone["trigger"].(map[string]any))
		return clone
	}
	cases := map[string]map[string]any{
		"source_ability on another event":   mutate(func(tr map[string]any) { tr["event"] = "used"; tr["filter"] = map[string]any{"kind": "ability"} }),
		"ability targeting without subject": mutate(func(tr map[string]any) { delete(tr, "subject") }),
		"die binding on the wrong event":    mutate(func(tr map[string]any) { tr["binds_die_variable"] = "fixture_die" }),
		"selected die binding, wrong event": mutate(func(tr map[string]any) { tr["binds_selected_die_variable"] = "fixture_die" }),
	}
	for name, ability := range cases {
		if errs := v.validateTarget("ability", ability); len(errs) == 0 {
			t.Errorf("%s: accepted, want at least one error", name)
		}
	}
}
