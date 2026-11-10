package wh40kdc

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Default units, wargear legality, and units at a total model count against
// the mfm_loadout corpus, driven through the runner's default_mfm_loadout,
// check_mfm_loadout, mfm_unit, mfm_assignment and check_mfm_unit ops and
// compared exactly. Ties out with the TS reference and the Rust/Python ports
// via conformance/mfm_loadout/*.json; candidates and groups pin search order.
func TestMfmLoadoutCorpus(t *testing.T) {
	s := NewRunnerState()
	init := s.Dispatch(map[string]any{
		"op":   "init",
		"args": map[string]any{"spec_version": float64(SpecVersion), "locale": "C", "tz": "UTC", "seed": float64(0)},
	})
	if init["ok"] != true {
		t.Fatalf("init failed: %v", init)
	}
	for _, file := range []struct{ name, op string }{
		{"defaults.json", "default_mfm_loadout"},
		{"checks.json", "check_mfm_loadout"},
		{"units.json", "mfm_unit"},
		{"assignments.json", "mfm_assignment"},
		{"unit-checks.json", "check_mfm_unit"},
	} {
		var cases []struct {
			Name     string         `json:"name"`
			Args     map[string]any `json:"args"`
			Expected any            `json:"expected"`
		}
		if err := json.Unmarshal(loadCorpus(t, "mfm_loadout", file.name), &cases); err != nil {
			t.Fatalf("parse mfm_loadout/%s: %v", file.name, err)
		}
		if len(cases) == 0 {
			t.Fatalf("no mfm_loadout/%s cases", file.name)
		}
		for _, c := range cases {
			resp := s.Dispatch(map[string]any{"op": file.op, "args": c.Args})
			if resp["ok"] != true {
				t.Fatalf("mfm_loadout/%s: %s errored: %v", c.Name, file.op, resp)
			}
			// Round-trip through JSON so the response compares in the corpus's shape.
			b, err := json.Marshal(resp["value"])
			if err != nil {
				t.Fatalf("mfm_loadout/%s: %v", c.Name, err)
			}
			var got any
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("mfm_loadout/%s: %v", c.Name, err)
			}
			if !reflect.DeepEqual(got, c.Expected) {
				t.Fatalf("mfm_loadout/%s: got %v, want %v", c.Name, got, c.Expected)
			}
		}
	}
}

// A fractional or negative count is not a configuration, so the op refuses it
// rather than truncating it into one.
func TestMfmLoadoutRejectsMalformedCounts(t *testing.T) {
	s := NewRunnerState()
	s.Dispatch(map[string]any{
		"op":   "init",
		"args": map[string]any{"spec_version": float64(SpecVersion), "locale": "C", "tz": "UTC", "seed": float64(0)},
	})
	for _, counts := range []map[string]any{{"dread-klaw": 1.5}, {"dread-klaw": float64(-1)}} {
		resp := s.Dispatch(map[string]any{"op": "check_mfm_loadout", "args": map[string]any{
			"unitId": "deff-dread", "factionId": "orks", "models": map[string]any{}, "counts": counts,
		}})
		if resp["error_kind"] != "INVALID_INPUT" {
			t.Fatalf("counts %v: got %v, want INVALID_INPUT", counts, resp)
		}
	}
}
