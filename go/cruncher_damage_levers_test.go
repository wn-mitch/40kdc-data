package wh40kdc

import (
	"math"
	"reflect"
	"testing"
)

// Fabricated rules only; no GW rule prose. The goldens in conformance/ pin the contributions;
// these pin the gates the goldens do not project, and the DSL → engine path end to end. Mirrors
// tools/test/cruncher-damage-levers.test.ts.

func leverSource() map[string]any {
	return map[string]any{"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
}

func shootingCtx() map[string]any { return map[string]any{"phase": "shooting"} }

func leverStages(t *testing.T, buffs []any) map[string]float64 {
	t.Helper()
	ds := EmbeddedDataset()
	weapon, ok := ds.Weapons.GetAny("bolt-rifle")
	if !ok {
		t.Fatal("bolt-rifle missing")
	}
	unit, ok := ds.Units.GetAny("intercessor-squad")
	if !ok {
		t.Fatal("intercessor-squad missing")
	}
	stages, _, err := crunch(map[string]any{
		"attacker":     map[string]any{"weapon": weapon.Raw, "profileIndex": 0.0},
		"target":       map[string]any{"unit": unit.Raw, "profileIndex": 0.0},
		"modelsFiring": 5.0,
		"buffs":        buffs,
		"context":      shootingCtx(),
	}, ds)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]float64{}
	for _, s := range stages {
		out[s["name"].(string)] = s["expected"].(float64)
	}
	return out
}

func applicabilities(applied []any) []any {
	out := make([]any, 0, len(applied))
	for _, b := range applied {
		out = append(out, b.(map[string]any)["applicableWhen"])
	}
	return out
}

func TestLeversGateAttackerSkillPenaltiesByPhase(t *testing.T) {
	out := effectToBuffs(map[string]any{"type": "sequence", "steps": []any{
		map[string]any{"type": "stat-modifier", "target": "attacker", "modifier": map[string]any{"stat": "WS", "operation": "worsen", "value": 1.0}},
		map[string]any{"type": "stat-modifier", "target": "attacker", "modifier": map[string]any{"stat": "BS", "operation": "worsen", "value": 1.0}},
	}}, leverSource(), shootingCtx(), "target")
	want := []any{map[string]any{"phases": []any{"fight"}}, map[string]any{"phases": []any{"shooting"}}}
	if got := applicabilities(out.applied); !reflect.DeepEqual(got, want) {
		t.Fatalf("applicableWhen = %#v, want %#v", got, want)
	}
}

func TestLeversGateCritThresholdAndRerollByWeaponTypeAndName(t *testing.T) {
	out := effectToBuffs(map[string]any{"type": "sequence", "steps": []any{
		map[string]any{"type": "roll-result", "target": "this-unit", "modifier": map[string]any{"roll": "wound", "critical_on": 5.0, "weapons": map[string]any{"type": "melee"}}},
		map[string]any{"type": "re-roll", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "subset": "ones", "weapons": map[string]any{"name": "Fabricated Gun"}}},
	}}, leverSource(), shootingCtx(), "attacker")
	want := []any{map[string]any{"phases": []any{"fight"}}, map[string]any{"weaponName": "fabricated gun"}}
	if got := applicabilities(out.applied); !reflect.DeepEqual(got, want) {
		t.Fatalf("applicableWhen = %#v, want %#v", got, want)
	}
}

func TestLeversKeepPhaseAndWeaponNameGates(t *testing.T) {
	out := effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "A", "operation": "improve", "value": 1.0, "weapons": map[string]any{"type": "melee", "name": "Fabricated Blade"}}}, leverSource(), shootingCtx(), "attacker")
	want := []any{map[string]any{"phases": []any{"fight"}, "weaponName": "fabricated blade"}}
	if got := applicabilities(out.applied); !reflect.DeepEqual(got, want) {
		t.Fatalf("applicableWhen = %#v, want %#v", got, want)
	}
}

func TestLeversGateCritThresholdOnWeaponKeywordAndRefuseUnreadableOne(t *testing.T) {
	gated := effectToBuffs(map[string]any{"type": "roll-result", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "critical_on": 5.0, "weapons": map[string]any{"keyword": map[string]any{"keyword_id": "pistol"}}}}, leverSource(), shootingCtx(), "attacker")
	if len(gated.unsupported) != 0 {
		t.Fatalf("unsupported = %#v", gated.unsupported)
	}
	if got, want := applicabilities(gated.applied), []any{map[string]any{"weaponKeywords": []map[string]any{{"keyword_id": "pistol"}}}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("applicableWhen = %#v, want %#v", got, want)
	}
}

func TestLeversRefuseSkillOrSaveSetWithoutNumericValue(t *testing.T) {
	skill := effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "BS", "operation": "improve", "value": nil}}, leverSource(), shootingCtx(), "attacker")
	save := effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "Sv", "operation": "set", "value": nil}}, leverSource(), shootingCtx(), "target")
	outOfRange := effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "Sv", "operation": "set", "value": 7.0}}, leverSource(), shootingCtx(), "target")
	for name, tc := range map[string]struct {
		out  *effectTranslation
		want string
	}{
		"skill":        {skill, "stat-modifier BS: operation \"improve\" not supported"},
		"save":         {save, "stat-modifier Sv: set has no numeric value"},
		"out of range": {outOfRange, "stat-modifier Sv: set value \"7\" is not a save characteristic"},
	} {
		if len(tc.out.applied) != 0 {
			t.Fatalf("%s applied = %#v", name, tc.out.applied)
		}
		if len(tc.out.unsupported) != 1 || tc.out.unsupported[0].(map[string]any)["reason"] != tc.want {
			t.Fatalf("%s unsupported = %#v", name, tc.out.unsupported)
		}
	}
}

func TestLeversCritHitFiveWithLethalRaisesWounds(t *testing.T) {
	lethal := map[string]any{
		"source":       map[string]any{"kind": "manual", "label": "lethal"},
		"contribution": map[string]any{"type": "extra-keyword", "keywordRef": map[string]any{"keyword_id": "lethal-hits"}},
	}
	crit := effectToBuffs(map[string]any{"type": "roll-result", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "critical_on": 5.0}}, leverSource(), shootingCtx(), "attacker").applied
	// Crits on a 6 auto-wound; the other hits (3+ to 5) wound on a 5+ against T5.
	if got, want := leverStages(t, []any{lethal})["wounds"], 10*(1.0/6)+10*(3.0/6)*(1.0/3); math.Abs(got-want) > 1e-6 {
		t.Fatalf("wounds = %v, want %v", got, want)
	}
	if got, want := leverStages(t, append([]any{lethal}, crit...))["wounds"], 10*(2.0/6)+10*(2.0/6)*(1.0/3); math.Abs(got-want) > 1e-6 {
		t.Fatalf("wounds with crit 5+ = %v, want %v", got, want)
	}
}

func TestLeversWeaponNamedAttacksLiftReachesOnlyThatWeapon(t *testing.T) {
	lift := func(name string) []any {
		return effectToBuffs(map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "A", "operation": "improve", "value": 1.0, "weapons": map[string]any{"name": name}}}, leverSource(), shootingCtx(), "attacker").applied
	}
	if got := leverStages(t, lift("Bolt Rifles"))["attacks"]; got != 15 {
		t.Fatalf("named weapon attacks = %v, want 15", got)
	}
	if got := leverStages(t, lift("Fabricated Gun"))["attacks"]; got != 10 {
		t.Fatalf("other weapon attacks = %v, want 10", got)
	}
}

func TestLeversPrintedGrantToFriendlyUnitsTranslatesItsBodyForTheHolders(t *testing.T) {
	grant := func(target any) map[string]any {
		body := map[string]any{"type": "re-roll", "target": "this-unit", "modifier": map[string]any{"roll": "hit", "subset": "ones"}}
		return map[string]any{"type": "ability-grant", "target": target, "modifier": map[string]any{"ability": "fabricated-granted", "definition": body}}
	}
	friendlyCtx := shootingCtx()
	friendlyCtx["attackerKeywords"] = []any{"EXAMPLE"}
	friendly := effectToBuffs(grant(map[string]any{"owner": "friendly", "all_of": []any{"EXAMPLE"}}), leverSource(), friendlyCtx, "attacker")
	if len(friendly.applied) != 1 || len(friendly.unsupported) != 0 {
		t.Fatalf("friendly = %#v / %#v", friendly.applied, friendly.unsupported)
	}
	want := map[string]any{"type": "reroll", "roll": "hit", "subset": "ones"}
	if got := friendly.applied[0].(map[string]any)["contribution"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("friendly contribution = %#v", got)
	}
	// Holders bound to an event are not resolved; enemy holders contribute nothing.
	bound := effectToBuffs(grant("event-subject"), leverSource(), shootingCtx(), "attacker")
	if len(bound.applied) != 0 || len(bound.unsupported) != 1 || bound.unsupported[0].(map[string]any)["reason"] != "ability-grant: the units holding the granted ability are not resolved" {
		t.Fatalf("bound = %#v / %#v", bound.applied, bound.unsupported)
	}
	enemy := effectToBuffs(grant(map[string]any{"owner": "enemy", "all_of": []any{"EXAMPLE"}}), leverSource(), shootingCtx(), "attacker")
	if len(enemy.applied) != 0 || len(enemy.unsupported) != 1 ||
		enemy.unsupported[0].(map[string]any)["reason"] != "unit-filter target: identity, state or model membership is unresolved" {
		t.Fatalf("enemy = %#v / %#v", enemy.applied, enemy.unsupported)
	}
}
