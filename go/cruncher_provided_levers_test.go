package wh40kdc

import (
	"reflect"
	"testing"
)

// Levers a unit gets from selections, other units' abilities, caps and
// weapon-keyword gates. Mirrors tools/test/cruncher-provided-levers.test.ts.
// Fabricated rules only; no GW rule prose.

func ownSource() map[string]any {
	return map[string]any{"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
}

func providedSource() map[string]any {
	return map[string]any{"kind": "ability", "abilityId": "fabricated", "abilityKind": "support", "sourceUnitId": "fabricated-lord"}
}

func fightKeyed() map[string]any {
	return map[string]any{"phase": "fight", "attackerKeywords": []any{"infantry", "destroyer cult"}}
}

func shootingKeyed() map[string]any {
	return map[string]any{"phase": "shooting", "attackerKeywords": []any{"infantry"}}
}

func friendlySelection(keywords ...any) map[string]any {
	notThisUnit := map[string]any{"operator": "not", "operands": []any{map[string]any{"type": "same-unit", "parameters": map[string]any{"as": "ability-unit"}}}}
	within9 := map[string]any{"type": "within", "parameters": map[string]any{"subject": "selected-unit", "of": "this-model", "range": map[string]any{"inches": 9.0}}}
	return map[string]any{
		"type":     "select-units",
		"selector": map[string]any{"filter": map[string]any{"owner": "friendly", "all_of": keywords}, "count": map[string]any{"min": 1.0, "max": 1.0}, "eligibility": map[string]any{"operator": "and", "operands": []any{notThisUnit, within9}}},
		"effect":   map[string]any{"type": "re-roll", "target": "selected-unit", "modifier": map[string]any{"roll": "wound", "subset": "ones"}},
	}
}

func reasonsOf(out *effectTranslation) []any {
	reasons := []any{}
	for _, u := range out.unsupported {
		reasons = append(reasons, u.(map[string]any)["reason"])
	}
	return reasons
}

func contributionsOf(buffs []any) []any {
	out := []any{}
	for _, b := range buffs {
		out = append(out, b.(map[string]any)["contribution"])
	}
	return out
}

func TestFriendlySelectionAnotherUnitProvidesIsOneLeverRequiringTheSelection(t *testing.T) {
	out := effectToBuffs(friendlySelection("DESTROYER CULT"), providedSource(), fightKeyed(), "attacker")
	if len(out.applied) != 0 || len(out.unsupported) != 0 || len(out.activatable) != 1 {
		t.Fatalf("translation = %#v", out)
	}
	lever := out.activatable[0].(map[string]any)
	if lever["id"] != "fabricated#selected" {
		t.Fatalf("id = %v", lever["id"])
	}
	if got, want := contributionsOf(getList(lever, "buffs")), []any{map[string]any{"type": "reroll", "roll": "wound", "subset": "ones"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("buffs = %#v", got)
	}
	selection := friendlySelection("DESTROYER CULT")
	delete(selection, "effect")
	if !reflect.DeepEqual(lever["requires"], []any{selection}) {
		t.Fatalf("requires = %#v", lever["requires"])
	}
}

func TestUnitHoldingTheAbilityGetsNothingWhenTheSelectionExcludesItsOwnUnit(t *testing.T) {
	out := effectToBuffs(friendlySelection("DESTROYER CULT"), ownSource(), fightKeyed(), "attacker")
	if len(out.applied)+len(out.unsupported)+len(out.activatable) != 0 {
		t.Fatalf("translation = %#v", out)
	}
}

func TestUnitWithoutSelectorKeywordsGetsNothingAndUnknownKeywordsRefuse(t *testing.T) {
	if out := effectToBuffs(friendlySelection("NOBZ"), providedSource(), fightKeyed(), "attacker"); len(out.activatable) != 0 {
		t.Fatalf("activatable = %#v", out.activatable)
	}
	unknown := effectToBuffs(friendlySelection("DESTROYER CULT"), providedSource(), map[string]any{"phase": "fight"}, "attacker")
	if len(unknown.activatable) != 0 {
		t.Fatalf("activatable = %#v", unknown.activatable)
	}
	if got, want := reasonsOf(unknown), []any{"select-units: the crunched unit's keywords are unavailable for the selector"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reasons = %#v", got)
	}
}

func contributionTypes(buffs []any) []any {
	out := []any{}
	for _, c := range contributionsOf(buffs) {
		out = append(out, c.(map[string]any)["type"])
	}
	return out
}

func TestProviderOwnUnitEffectsNeverApplyToTheCrunchedUnit(t *testing.T) {
	effect := map[string]any{"type": "sequence", "steps": []any{
		map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "A", "operation": "add", "value": 1.0}},
		map[string]any{"type": "roll-modifier", "target": map[string]any{"owner": "friendly", "all_of": []any{"INFANTRY"}}, "modifier": map[string]any{"roll": "hit", "operation": "add", "value": 1.0}},
	}}
	if got := contributionTypes(effectToBuffs(effect, ownSource(), shootingKeyed(), "attacker").applied); !reflect.DeepEqual(got, []any{"attacks-mod", "hit-mod"}) {
		t.Fatalf("own = %#v", got)
	}
	if got := contributionTypes(effectToBuffs(effect, providedSource(), shootingKeyed(), "attacker").applied); !reflect.DeepEqual(got, []any{"hit-mod"}) {
		t.Fatalf("provided = %#v", got)
	}
}

func TestFriendlyFilterAppliesOnlyWithItsKeywordsAndRefusesUnknownKeywords(t *testing.T) {
	effect := map[string]any{"type": "roll-modifier", "target": map[string]any{"owner": "friendly", "all_of": []any{"BLOOD LEGIONS"}}, "modifier": map[string]any{"roll": "hit", "operation": "add", "value": 1.0}}
	if n := len(effectToBuffs(effect, providedSource(), shootingKeyed(), "attacker").applied); n != 0 {
		t.Fatalf("without keyword: %d applied", n)
	}
	if n := len(effectToBuffs(effect, providedSource(), map[string]any{"phase": "shooting", "attackerKeywords": []any{"blood legions"}}, "attacker").applied); n != 1 {
		t.Fatalf("with keyword: %d applied", n)
	}
	unknown := effectToBuffs(effect, providedSource(), map[string]any{"phase": "shooting"}, "attacker")
	if len(unknown.applied) != 0 || len(unknown.unsupported) != 1 ||
		unknown.unsupported[0].(map[string]any)["reason"] != "unit-filter target: identity, state or model membership is unresolved" {
		t.Fatalf("unknown keywords = %#v", unknown)
	}
}

func TestCappedScalingIsALeverAtItsCapAndUncappedIsRefused(t *testing.T) {
	scaling := map[string]any{"per": 1.0, "of": "models-embarked-in-bearer", "max_value": 22.0}
	capped := effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "A", "operation": "improve", "value": 2.0, "weapons": map[string]any{"name": "fabricated claws"}}, "scaling": scaling}, ownSource(), fightKeyed(), "attacker")
	if len(capped.applied) != 0 || len(capped.activatable) != 1 {
		t.Fatalf("capped = %#v", capped)
	}
	lever := capped.activatable[0].(map[string]any)
	if !reflect.DeepEqual(lever["requires"], []any{scaling}) {
		t.Fatalf("requires = %#v", lever["requires"])
	}
	buff := getList(lever, "buffs")[0].(map[string]any)
	if !reflect.DeepEqual(buff["contribution"], map[string]any{"type": "attacks-mod", "value": 22.0}) || !reflect.DeepEqual(buff["applicableWhen"], map[string]any{"weaponName": "fabricated claws"}) {
		t.Fatalf("buff = %#v", buff)
	}
	uncapped := cloneMap(scaling)
	delete(uncapped, "max_value")
	refused := effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "A", "operation": "improve", "value": 2.0}, "scaling": uncapped}, ownSource(), fightKeyed(), "attacker")
	if len(refused.activatable) != 0 {
		t.Fatalf("activatable = %#v", refused.activatable)
	}
	if got, want := reasonsOf(refused), []any{"stat-modifier: the value scales with models-embarked-in-bearer; not resolved by the buff engine"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("reasons = %#v", got)
	}
}

func TestAddedSelectionToOwnAbilityIsACapRaiseWithNoBuffs(t *testing.T) {
	modifier := map[string]any{
		"type":   "stance-selection-capacity",
		"target": "this-unit",
		"modifier": map[string]any{
			"ability_id":            "fabricated-augments",
			"additional_selections": 1.0,
			"allocation":            "choose-one-option",
			"options": []any{
				map[string]any{"ability_id": "fabricated-augments", "option_id": "alpha"},
				map[string]any{"ability_id": "fabricated-augments", "option_id": "beta"},
			},
		},
	}
	out := effectToBuffs(modifier, ownSource(), shootingKeyed(), "attacker")
	if len(out.unsupported) != 0 {
		t.Fatalf("unsupported = %#v", out.unsupported)
	}
	want := []any{map[string]any{"id": "fabricated#cap", "label": "1 more fabricated-augments selections", "buffs": []any{}, "capRaise": map[string]any{"ability": "fabricated-augments", "by": 1.0, "allocation": "choose-one-option", "options": []any{
		map[string]any{"ability_id": "fabricated-augments", "option_id": "alpha"},
		map[string]any{"ability_id": "fabricated-augments", "option_id": "beta"},
	}}}}
	if !reflect.DeepEqual(out.activatable, want) {
		t.Fatalf("activatable = %#v", out.activatable)
	}
}

func rapidFireBehindLethalHits() any {
	return effectToBuffs(map[string]any{"type": "weapon-ability-grant", "target": "this-unit", "modifier": map[string]any{"keywords": []any{map[string]any{"keyword_id": "rapid-fire", "parameters": map[string]any{"value": 1}}}, "weapons": map[string]any{"type": "ranged", "keyword": map[string]any{"keyword_id": "lethal-hits"}}}}, ownSource(), shootingKeyed(), "attacker").applied[0]
}

func grantedKeywordIDs(buffs []any, printed []any) []any {
	out := []any{}
	for _, k := range resolveBuffs(buffs, map[string]any{"phase": "shooting", "weaponKeywords": printed}).extraKeywords {
		out = append(out, k.keywordRef["keyword_id"])
	}
	return out
}

func TestWeaponKeywordGateReadsPrintedOrGrantedKeywordsAndNoOther(t *testing.T) {
	rapidFire := rapidFireBehindLethalHits()
	lethal := map[string]any{"source": ownSource(), "contribution": map[string]any{"type": "extra-keyword", "keywordRef": map[string]any{"keyword_id": "lethal-hits"}}}
	if got, want := rapidFire.(map[string]any)["applicableWhen"], map[string]any{"phases": []any{"shooting"}, "weaponKeywords": []map[string]any{{"keyword_id": "lethal-hits"}}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("applicableWhen = %#v", got)
	}
	if got := grantedKeywordIDs([]any{rapidFire}, []any{"lethal-hits"}); !reflect.DeepEqual(got, []any{"rapid-fire"}) {
		t.Fatalf("printed = %#v", got)
	}
	if got := grantedKeywordIDs([]any{rapidFire}, []any{"heavy"}); len(got) != 0 {
		t.Fatalf("absent = %#v", got)
	}
	if got := grantedKeywordIDs([]any{rapidFire, lethal}, []any{"heavy"}); !reflect.DeepEqual(got, []any{"rapid-fire", "lethal-hits"}) {
		t.Fatalf("granted = %#v", got)
	}
}

func TestWeaponKeywordGateIsPermissiveWithoutTheWeaponsKeywords(t *testing.T) {
	if n := len(resolveBuffs([]any{rapidFireBehindLethalHits()}, map[string]any{"phase": "shooting"}).extraKeywords); n != 1 {
		t.Fatalf("extra keywords = %d", n)
	}
}

func TestStructuredWeaponKeywordApplicabilityKeepsRatingsAndExclusions(t *testing.T) {
	antiFour := map[string]any{"keyword_id": "anti", "parameters": map[string]any{"target_keyword": "MONSTER", "threshold": 4.0}}
	antiFive := map[string]any{"keyword_id": "anti", "parameters": map[string]any{"target_keyword": "MONSTER", "threshold": 5.0}}
	buff := map[string]any{
		"source": ownSource(),
		"applicableWhen": map[string]any{
			"weaponKeywords": []map[string]any{antiFour},
		},
		"contribution": map[string]any{"type": "extra-keyword", "keywordRef": map[string]any{"keyword_id": "fabricated"}},
	}
	if got := len(resolveBuffs([]any{buff}, map[string]any{"weaponKeywordRefs": []map[string]any{antiFour}}).extraKeywords); got != 1 {
		t.Fatalf("matching rating = %d, want 1", got)
	}
	if got := len(resolveBuffs([]any{buff}, map[string]any{"weaponKeywordRefs": []map[string]any{antiFive}}).extraKeywords); got != 0 {
		t.Fatalf("different rating = %d, want 0", got)
	}
	buff["applicableWhen"] = map[string]any{
		"excludedWeaponKeywords": []map[string]any{antiFour},
	}
	if got := len(resolveBuffs([]any{buff}, map[string]any{"weaponKeywordRefs": []map[string]any{antiFour}}).extraKeywords); got != 0 {
		t.Fatalf("excluded rating = %d, want 0", got)
	}
	if got := len(resolveBuffs([]any{buff}, map[string]any{"weaponKeywordRefs": []map[string]any{antiFive}}).extraKeywords); got != 1 {
		t.Fatalf("nonmatching excluded rating = %d, want 1", got)
	}
}

func TestExplicitRangeGateRejectsUnknownDistance(t *testing.T) {
	buff := map[string]any{"applicableWhen": map[string]any{"maxRangeInches": 6.0}, "contribution": map[string]any{"type": "extra-keyword", "keywordRef": map[string]any{"keyword_id": "fabricated"}}}
	for _, tc := range []struct {
		name string
		ctx  map[string]any
		want bool
	}{
		{"absent", map[string]any{}, false},
		{"zero", map[string]any{"distanceInches": 0.0}, true},
		{"inside", map[string]any{"distanceInches": 5.99}, true},
		{"boundary", map[string]any{"distanceInches": 6.0}, true},
		{"outside", map[string]any{"distanceInches": 6.01}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := buffApplies(buff, tc.ctx); got != tc.want {
				t.Fatalf("buffApplies = %v, want %v", got, tc.want)
			}
		})
	}
	ungated := map[string]any{"contribution": buff["contribution"]}
	if !buffApplies(ungated, map[string]any{}) {
		t.Fatal("ungated buff rejected absent distance")
	}
}
