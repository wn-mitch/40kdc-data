package wh40kdc

import (
	"encoding/json"
	"reflect"
	"testing"
)

// TestDefensiveLeversCorpus pins DefensiveLeversFor against conformance/abilities-resolver/
// defensive-levers.json: every lever (id, label, default, source, pools, requirements, buff
// contributions) and every pool, in order.
func TestDefensiveLeversCorpus(t *testing.T) {
	var corpus map[string]any
	if err := json.Unmarshal(loadCorpus(t, "abilities-resolver", "defensive-levers.json"), &corpus); err != nil {
		t.Fatal(err)
	}
	cases := getList(corpus, "cases")
	if len(cases) == 0 {
		t.Fatal("the defensive-levers corpus is empty")
	}
	ds := EmbeddedDataset()
	for _, item := range cases {
		c, _ := asMap(item)
		input, _ := getMap(c, "input")
		ctx, _ := getMap(c, "context")
		levers, groups := ds.DefensiveLeversFor(input, ctx)
		rows := make([]any, 0, len(levers))
		for _, lever := range levers {
			contributions := []any{}
			for _, buffAny := range getList(lever, "buffs") {
				buff, _ := asMap(buffAny)
				contributions = append(contributions, buff["contribution"])
			}
			rows = append(rows, map[string]any{
				"id": lever["id"], "label": lever["label"], "enabled": lever["enabled"], "source": lever["source"],
				"group": lever["group"], "groups": lever["groups"], "requires": lever["requires"], "buffs": contributions,
			})
		}
		encoded, err := json.Marshal(map[string]any{"levers": rows, "groups": groups})
		if err != nil {
			t.Fatal(err)
		}
		var got any
		if err := json.Unmarshal(encoded, &got); err != nil {
			t.Fatal(err)
		}
		if want := c["expected"]; !reflect.DeepEqual(got, want) {
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(want)
			t.Errorf("%s:\n got  %s\n want %s", getStr(c, "caseId"), gotJSON, wantJSON)
		}
	}
}

// secondaryEffectDataset is a fabricated army (no GW rule prose): one mob and a
// defensive Stratagem whose second option is its secondary effect. extraCP is the
// Stratagem's secondary_effect_extra_cp, or "" for none.
func secondaryEffectDataset(t *testing.T, extraCP string) *Dataset {
	t.Helper()
	extra := ""
	if extraCP != "" {
		extra = `, "secondary_effect_extra_cp": ` + extraCP
	}
	version := `{"edition": "11th", "dataslate": "test"}`
	woundMinus := `{"type": "roll-modifier", "target": "attacker", "modifier": {"roll": "wound", "operation": "subtract", "value": 1}}`
	doc := `{
	  "units": [{"id": "fix-mob", "name": "fix-mob", "faction_id": "orks", "profiles": [{"name": "fix-mob", "M": 6, "T": 5, "W": 1, "Sv": 5, "Ld": 7, "OC": 2}],
	    "keywords": ["Infantry", "Mob"], "faction_keywords": ["Orks"], "model_count": {"min": 1, "max": 10}, "ability_ids": [], "game_version": ` + version + `}],
	  "abilities": [{"ability_id": "fix-brace", "name": "fix-brace", "authored_by": "40kdc-community", "faction_id": "orks", "game_version": ` + version + `,
	    "ability_type": "stratagem", "behavior": "passive", "detachment_id": "fix-det", "scope": {"duration": "permanent"},
	    "effect": {"type": "choice", "secondary_option": 1, "options": [
	      {"type": "conditional", "condition": {"type": "attack-is", "parameters": {"attack_type": "melee"}}, "effect": ` + woundMinus + `}, ` + woundMinus + `]}}],
	  "detachments": [{"id": "fix-det", "name": "Fix Detachment", "faction_id": "orks", "stratagem_ids": ["fix-brace-s"], "game_version": ` + version + `}],
	  "stratagems": [{"id": "fix-brace-s", "name": "Fix Brace", "category": "detachment", "detachment_id": "fix-det", "cp_cost": 1, "phases": ["fight"],
	    "ability_id": "fix-brace", "game_version": ` + version + extra + `}]
	}`
	var parsed map[string][]any
	if err := json.Unmarshal([]byte(doc), &parsed); err != nil {
		t.Fatal(err)
	}
	raw := emptyRawData()
	for key, rows := range parsed {
		raw[key] = rows
	}
	return NewDataset(raw)
}

func secondaryEffectLevers(t *testing.T, extraCP string) map[string]map[string]any {
	t.Helper()
	input := map[string]any{"unitId": "fix-mob", "factionId": "orks", "detachmentId": "fix-det", "optedInStratagemIds": []any{"fix-brace-s"}}
	levers, _ := secondaryEffectDataset(t, extraCP).DefensiveLeversFor(input, map[string]any{"phase": "fight"})
	byID := map[string]map[string]any{}
	for _, lever := range levers {
		byID[getStr(lever, "id")] = lever
	}
	for _, id := range []string{"fix-brace?0", "fix-brace?1"} {
		if byID[id] == nil {
			t.Fatalf("lever %s missing; got %v", id, byID)
		}
	}
	return byID
}

// TestSecondaryEffectChargesExtraCP: an opted-in Stratagem's secondary option carries its extra
// CP as the lever's cost; the other option costs nothing beyond the Stratagem itself.
func TestSecondaryEffectChargesExtraCP(t *testing.T) {
	levers := secondaryEffectLevers(t, "1")
	if cost, has := levers["fix-brace?0"]["cost"]; has {
		t.Errorf("fix-brace?0 cost = %v, want none", cost)
	}
	if got := levers["fix-brace?1"]["cost"]; !reflect.DeepEqual(got, map[string]any{"cp": float64(1)}) {
		t.Errorf("fix-brace?1 cost = %v, want {cp: 1}", got)
	}
}

// TestSecondaryEffectWithoutExtraCP: a marked option of a Stratagem with no extra CP costs nothing.
func TestSecondaryEffectWithoutExtraCP(t *testing.T) {
	if cost, has := secondaryEffectLevers(t, "")["fix-brace?1"]["cost"]; has {
		t.Errorf("fix-brace?1 cost = %v, want none", cost)
	}
}

// TestChoiceMarksOnlyTheSecondaryOption: the translation flags the marked option alone, and an
// index past the options flags none.
func TestChoiceMarksOnlyTheSecondaryOption(t *testing.T) {
	ds := secondaryEffectDataset(t, "1")
	ability, ok := ds.Abilities.GetInFaction("fix-brace", "orks")
	if !ok {
		t.Fatal("fix-brace missing")
	}
	source := map[string]any{"kind": "ability", "abilityId": "fix-brace", "abilityKind": "detachment-stratagem"}
	flags := func() []any {
		out := []any{}
		for _, actAny := range ability.describeBuffs(source, map[string]any{"phase": "fight"}, "target").activatable {
			act, _ := asMap(actAny)
			out = append(out, act["secondary"])
		}
		return out
	}
	if got := flags(); !reflect.DeepEqual(got, []any{nil, true}) {
		t.Errorf("secondary flags = %v, want [nil true]", got)
	}
	effect, _ := asMap(ability.Raw["effect"])
	effect["secondary_option"] = float64(2)
	if got := flags(); !reflect.DeepEqual(got, []any{nil, nil}) {
		t.Errorf("out-of-range secondary flags = %v, want [nil nil]", got)
	}
}
