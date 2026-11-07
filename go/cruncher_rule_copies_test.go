package wh40kdc

import (
	"encoding/json"
	"reflect"
	"testing"
)

// A Blood Angels army declares its own copy of Combat Doctrines; Mission
// Tactics names the Space Marine one. Mirrors
// tools/test/cruncher-named-grants.test.ts.
func TestChapterArmyFollowsItsOwnCombatDoctrines(t *testing.T) {
	ds := EmbeddedDataset()
	input := map[string]any{"unitId": "deathwatch-veterans", "factionId": "blood-angels", "detachmentId": "deathwatch-support"}
	sustained := map[string]any{"type": "extra-keyword", "keywordRef": map[string]any{"keyword_id": "sustained-hits", "parameters": map[string]any{"value": float64(1)}}}
	tactics := func(option string) []any {
		ctx := map[string]any{"phase": "shooting", "activeRules": []any{map[string]any{"ability_id": "combat-doctrines-blood-angels", "option_id": option}}}
		var out []any
		for _, buff := range ds.buffsFor(input, ctx) {
			record, _ := asMap(buff)
			source, _ := getMap(record, "source")
			if getStr(source, "kind") == "ability" && getStr(source, "abilityId") == "mission-tactics-deathwatch-support-deathwatch" {
				out = append(out, asPlainJSON(record["contribution"]))
			}
		}
		return out
	}
	if got := tactics("devastator-doctrine"); !reflect.DeepEqual(got, []any{sustained}) {
		t.Fatalf("devastator doctrine: got %#v", got)
	}
	if got := tactics("assault-doctrine"); len(got) != 0 {
		t.Fatalf("assault doctrine: got %#v", got)
	}
}

// asPlainJSON round-trips value through JSON so typed numbers compare as float64.
func asPlainJSON(value any) any {
	encoded, _ := json.Marshal(value)
	var out any
	_ = json.Unmarshal(encoded, &out)
	return out
}
