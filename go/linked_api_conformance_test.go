package wh40kdc

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

// The linked-API read queries against the linked-api corpus, driven through
// the runner's linked_query op (the cross-impl differ's path). A case's
// comparison is "scalar" or "ordered" (exact) or "set" (string lists compared
// sorted). Ties out with the TS reference and the Rust/Python ports via
// conformance/linked-api/cases.json.
func TestLinkedAPICorpus(t *testing.T) {
	var cases []struct {
		Name       string         `json:"name"`
		Query      string         `json:"query"`
		Args       map[string]any `json:"args"`
		Comparison string         `json:"comparison"`
		Expected   any            `json:"expected"`
	}
	if err := json.Unmarshal(loadCorpus(t, "linked-api", "cases.json"), &cases); err != nil {
		t.Fatalf("parse linked-api cases: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no linked-api conformance cases found")
	}
	s := NewRunnerState()
	init := s.Dispatch(map[string]any{
		"op":   "init",
		"args": map[string]any{"spec_version": float64(SpecVersion), "locale": "C", "tz": "UTC", "seed": float64(0)},
	})
	if init["ok"] != true {
		t.Fatalf("init failed: %v", init)
	}
	sorted := func(v any) any {
		list, ok := v.([]any)
		if !ok {
			return v
		}
		out := append([]any(nil), list...)
		sort.SliceStable(out, func(a, b int) bool {
			sa, _ := out[a].(string)
			sb, _ := out[b].(string)
			return sa < sb
		})
		return out
	}
	for _, c := range cases {
		resp := s.Dispatch(map[string]any{"op": "linked_query", "args": map[string]any{"query": c.Query, "input": c.Args}})
		if resp["ok"] != true {
			t.Errorf("linked-api/%s: %s errored: %v", c.Name, c.Query, resp)
			continue
		}
		// Round-trip through JSON so the response compares in the corpus's shape.
		b, err := json.Marshal(resp["value"])
		if err != nil {
			t.Fatalf("linked-api/%s: %v", c.Name, err)
		}
		var got any
		if err := json.Unmarshal(b, &got); err != nil {
			t.Fatalf("linked-api/%s: %v", c.Name, err)
		}
		want := c.Expected
		if c.Comparison == "set" {
			got, want = sorted(got), sorted(want)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("linked-api/%s: got %v, want %v", c.Name, got, want)
		}
	}
}
