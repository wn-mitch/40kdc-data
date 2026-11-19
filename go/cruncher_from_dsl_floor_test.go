package wh40kdc

import "testing"

// Breaching Command re-rolls Hit rolls of 1, or every Hit roll within 6" of a friendly ADEPTUS
// MECHANICUS BATTLELINE unit. With no board state one branch still applies, so the re-roll of 1s
// does; with the neighbour declared the full re-roll does instead.
func TestComplementaryRerollPairAppliesTheWeakerWhileUndecided(t *testing.T) {
	ds := EmbeddedDataset()
	ability, ok := ds.Abilities.GetAny("breaching-command-adeptus-mechanicus")
	if !ok {
		t.Fatal("breaching-command-adeptus-mechanicus missing from the embedded dataset")
	}
	source := map[string]any{"kind": "ability", "abilityId": "breaching-command-adeptus-mechanicus", "abilityKind": "unit"}
	subsets := func(result *effectTranslation) []string {
		var out []string
		for _, buffAny := range result.applied {
			buff, _ := asMap(buffAny)
			contribution, _ := getMap(buff, "contribution")
			out = append(out, getStr(contribution, "roll")+":"+getStr(contribution, "subset"))
		}
		return out
	}

	undecided := effectToBuffs(ability.Raw["effect"], source, map[string]any{"phase": "shooting"}, "attacker")
	if got := subsets(undecided); len(got) != 1 || got[0] != "hit:ones" {
		t.Fatalf("undecided: applied %v, want [hit:ones]", got)
	}
	const want = `conditional: cannot evaluate condition "matches" against current context; the weaker re-roll of its complementary pair applies`
	if len(undecided.unsupported) != 1 || getStr(mapOr(undecided.unsupported[0]), "reason") != want {
		t.Fatalf("undecided: unsupported %v, want one %q entry", undecided.unsupported, want)
	}

	near := effectToBuffs(ability.Raw["effect"], source, map[string]any{
		"phase": "shooting",
		"attackerNeighbours": []any{map[string]any{
			"keywords": []any{"ADEPTUS MECHANICUS", "BATTLELINE"}, "owner": "friendly", "distanceInches": 3.0,
		}},
	}, "attacker")
	if got := subsets(near); len(got) != 1 || got[0] != "hit:all-failures" {
		t.Fatalf("with neighbour: applied %v, want [hit:all-failures]", got)
	}
}
