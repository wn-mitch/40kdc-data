package wh40kdc

import "testing"

// Named ability grants: a printed definition applies to its holders, and a friendly filter naming
// the ability being resolved in has_ability selects its holder. Mirrors
// tools/test/cruncher-named-grants.test.ts.

func namedGrant(target any, printed bool) map[string]any {
	modifier := map[string]any{"ability": map[string]any{"ability_id": "fabricated-named", "definition_id": "fabricated-part"}}
	if printed {
		modifier["definition"] = map[string]any{"type": "ability-part", "name": "Fabricated Part", "effect": map[string]any{
			"type": "weapon-ability-grant", "target": "this-unit",
			"modifier": map[string]any{"keywords": []any{map[string]any{"keyword_id": "lethal-hits"}}},
		}}
	}
	return map[string]any{"type": "ability-grant", "target": target, "modifier": modifier}
}

func namedGrantBuffs(effect map[string]any, kind string) *effectTranslation {
	source := map[string]any{"kind": "ability", "abilityId": "fabricated-named", "abilityKind": kind}
	context := map[string]any{"phase": "shooting", "attackerKeywords": []any{"kill team"}}
	return effectToBuffs(effect, source, context, "attacker")
}

func TestNamedGrantTranslatesTheDefinitionItPrints(t *testing.T) {
	out := namedGrantBuffs(namedGrant("this-unit", true), "detachment")
	if len(out.applied) != 1 || len(out.unsupported) != 0 {
		t.Fatalf("applied = %#v, unsupported = %#v", out.applied, out.unsupported)
	}
	want := map[string]any{"type": "extra-keyword", "keywordRef": map[string]any{"keyword_id": "lethal-hits"}}
	if got := canon(t, out.applied[0].(map[string]any)["contribution"]); got != canon(t, want) {
		t.Errorf("contribution = %s, want %s", got, canon(t, want))
	}
	bare := namedGrantBuffs(namedGrant("this-unit", false), "detachment")
	if len(bare.applied) != 0 || len(bare.unsupported) != 1 ||
		bare.unsupported[0].(map[string]any)["reason"] != "ability-grant: named ability ownership is not resolved by the buff engine" {
		t.Errorf("bare named grant: applied = %#v, unsupported = %#v", bare.applied, bare.unsupported)
	}
}

func TestFriendlyFilterSelectsTheHolderOfTheAbilityBeingResolved(t *testing.T) {
	filter := func(has string) map[string]any {
		return map[string]any{"owner": "friendly", "all_of": []any{"KILL TEAM"}, "has_ability": []any{has}}
	}
	if out := namedGrantBuffs(namedGrant(filter("fabricated-named"), true), "detachment"); len(out.applied) != 1 {
		t.Errorf("own holder: applied = %#v, unsupported = %#v", out.applied, out.unsupported)
	}
	if out := namedGrantBuffs(namedGrant(filter("fabricated-other"), true), "detachment"); len(out.applied) != 0 {
		t.Errorf("another ability's holders: applied = %#v", out.applied)
	}
	if out := namedGrantBuffs(namedGrant(filter("fabricated-named"), true), "support"); len(out.applied) != 0 {
		t.Errorf("provided by another unit: applied = %#v", out.applied)
	}
}
