package wh40kdc

import "testing"

func antiRef(params map[string]any) extraKw {
	return extraKw{keywordRef: map[string]any{"keyword_id": "anti", "parameters": params}}
}

func TestAntiWoundThresholdMatchesTargetKeywords(t *testing.T) {
	vehicle := []string{"vehicle", "walker"}
	cultist := []string{"infantry", "chaos"}
	anyOf := antiRef(map[string]any{"required_target_keywords_any": []any{"MONSTER", "VEHICLE"}, "threshold": 4.0})
	if got := antiWoundThreshold([]extraKw{anyOf}, vehicle); got != 4 {
		t.Errorf("Anti-Monster/Vehicle vs VEHICLE = %v, want 4", got)
	}
	if got := antiWoundThreshold([]extraKw{anyOf}, cultist); got != 7 {
		t.Errorf("Anti-Monster/Vehicle vs INFANTRY = %v, want 7", got)
	}
	nonVehicle := antiRef(map[string]any{"excluded_target_keywords": []any{"VEHICLE"}, "threshold": 2.0})
	if got := antiWoundThreshold([]extraKw{nonVehicle}, vehicle); got != 7 {
		t.Errorf("Anti-non-Vehicle vs VEHICLE = %v, want 7", got)
	}
	if got := antiWoundThreshold([]extraKw{nonVehicle}, cultist); got != 2 {
		t.Errorf("Anti-non-Vehicle vs INFANTRY = %v, want 2", got)
	}
	exact := antiRef(map[string]any{"target_keyword": "Infantry", "threshold": 3.0})
	if got := antiWoundThreshold([]extraKw{exact}, cultist); got != 3 {
		t.Errorf("Anti-Infantry vs INFANTRY = %v, want 3", got)
	}
}

func TestAntiWoundThresholdTakesLowestValidThreshold(t *testing.T) {
	cultist := []string{"infantry", "chaos"}
	keywords := []extraKw{
		antiRef(map[string]any{"target_keyword": "Infantry", "threshold": 4.0}),
		antiRef(map[string]any{"target_keyword": "Chaos", "threshold": 3.0}),
		antiRef(map[string]any{"target_keyword": "Chaos", "threshold": 1.0}),
		antiRef(map[string]any{"target_keyword": "Chaos", "threshold": 2.5}),
		antiRef(map[string]any{"threshold": 2.0}),
	}
	if got := antiWoundThreshold(keywords, cultist); got != 3 {
		t.Errorf("lowest valid matching threshold = %v, want 3", got)
	}
}
