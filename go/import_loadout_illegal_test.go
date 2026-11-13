package wh40kdc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The roster import conformance test strips diagnostics (a weaker contract than
// the TS/Rust/Python suites, which pin them on the canonical seed), so the
// loadout-illegal warning is asserted here directly against the corpus fixture
// authored for it.
func TestLoadoutIllegalWarningOnImport(t *testing.T) {
	inputPath := filepath.Join(corpusDir, "roster", "necrons-illegal-loadout", "input.gw.txt")
	text, err := os.ReadFile(inputPath)
	if err != nil {
		t.Skip("conformance corpus not available")
	}
	ds := EmbeddedDataset()
	result := tryImportRoster(string(text), ds)
	if result["ok"] != true {
		t.Fatalf("fixture failed to import: %v %v", result["reason"], result["message"])
	}
	roster, _ := asMap(result["roster"])
	diagnostics, _ := asMap(roster["diagnostics"])
	warnings, _ := diagnostics["warnings"].([]any)
	found := false
	for _, wAny := range warnings {
		w, _ := asMap(wAny)
		if w["code"] != "loadout-illegal" {
			continue
		}
		found = true
		if w["raw_name"] != "Necron Warriors" {
			t.Fatalf("loadout-illegal raw_name = %v, want Necron Warriors", w["raw_name"])
		}
		msg, _ := w["message"].(string)
		// Under MFM rules a count no whole-model assignment carries, within every
		// item's bounds, is a swap conflict on the unit itself.
		if !strings.Contains(msg, "swap-conflict:necron-warriors") {
			t.Fatalf("loadout-illegal message %q missing swap-conflict:necron-warriors", msg)
		}
	}
	if !found {
		t.Fatalf("no loadout-illegal warning emitted; warnings: %v", warnings)
	}
}
