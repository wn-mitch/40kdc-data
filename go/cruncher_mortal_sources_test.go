package wh40kdc

import (
	"reflect"
	"testing"
)

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

func TestWithinChoiceLimitsKeepsAChoiceToItsLimit(t *testing.T) {
	charge := map[string]any{"event": "move-ended", "filter": map[string]any{"move_types": []any{"charge"}}}
	selectEnemy := func(count float64) any {
		return map[string]any{
			"type":     "select-units",
			"selector": map[string]any{"filter": map[string]any{"owner": "enemy"}, "count": map[string]any{"min": 1.0, "max": 1.0}},
			"effect":   map[string]any{"type": "mortal-wounds", "target": "selected-unit", "modifier": map[string]any{"count": count}},
		}
	}
	ids := func(sources []*MortalWoundSource) []string {
		out := []string{}
		for _, source := range sources {
			out = append(out, source.ID)
		}
		return out
	}
	one := mortalWoundSources("x", map[string]any{"type": "choice", "options": []any{selectEnemy(1), selectEnemy(2)}}, charge, map[string]any{"phase": "shooting"}, nil).Sources
	if got := ids(withinChoiceLimits(one)); !reflect.DeepEqual(got, []string{"x?0"}) {
		t.Errorf("choose one = %v", got)
	}
	if got := ids(withinChoiceLimits([]*MortalWoundSource{one[1], one[0]})); !reflect.DeepEqual(got, []string{"x?1"}) {
		t.Errorf("choose one, reversed = %v", got)
	}
	two := mortalWoundSources("x", map[string]any{"type": "choice", "max_choices": 2.0, "options": []any{selectEnemy(1), selectEnemy(2)}}, charge, map[string]any{"phase": "shooting"}, nil).Sources
	if got := ids(withinChoiceLimits(two)); !reflect.DeepEqual(got, []string{"x?0", "x?1"}) {
		t.Errorf("choose two = %v", got)
	}
}
