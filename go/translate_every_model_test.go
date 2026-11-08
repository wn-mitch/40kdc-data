package wh40kdc

import "testing"

// Describer wording for a within check with models every (pinned against the TS reference,
// tools/test/semantic-authoring-every-model-position.test.ts).
func TestEveryModelObjectiveWithin(t *testing.T) {
	every := map[string]any{"type": "within", "parameters": map[string]any{
		"of": map[string]any{"objective": map[string]any{}}, "range": "objective-control", "models": "every",
	}}
	if got := describeCondition(every); got != "every model in the unit is within range of an objective marker" {
		t.Fatalf("every: got %q", got)
	}
	plain := map[string]any{"type": "within", "parameters": map[string]any{
		"of": map[string]any{"objective": map[string]any{}}, "range": "objective-control",
	}}
	if got := describeCondition(plain); got != "the unit is within range of an objective marker" {
		t.Fatalf("plain: got %q", got)
	}
	selected := map[string]any{"type": "within", "parameters": map[string]any{
		"of": map[string]any{"objective": map[string]any{"selection_var": "marker"}}, "range": "objective-control", "models": "every",
	}}
	if got := describeCondition(selected); got != "every model in the unit is within range of that objective marker" {
		t.Fatalf("selected: got %q", got)
	}
}
