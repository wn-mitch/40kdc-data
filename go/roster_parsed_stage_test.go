package wh40kdc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestGwTextParsedStageMatchesGoldens checks the parse stage (before
// resolution) of every corpus case seeded by GW app text against the TS
// expected.parsed.json. Resolution can hide parser differences (it re-reads
// model names out of wargear lines), so the GW-text parsers are pinned here.
// Mirrors the gw-text arm of the Rust parsed_stage_matches_reference_goldens.
func TestGwTextParsedStageMatchesGoldens(t *testing.T) {
	checked := 0
	for _, caseDir := range rosterCaseDirs(t) {
		caseName := filepath.Base(caseDir)
		// The canonical seed is input.gw.txt only when no JSON seed precedes it.
		if _, err := os.Stat(filepath.Join(caseDir, "input.json")); err == nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(caseDir, "input.newrecruit-json.json")); err == nil {
			continue
		}
		input, err := os.ReadFile(filepath.Join(caseDir, "input.gw.txt"))
		if err != nil {
			continue
		}
		golden, err := os.ReadFile(filepath.Join(caseDir, "expected.parsed.json"))
		if err != nil {
			t.Fatalf("roster/%s: read parsed golden: %v", caseName, err)
		}
		var expected any
		if err := json.Unmarshal(golden, &expected); err != nil {
			t.Fatalf("roster/%s: parse parsed golden: %v", caseName, err)
		}
		var parsed map[string]any
		for _, adapter := range importAdapters {
			if adapter.matches(string(input)) {
				parsed, err = adapter.parse(string(input))
				if err != nil {
					t.Fatalf("roster/%s: %s parse: %v", caseName, adapter.id, err)
				}
				break
			}
		}
		if parsed == nil {
			t.Fatalf("roster/%s: no adapter matched input.gw.txt", caseName)
		}
		checked++
		if got, want := canon(t, parsed), canon(t, expected); got != want {
			t.Errorf("roster/%s: parsed stage diverged from the TS golden\n got: %s\nwant: %s", caseName, got, want)
		}
	}
	if checked == 0 {
		t.Fatal("no gw-text roster cases exercised")
	}
}
