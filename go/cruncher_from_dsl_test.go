package wh40kdc

import (
	"reflect"
	"strings"
	"testing"
)

func namedRegionEffect(keywords []any, operator string, defaultEffect map[string]any) map[string]any {
	if defaultEffect == nil {
		defaultEffect = map[string]any{
			"type":   "re-roll",
			"target": "attacker",
			"modifier": map[string]any{
				"roll":   "hit",
				"subset": "ones",
			},
		}
	}
	filter := map[string]any{"owner": "friendly"}
	if operator == "or" {
		filter["any_of"] = keywords
	} else {
		filter["all_of"] = keywords
	}
	return map[string]any{
		"type": "named-region-state",
		"modifier": map[string]any{
			"consumer": map[string]any{
				"beneficiary_filter": filter,
				"default_branch":     map[string]any{"effect": defaultEffect},
				"qualified_branch": map[string]any{
					"effect": map[string]any{
						"type":   "re-roll",
						"target": "attacker",
						"modifier": map[string]any{
							"roll":         "hit",
							"result_scope": "any-result",
						},
					},
				},
			},
		},
	}
}

func namedRegionSource() map[string]any {
	return map[string]any{"kind": "ability", "abilityId": "named-region-test", "abilityKind": "unit"}
}

func TestNamedRegionMatchingOrAppliesDefault(t *testing.T) {
	out := effectToBuffs(
		namedRegionEffect([]any{"CRYPTEK", "CANOPTEK"}, "or", nil),
		namedRegionSource(),
		map[string]any{"phase": "shooting", "attackerKeywords": []any{"canoptek"}},
		"attacker",
	)
	if len(out.applied) != 1 {
		t.Fatalf("applied = %#v", out.applied)
	}
	if len(out.unsupported) != 1 || !strings.Contains(out.unsupported[0].(map[string]any)["reason"].(string), "qualified replacement") {
		t.Fatalf("unsupported = %#v", out.unsupported)
	}
}

func TestNamedRegionNonmatchingGateAppliesNeither(t *testing.T) {
	out := effectToBuffs(
		namedRegionEffect([]any{"CRYPTEK", "CANOPTEK"}, "or", nil),
		namedRegionSource(),
		map[string]any{"phase": "shooting", "attackerKeywords": []any{"WARRIOR"}},
		"attacker",
	)
	if len(out.applied) != 0 || len(out.unsupported) != 0 {
		t.Fatalf("translation = %#v", out)
	}
}

func TestNamedRegionQualifiedBranchIsUnsupported(t *testing.T) {
	out := effectToBuffs(
		namedRegionEffect([]any{"CRYPTEK"}, "or", nil),
		namedRegionSource(),
		map[string]any{"phase": "shooting", "attackerKeywords": []any{"CRYPTEK"}},
		"attacker",
	)
	found := false
	for _, raw := range out.unsupported {
		if strings.Contains(raw.(map[string]any)["reason"].(string), "qualified replacement") {
			found = true
		}
	}
	if !found {
		t.Fatalf("unsupported = %#v", out.unsupported)
	}
}

func TestNamedRegionRerollGatesOnTheWeaponKeywordItNames(t *testing.T) {
	out := effectToBuffs(
		namedRegionEffect([]any{"THOUSAND SONS"}, "and", map[string]any{
			"type":   "re-roll",
			"target": "attacker",
			"modifier": map[string]any{
				"roll":    "wound",
				"subset":  "ones",
				"weapons": map[string]any{"keyword": map[string]any{"keyword_id": "psychic"}},
			},
		}),
		namedRegionSource(),
		map[string]any{"phase": "shooting", "attackerKeywords": []any{"thousand sons"}},
		"attacker",
	)
	for _, raw := range out.unsupported {
		if strings.Contains(raw.(map[string]any)["reason"].(string), "weaponKeywords") {
			t.Fatalf("unsupported = %#v", out.unsupported)
		}
	}
	var gates []any
	for _, raw := range out.applied {
		when, _ := raw.(map[string]any)["applicableWhen"].(map[string]any)
		gates = append(gates, when["weaponKeywords"])
	}
	if !reflect.DeepEqual(gates, []any{[]map[string]any{{"keyword_id": "psychic"}}}) {
		t.Fatalf("weaponKeywords gates = %#v", gates)
	}
}

func TestRulesBundleWalksEveryEffectStep(t *testing.T) {
	effect := map[string]any{
		"type": "rules-bundle",
		"steps": []any{
			map[string]any{
				"type":     "re-roll",
				"target":   "this-unit",
				"modifier": map[string]any{"roll": "hit", "subset": "ones"},
			},
			map[string]any{
				"type":     "re-roll",
				"target":   "this-unit",
				"modifier": map[string]any{"roll": "wound", "subset": "ones"},
			},
		},
	}
	out := effectToBuffs(
		effect,
		namedRegionSource(),
		map[string]any{"phase": "shooting"},
		"attacker",
	)
	if len(out.applied) != 2 || len(out.unsupported) != 0 {
		t.Fatalf("translation = %#v", out)
	}
}

func TestBlastZeroPreservesZeroExtraAttacks(t *testing.T) {
	ds := EmbeddedDataset()
	target, ok := ds.Units.GetInFaction("cultist-mob", "chaos-space-marines")
	if !ok {
		t.Fatal("cultist-mob missing")
	}
	weapon := map[string]any{
		"id": "zero-blast",
		"profiles": []any{
			map[string]any{
				"name":  "Zero Blast",
				"range": 24,
				"stats": map[string]any{"A": 2.0, "BS": 4.0, "S": 4.0, "AP": 0.0, "D": 1.0},
				"keywords": []any{
					map[string]any{
						"keyword_id": "blast",
						"parameters": map[string]any{"value": 0.0},
					},
				},
			},
		},
	}
	stages, _, err := crunch(map[string]any{
		"attacker":     map[string]any{"weapon": weapon, "profileIndex": 0},
		"target":       map[string]any{"unit": target.Raw, "profileIndex": 0, "modelCount": 10.0},
		"modelsFiring": 1.0,
		"buffs":        []any{},
		"context":      map[string]any{"phase": "shooting"},
	}, ds)
	if err != nil {
		t.Fatal(err)
	}
	if got := stages[0]["expected"]; got != 2.0 {
		t.Fatalf("attacks = %v, want 2", got)
	}
}

func TestCanonicalSelectorRenderingKeepsModelAndMultiUnitScope(t *testing.T) {
	modelSelector := map[string]any{
		"filter": map[string]any{"owner": "friendly", "level": "model", "attachment_role": "bodyguard"},
		"count":  map[string]any{"min": 1.0, "max": 1.0},
	}
	modelText := describeEffectInline(map[string]any{
		"type": "select-units", "selector": modelSelector,
		"effect": map[string]any{"type": "stat-modifier", "target": "selected-unit", "modifier": map[string]any{"stat": "T", "operation": "improve", "value": 1.0}},
	}, effCtx{})
	if !strings.Contains(modelText, "one friendly") || !strings.Contains(modelText, "model") {
		t.Fatalf("model selector lost scope: %q", modelText)
	}
	multiSelector := map[string]any{
		"filter": map[string]any{"owner": "friendly", "all_of": []any{"INFANTRY"}},
		"count":  map[string]any{"min": 0.0, "max": 2.0},
	}
	multiText := describeEffectInline(map[string]any{
		"type": "select-units", "selector": multiSelector,
		"effect": map[string]any{"type": "stat-modifier", "target": "selected-unit", "modifier": map[string]any{"stat": "T", "operation": "improve", "value": 1.0}},
	}, effCtx{})
	if !strings.Contains(multiText, "up to 2") || !strings.Contains(multiText, "units") || !strings.Contains(multiText, "that unit") {
		t.Fatalf("multi-unit selector lost scope: %q", multiText)
	}
}

func TestUnitIDFilterTargetsExactBuffedSide(t *testing.T) {
	effect := map[string]any{
		"type": "stat-modifier", "target": map[string]any{"level": "unit", "unit_ids": []any{"target-1"}},
		"modifier": map[string]any{"stat": "T", "operation": "improve", "value": 1.0},
	}
	matching := effectToBuffs(effect, ownSource(), map[string]any{"targetUnitId": "target-1"}, "target")
	if len(matching.applied) != 1 {
		t.Fatalf("matching unit ID applied = %#v unsupported=%#v, want one contribution", matching.applied, matching.unsupported)
	}
	for _, tc := range []map[string]any{{"targetUnitId": "other"}, {}} {
		if got := effectToBuffs(effect, ownSource(), tc, "target"); len(got.applied) != 0 {
			t.Fatalf("nonmatching unit ID applied = %#v, want none", got.applied)
		}
	}
	rendered := describeEffectInline(effect, effCtx{})
	if !strings.Contains(rendered, "with unit ID target-1") {
		t.Fatalf("unit ID missing from render: %q", rendered)
	}
}

func TestRecipientSnapshotsBindHistoricalForEachRecipients(t *testing.T) {
	trigger := map[string]any{"event": "selected", "filter": map[string]any{"to": "shoot"}}
	selector := map[string]any{"filter": map[string]any{"owner": "friendly", "level": "model"}, "count": map[string]any{"min": 1.0, "max": 1.0}}
	effect := map[string]any{"type": "for-each-unit", "selector": selector, "effect": map[string]any{"type": "stat-modifier", "target": "recipient", "modifier": map[string]any{"stat": "T", "operation": "improve", "value": 1.0}}}
	source := map[string]any{"kind": "ability", "abilityId": "snapshot-test", "abilityKind": "unit", "sourceUnitId": "attacker-1"}
	context := map[string]any{
		"attackerUnitId": "attacker-1",
		"recipientSnapshots": []any{map[string]any{
			"source": source, "sourceUnitId": "attacker-1", "trigger": trigger, "selectionPath": "",
			"selector": selector, "perspective": "attacker", "recipientUnitId": "attacker-1", "selected": true,
		}},
	}
	resolved, reason := resolveRecipientSnapshots(trigger, effect, source, context, "attacker")
	if reason != "" || getStr(mapOr(resolved), "type") != "stat-modifier" || mapOr(resolved)["target"] != "recipient" {
		t.Fatalf("resolved = %#v, reason = %q", resolved, reason)
	}
	context["recipientSnapshots"] = []any{map[string]any{
		"source": source, "sourceUnitId": "attacker-1", "trigger": trigger, "selectionPath": "",
		"selector": selector, "perspective": "attacker", "recipientUnitId": "attacker-1", "selected": false,
	}}
	resolved, reason = resolveRecipientSnapshots(trigger, effect, source, context, "attacker")
	if reason != "" || getStr(mapOr(resolved), "type") != "sequence" || len(getList(mapOr(resolved), "steps")) != 0 {
		t.Fatalf("unselected = %#v, reason = %q", resolved, reason)
	}
	delete(context, "recipientSnapshots")
	_, reason = resolveRecipientSnapshots(trigger, effect, source, context, "attacker")
	if reason != recipientSnapshotReason {
		t.Fatalf("missing snapshot reason = %q", reason)
	}
}

func TestStanceLeversUseStableOptionIDsAndChoiceCap(t *testing.T) {
	effect := map[string]any{
		"type":        "stance-select",
		"max_choices": 2.0,
		"options": []any{
			map[string]any{"id": "alpha", "name": "Alpha", "effect": map[string]any{
				"type": "roll-modifier", "target": "this-unit",
				"modifier": map[string]any{"roll": "hit", "operation": "add", "value": 1.0},
			}},
		},
	}
	source := map[string]any{"kind": "ability", "abilityId": "fabricated-stance", "abilityKind": "unit"}
	out := effectToBuffs(effect, source, map[string]any{"phase": "shooting"}, "attacker")
	if len(out.activatable) != 1 {
		t.Fatalf("activatable = %#v, want one stance lever", out.activatable)
	}
	lever := mapOr(out.activatable[0])
	if got, want := lever["id"], "fabricated-stance#alpha"; got != want {
		t.Fatalf("stance lever id = %v, want %v", got, want)
	}
	group := mapOr(lever["group"])
	if got, want := group["maxActivations"], 2.0; got != want {
		t.Fatalf("stance max activations = %v, want %v", got, want)
	}
}
