package wh40kdc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// TestCruncherCorpus runs every conformance/cruncher case through the runner's
// crunch op, mirroring the TS "cruncher conformance corpus" suite (5e-4 tolerance).
func TestCruncherCorpus(t *testing.T) {
	dir := filepath.Join(corpusDir, "cruncher")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Skipf("conformance corpus not available: %v", err)
	}
	names := []string{}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		t.Fatal("cruncher corpus is empty")
	}
	state := NewRunnerState()
	if r := state.Dispatch(map[string]any{"op": "init", "args": map[string]any{
		"spec_version": float64(SpecVersion), "locale": "C", "tz": "UTC", "seed": 0.0,
	}}); r["ok"] != true {
		t.Fatalf("init: %v", r)
	}
	for _, name := range names {
		var c map[string]any
		if err := json.Unmarshal(loadCorpus(t, "cruncher", name), &c); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		args := map[string]any{}
		for _, key := range []string{"attacker", "modelsFiring", "target", "context", "buffs"} {
			if v, ok := c[key]; ok {
				args[key] = v
			}
		}
		resp := state.Dispatch(map[string]any{"op": "crunch", "args": args})
		if resp["ok"] != true {
			t.Errorf("%s: %v", name, resp)
			continue
		}
		actual := map[string]float64{}
		for _, raw := range resp["value"].(map[string]any)["stages"].([]any) {
			stage := raw.(map[string]any)
			actual[stage["name"].(string)], _ = num(stage["expected"])
		}
		expected := c["expected"].(map[string]any)["stages"].(map[string]any)
		for stage, want := range expected {
			got, ok := actual[stage]
			if !ok {
				t.Errorf("%s: stage %s missing", name, stage)
				continue
			}
			near(t, name+" "+stage, got, want.(float64), 5e-4)
		}
	}
}

func comparisonGate(left, right map[string]any, comparison string) map[string]any {
	return map[string]any{"attackComparisons": []any{map[string]any{"left": left, "comparison": comparison, "right": right}}}
}

func TestAttackComparisonNeedsBothSidesKnown(t *testing.T) {
	sGtT := comparisonGate(map[string]any{"of": "attacker", "stat": "S"}, map[string]any{"of": "defender", "stat": "T"}, "gt")
	if attackComparisonsHold(sGtT, map[string]any{"attackStrength": 5.0}) {
		t.Error("an unknown target Toughness must not establish S > T")
	}
	if !attackComparisonsHold(sGtT, map[string]any{"attackStrength": 5.0, "targetToughness": 4.0}) {
		t.Error("5 > 4 must hold")
	}
	if attackComparisonsHold(sGtT, map[string]any{"attackStrength": 4.0, "targetToughness": 4.0}) {
		t.Error("4 > 4 must not hold")
	}
	maxT := comparisonGate(map[string]any{"of": "attacker", "stat": "S"}, map[string]any{"of": "defender", "stat": "T", "reduce": "max"}, "gte")
	ctx := map[string]any{"attackStrength": 5.0, "targetToughness": 4.0, "targetToughnessMax": 6.0}
	if attackComparisonsHold(maxT, ctx) {
		t.Error("reduce max must read targetToughnessMax, not the attacked profile")
	}
	literal := comparisonGate(map[string]any{"of": "attacker", "stat": "S"}, map[string]any{"value": 5.0}, "eq")
	if !attackComparisonsHold(literal, ctx) {
		t.Error("S == 5 must hold for S 5")
	}
}

func TestAttackCompareParsesOnlyEngineSuppliedOperands(t *testing.T) {
	parse := func(left, right map[string]any) any {
		return conditionToApplicability(map[string]any{"type": "attack-compare", "parameters": map[string]any{
			"left": left, "comparison": "lt", "right": right,
		}}, "attacker")
	}
	T := map[string]any{"of": "defender", "stat": "T"}
	if got := parse(map[string]any{"of": "attacker", "stat": "S"}, T); got == "context" {
		t.Error("attacker S against defender T must gate")
	}
	for _, unsupported := range []map[string]any{
		{"of": "attacker", "stat": "S", "reduce": "max"},
		{"of": "attacker", "stat": "T", "reduce": "min"},
		{"of": "defender", "stat": "S"},
		{"value": 4.0},
	} {
		if got := parse(unsupported, T); got != "context" {
			t.Errorf("left %v must stay context, got %v", unsupported, got)
		}
	}
}

func TestSplitAttackScopedEvaluatesTheUnitPredicates(t *testing.T) {
	effect := map[string]any{
		"type": "conditional",
		"condition": map[string]any{"operator": "and", "operands": []any{
			map[string]any{"type": "attack-compare", "parameters": map[string]any{
				"left": map[string]any{"of": "attacker", "stat": "S"}, "comparison": "lt", "right": map[string]any{"of": "defender", "stat": "T"},
			}},
			map[string]any{"operator": "and", "operands": []any{
				map[string]any{"type": "rule-active", "parameters": map[string]any{"rule": "fabricated-rule"}},
			}},
		}},
		"effect": map[string]any{"type": "stat-modifier", "target": "this-unit", "modifier": map[string]any{"stat": "S", "operation": "add", "value": 1.0}},
	}
	source := map[string]any{"kind": "ability", "abilityId": "fabricated", "abilityKind": "unit"}
	on := effectToBuffs(effect, source, map[string]any{"activeRules": []any{"fabricated-rule"}}, "attacker")
	if len(on.applied) != 1 {
		t.Fatalf("active rule: applied %v, unsupported %v", on.applied, on.unsupported)
	}
	gate, _ := getMap(on.applied[0].(map[string]any), "applicableWhen")
	if len(anyList(gate["attackComparisons"])) != 1 {
		t.Errorf("the applied buff must carry the S < T gate, got %v", gate)
	}
	off := effectToBuffs(effect, source, map[string]any{"activeRules": []any{}}, "attacker")
	if len(off.applied) != 0 || len(off.unsupported) != 0 {
		t.Errorf("inactive rule must drop the effect, got %v / %v", off.applied, off.unsupported)
	}
	unknown := effectToBuffs(effect, source, map[string]any{}, "attacker")
	if len(unknown.applied) != 0 || len(unknown.unsupported) != 1 {
		t.Errorf("undeclared rules must leave the `and` unsupported, got %v / %v", unknown.applied, unknown.unsupported)
	}
}

func TestRuleActiveMatchesOptionsExactly(t *testing.T) {
	ctx := map[string]any{"activeRules": []any{"plain", map[string]any{"ability_id": "menu", "option_id": "a"}}}
	cases := []struct {
		rule any
		want any
	}{
		{"plain", true},
		{"menu", true},
		{"missing", false},
		{map[string]any{"ability_id": "menu", "option_id": "a"}, true},
		{map[string]any{"ability_id": "menu", "option_id": "b"}, false},
		{map[string]any{"ability_id": "menu", "definition_id": "a"}, false},
		{map[string]any{"ability_id": "menu"}, nil},
	}
	for _, c := range cases {
		if got := evaluateRuleActive(map[string]any{"rule": c.rule}, ctx); got != c.want {
			t.Errorf("rule %v: got %v, want %v", c.rule, got, c.want)
		}
	}
	if got := evaluateRuleActive(map[string]any{"rule": "plain"}, map[string]any{}); got != nil {
		t.Errorf("undeclared active rules must be unknown, got %v", got)
	}
}

func TestInRegionReadsTerritoryFromTheAbilitySide(t *testing.T) {
	ctx := map[string]any{"targetRegions": []any{map[string]any{"territory": "attacker"}, map[string]any{"terrainArea": true, "wholly": false}}}
	your := map[string]any{"region": map[string]any{"territory": "your-territory"}}
	if got := evaluateInRegion(your, ctx, "target", "attacker"); got != true {
		t.Errorf("the attacker's ability: the target is in the attacker's territory, got %v", got)
	}
	if got := evaluateInRegion(your, ctx, "target", "target"); got != false {
		t.Errorf("the target's ability: the target is not in its own territory, got %v", got)
	}
	whollyTerrain := map[string]any{"region": map[string]any{"terrain_area": map[string]any{}}, "models": "every"}
	if got := evaluateInRegion(whollyTerrain, ctx, "target", "target"); got != false {
		t.Errorf("every model needs a wholly entry, got %v", got)
	}
	designated := map[string]any{"region": map[string]any{"terrain_area": map[string]any{"designated": "x"}}}
	if got := evaluateInRegion(designated, ctx, "target", "target"); got != nil {
		t.Errorf("designated terrain must be unknown, got %v", got)
	}
}

func TestControlsComparesFromTheAbilitySide(t *testing.T) {
	ctx := map[string]any{"objectivesControlled": map[string]any{"attacker": 2.0, "target": 3.0, "total": 5.0}}
	more := map[string]any{"compare": map[string]any{"owner": "enemy", "comparison": "gt"}}
	if got := evaluateControls(more, ctx, "attacker"); got != false {
		t.Errorf("attacker 2 > target 3 must be false, got %v", got)
	}
	if got := evaluateControls(more, ctx, "target"); got != true {
		t.Errorf("target 3 > attacker 2 must be true, got %v", got)
	}
	half := map[string]any{"proportion": map[string]any{"fraction": 0.5, "comparison": "gte"}, "count": map[string]any{"min": 3.0}}
	if got := evaluateControls(half, ctx, "target"); got != true {
		t.Errorf("3/5 >= 0.5 and 3 >= 3 must hold, got %v", got)
	}
	if got := evaluateControls(half, ctx, "attacker"); got != false {
		t.Errorf("2/5 >= 0.5 must fail, got %v", got)
	}
	if got := evaluateControls(map[string]any{"objective": map[string]any{}}, ctx, "attacker"); got != nil {
		t.Errorf("an objective filter must be unknown, got %v", got)
	}
	if got := evaluateControls(map[string]any{}, map[string]any{"objectivesControlled": map[string]any{"attacker": 0.0, "target": 1.0, "total": 1.0}}, "attacker"); got != false {
		t.Errorf("bare controls needs one objective, got %v", got)
	}
}

func TestAttachmentMembersSettleRolesAndWith(t *testing.T) {
	members := []any{
		map[string]any{"unitId": "boss", "role": "leader", "keywords": []any{"CHARACTER", "PSYKER"}},
		map[string]any{"unitId": "squad", "role": "bodyguard", "keywords": []any{"INFANTRY"}},
	}
	ctx := map[string]any{"attackerUnitId": "squad", "attackerMembers": members}
	led := map[string]any{"role": "led", "with": map[string]any{"all_of": []any{"PSYKER"}}}
	if got := evaluateAttachment(led, ctx, "attacker", nil); got != true {
		t.Errorf("the squad is led by a PSYKER, got %v", got)
	}
	ledByOther := map[string]any{"role": "led", "with": map[string]any{"all_of": []any{"VEHICLE"}}}
	if got := evaluateAttachment(ledByOther, ctx, "attacker", nil); got != false {
		t.Errorf("no VEHICLE leader, got %v", got)
	}
	if got := evaluateAttachment(map[string]any{"role": "leading"}, ctx, "attacker", nil); got != false {
		t.Errorf("a bodyguard does not lead, got %v", got)
	}
	leaderSource := map[string]any{"kind": "ability", "abilityKind": "attached", "sourceUnitId": "boss"}
	if got := evaluateAttachment(map[string]any{"role": "leading"}, ctx, "attacker", leaderSource); got != true {
		t.Errorf("the attached leader leads, got %v", got)
	}
	enemy := map[string]any{"role": "attached", "with": map[string]any{"owner": "enemy"}}
	if got := evaluateAttachment(enemy, ctx, "attacker", nil); got != false {
		t.Errorf("an enemy unit is never attached, got %v", got)
	}
	withoutMembers := map[string]any{"attackerUnitId": "squad", "attackerAttachmentRole": "bodyguard"}
	if got := evaluateAttachment(led, withoutMembers, "attacker", nil); got != nil {
		t.Errorf("`with` without members must be unknown, got %v", got)
	}
	if got := evaluateAttachment(map[string]any{"role": "led"}, withoutMembers, "attacker", nil); got != true {
		t.Errorf("a bodyguard flag is led, got %v", got)
	}
}

func TestWithinNeighbourFlipsOwnerAcrossSides(t *testing.T) {
	filter := map[string]any{"within": map[string]any{
		"of":    map[string]any{"owner": "friendly", "all_of": []any{"VEHICLE"}},
		"range": map[string]any{"inches": 6.0},
	}}
	ctx := map[string]any{"targetNeighbours": []any{
		map[string]any{"keywords": []any{"VEHICLE"}, "owner": "friendly", "distanceInches": 4.0},
	}}
	// The target's own ability: its friendly VEHICLE is within 6".
	if got := matchesUnitFilter(filter, ctx, "target", "friendly"); got != true {
		t.Errorf("same side: got %v", got)
	}
	// The attacker's ability: the target's friendly neighbour is the attacker's enemy.
	if got := matchesUnitFilter(filter, ctx, "target", "enemy"); got != false {
		t.Errorf("other side: got %v", got)
	}
	far := map[string]any{"within": map[string]any{"of": map[string]any{"all_of": []any{"VEHICLE"}}, "range": map[string]any{"inches": 3.0}}}
	if got := matchesUnitFilter(far, ctx, "target", "friendly"); got != false {
		t.Errorf("4\" is beyond 3\": got %v", got)
	}
	if got := matchesUnitFilter(filter, map[string]any{}, "target", "friendly"); got != nil {
		t.Errorf("undeclared neighbours must be unknown, got %v", got)
	}
}
