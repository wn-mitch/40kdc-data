package wh40kdc

import "testing"

// A Mawloc's Terror From The Deep inflicts mortal wounds on a unit it lands near; the Dataset
// walk finds it with its ability id, name and undecided conditions as needs.
func TestMortalWoundSourcesForUnit(t *testing.T) {
	ds := EmbeddedDataset()
	sources, _ := ds.MortalWoundSourcesFor(
		map[string]any{"unitId": "mawloc", "factionId": "tyranids"},
		map[string]any{"phase": "shooting"},
	)
	found := false
	for _, source := range sources {
		if source.AbilityID == "terror-from-the-deep-tyranids" {
			found = true
			if source.Expected != 2 || source.Label != "Terror From The Deep" || len(source.Needs) != 2 {
				t.Errorf("unexpected source %+v", source)
			}
		}
	}
	if !found {
		t.Fatalf("terror-from-the-deep-tyranids not among %d sources", len(sources))
	}
	if sources, unsupported := ds.MortalWoundSourcesFor(map[string]any{}, map[string]any{}); len(sources)+len(unsupported) != 0 {
		t.Errorf("no unit selected should give nothing, got %d/%d", len(sources), len(unsupported))
	}
}
