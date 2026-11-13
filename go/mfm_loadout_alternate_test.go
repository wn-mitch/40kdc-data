package wh40kdc

import (
	"encoding/json"
	"testing"
)

// An alternate wargear slot that lists an empty choice: leaving the alternate
// untaken keeps the standard loadout, so a model carrying nothing is still not
// a legal loadout.
const alternateRules = `{"stock":[{"model":"Trooper","models":1,"items":[{"id":"gun","count":1}]}],"templates":[{"model":"Trooper","items":[{"id":"gun","count":1}]}],"slots":[{"model":"Trooper","picks":1,"repeats":false,"alternate":false,"choices":[[{"id":"gun","count":1}]]},{"model":"Trooper","picks":1,"repeats":false,"alternate":true,"choices":[[],[{"id":"sword","count":1}]]}],"limits":[],"uniform":[],"options":[]}`

func alternateCodes(t *testing.T, counts map[string]int) []string {
	t.Helper()
	var rules MfmLoadoutRules
	if err := json.Unmarshal([]byte(alternateRules), &rules); err != nil {
		t.Fatal(err)
	}
	var codes []string
	for _, v := range CheckMfmLoadout(&rules, map[string]int{"Trooper": 1}, counts) {
		codes = append(codes, v.Code)
	}
	return codes
}

func TestAlternateRefusesUnarmedModel(t *testing.T) {
	if got := alternateCodes(t, map[string]int{}); len(got) != 1 || got[0] != "no-assignment" {
		t.Fatalf("empty loadout: got %v, want [no-assignment]", got)
	}
}

func TestAlternateAllowsStandardOrAlternate(t *testing.T) {
	for _, counts := range []map[string]int{{"gun": 1}, {"sword": 1}} {
		if got := alternateCodes(t, counts); len(got) != 0 {
			t.Fatalf("%v: got %v, want no violations", counts, got)
		}
	}
}
