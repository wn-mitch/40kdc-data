package wh40kdc

import "testing"

// Anti targets: a slash-separated list of keywords, or a "non-" keyword, parse to target_keyword
// as printed and match a unit by the same rule the TypeScript, Python and Rust engines use.
func TestParseKeywordGrantAntiTargets(t *testing.T) {
	cases := map[string]string{
		"Anti-Monster/Vehicle 4+": "Monster/Vehicle",
		"Anti-Non-Vehicle 4+":     "Non-Vehicle",
		"Anti-INFANTRY 4+":        "INFANTRY",
	}
	for raw, target := range cases {
		ref := parseKeywordGrant(raw)
		if ref == nil || ref["keyword_id"] != "anti" {
			t.Fatalf("%q: not an anti keyword: %v", raw, ref)
		}
		params := ref["parameters"].(map[string]any)
		if params["target_keyword"] != target || params["threshold"] != float64(4) {
			t.Fatalf("%q: got %v", raw, params)
		}
	}
	if ref := parseKeywordGrant("Anti-Monster/ 4+"); ref != nil && ref["keyword_id"] == "anti" {
		t.Fatalf("empty slash alternative must not parse as anti: %v", ref)
	}
}

func TestAntiTargetMatchesAlternativesAndNegation(t *testing.T) {
	vehicle := []string{"vehicle", "walker"}
	cultist := []string{"infantry", "chaos"}
	if !antiTargetMatches("Monster/Vehicle", vehicle) {
		t.Error("Monster/Vehicle should match a VEHICLE unit")
	}
	if antiTargetMatches("Monster/Vehicle", cultist) {
		t.Error("Monster/Vehicle should not match an INFANTRY unit")
	}
	if antiTargetMatches("Non-Vehicle", vehicle) {
		t.Error("non-Vehicle should not match a VEHICLE unit")
	}
	if !antiTargetMatches("non-Vehicle", cultist) {
		t.Error("non-Vehicle should match a unit without VEHICLE")
	}
}
