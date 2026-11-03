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
