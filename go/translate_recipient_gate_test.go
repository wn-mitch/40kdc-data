package wh40kdc

import (
	"strings"
	"testing"
)

// Describer wording for a condition on each unit an effect reaches (subject recipient), pinned
// against the TS reference (tools/test/translate-shapes.test.ts). Hunts a recipient condition read
// as "the unit" (this unit) and its effect as "all enemy units".

func recipientGateRender(effect map[string]any) string {
	return describeAbility(map[string]any{"effect": effect, "scope": map[string]any{"duration": "permanent"}})
}

func recipientWithin(of string) map[string]any {
	return map[string]any{"type": "matches", "parameters": map[string]any{
		"subject": "recipient",
		"filter":  map[string]any{"within": map[string]any{"of": of, "range": map[string]any{"inches": 3.0}}},
	}}
}

func recipientOC(target map[string]any) map[string]any {
	return map[string]any{"type": "stat-modifier", "target": target,
		"modifier": map[string]any{"stat": "OC", "operation": "worsen", "value": 1.0}}
}

func TestRecipientGateNamesTheUnitWithTheFilter(t *testing.T) {
	e := map[string]any{"type": "conditional", "condition": recipientWithin("this-unit"),
		"effect": recipientOC(map[string]any{"owner": "enemy"})}
	want := "While an enemy unit is within 3\" of the unit, worsen that unit's Objective Control characteristic by 1."
	if got := recipientGateRender(e); got != want {
		t.Fatalf("got %q", got)
	}
}

func TestRecipientGateModelLevelSaysThatModel(t *testing.T) {
	shocked := map[string]any{"type": "matches", "parameters": map[string]any{
		"subject": "recipient", "filter": map[string]any{"state": "battle-shocked"}}}
	both := map[string]any{"operator": "and", "operands": []any{recipientWithin("this-unit"), shocked}}
	e := map[string]any{"type": "conditional", "condition": both,
		"effect": recipientOC(map[string]any{"owner": "enemy", "level": "model"})}
	want := "While an enemy model is within 3\" of the unit, while that model is Battle-shocked, worsen that model's Objective Control characteristic by 1."
	if got := recipientGateRender(e); got != want {
		t.Fatalf("got %q", got)
	}
}

func TestRecipientGateInsideASequence(t *testing.T) {
	gated := map[string]any{"type": "conditional", "condition": recipientWithin("this-unit"),
		"effect": recipientOC(map[string]any{"owner": "enemy", "all_of": []any{"VEHICLE"}})}
	improve := map[string]any{"type": "stat-modifier", "target": "this-unit",
		"modifier": map[string]any{"stat": "OC", "operation": "improve", "value": 1.0}}
	got := recipientGateRender(map[string]any{"type": "sequence", "steps": []any{gated, improve}})
	want := "While an enemy VEHICLE unit is within 3\" of the unit, worsen that unit's Objective Control characteristic by 1."
	if !strings.Contains(got, want) {
		t.Fatalf("got %q", got)
	}
}

func TestRecipientGateLeavesOwnUnitCondition(t *testing.T) {
	own := map[string]any{"type": "matches", "parameters": map[string]any{
		"subject": "this-unit",
		"filter":  map[string]any{"within": map[string]any{"of": "this-model", "range": map[string]any{"inches": 3.0}}},
	}}
	e := map[string]any{"type": "conditional", "condition": own, "effect": recipientOC(map[string]any{"owner": "enemy"})}
	want := "While the unit is within 3\" of this model, worsen all enemy units' Objective Control characteristic by 1."
	if got := recipientGateRender(e); got != want {
		t.Fatalf("got %q", got)
	}
}
