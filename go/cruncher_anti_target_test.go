package wh40kdc

import "testing"

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
