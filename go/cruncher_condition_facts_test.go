package wh40kdc

import (
	"math"
	"testing"
)

// The corpus keys only exercise plain integers and BMP strings; this pins the branches it
// does not reach against JS output: UTF-16 key order (an astral key sorts before U+FF01),
// JS exponent thresholds, -0, and unescaped non-ASCII and HTML characters.
func TestCanonicalJSONMatchesJS(t *testing.T) {
	value := map[string]any{
		"！":          1.0,
		"\U0001F600": 2.0,
		"b":          []any{1.5, math.Copysign(0, -1), 1e21, 123456789012345680000.0, 1e-7, 0.000001, -2.5e-8, nil, true},
		"a":          "x’<&>\"\n",
	}
	want := `{"a":"x’<&>\"\n","b":[1.5,0,1e+21,123456789012345680000,1e-7,0.000001,-2.5e-8,null,true],"😀":2,"！":1}`
	if got := canonicalJSON(value); got != want {
		t.Errorf("canonicalJSON = %s\nwant %s", got, want)
	}
}

// A compound decided by one operand contributes no needs; undecided leaves dedupe by key.
func TestConditionNeedsSkipsDecidedAndDedupes(t *testing.T) {
	leaf := map[string]any{"type": "happened", "parameters": map[string]any{"event": "disembarked"}}
	decided := map[string]any{"type": "decided"}
	condition := map[string]any{"operator": "and", "operands": []any{leaf, leaf, map[string]any{"operator": "or", "operands": []any{decided, leaf}}}}
	evaluate := func(node map[string]any) any {
		if node["type"] == "decided" {
			return true
		}
		if node["operator"] == "or" {
			return true
		}
		return nil
	}
	needs := conditionNeeds(condition, "target", evaluate)
	if len(needs) != 1 {
		t.Fatalf("needs = %v, want one", needs)
	}
	if key := needs[0].(map[string]any)["key"]; key != `target:{"parameters":{"event":"disembarked"},"type":"happened"}` {
		t.Errorf("key = %v", key)
	}
}
