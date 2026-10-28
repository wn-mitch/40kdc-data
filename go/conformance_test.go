package wh40kdc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Go-native conformance suite. The cross-impl differ (tooling/parity) drives
// the runner for most areas; this file covers the two areas the differ does not
// (weapon-keywords and abilities-resolver are pinned per-language against the
// shared corpus), plus normalize as a quick self-check.

const corpusDir = "../conformance"

func loadCorpus(t *testing.T, parts ...string) []byte {
	t.Helper()
	p := filepath.Join(append([]string{corpusDir}, parts...)...)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Skipf("conformance corpus not available: %v", err)
	}
	return b
}

func canon(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestNormalizeCorpus(t *testing.T) {
	var cases []map[string]any
	if err := json.Unmarshal(loadCorpus(t, "normalize.json"), &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		in, _ := c["input"].(string)
		want, _ := c["expected"].(string)
		if got := NormalizeName(in); got != want {
			t.Errorf("NormalizeName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWeaponKeywordsCorpus(t *testing.T) {
	var cases []map[string]any
	if err := json.Unmarshal(loadCorpus(t, "weapon-keywords", "cases.json"), &cases); err != nil {
		t.Fatal(err)
	}
	ds := EmbeddedDataset()
	for _, c := range cases {
		id, _ := c["keyword_id"].(string)
		view, ok := ds.WeaponKeywords.Get(id)
		if !ok {
			t.Errorf("keyword %q not in catalog", id)
			continue
		}
		if got, want := canon(t, view.Raw["effect"]), canon(t, c["expected_effect"]); got != want {
			t.Errorf("keyword %q effect = %s, want %s", id, got, want)
		}
		if c["expected_effect"] == nil && !engineDispatchKeywords[id] {
			t.Errorf("keyword %q has null effect but is not engine-dispatched", id)
		}
	}
}

func TestEligibleAbilitiesCorpus(t *testing.T) {
	matches, _ := filepath.Glob(filepath.Join(corpusDir, "abilities-resolver", "0*.json"))
	if len(matches) == 0 {
		t.Skip("conformance corpus not available")
	}
	ds := EmbeddedDataset()
	for _, file := range matches {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var c map[string]any
		if err := json.Unmarshal(b, &c); err != nil {
			t.Fatal(err)
		}
		input, _ := asMap(c["input"])
		phase, _ := c["phase"].(string)
		grouped := map[string][]string{}
		for _, entry := range resolveEligibleAbilities(ds, input, phase) {
			source := entry["source"].(map[string]any)
			ability := entry["ability"].(*AbilityView)
			kind := getStr(source, "kind")
			grouped[kind] = append(grouped[kind], ability.ID())
		}
		for _, ids := range grouped {
			sort.Strings(ids)
		}
		if got, want := canon(t, grouped), canon(t, c["expected"]); got != want {
			t.Errorf("%s eligible = %s, want %s", filepath.Base(file), got, want)
		}
	}
}

func runDSLCorpus(t *testing.T, filename string) {
	t.Helper()
	var dsl map[string]any
	if err := json.Unmarshal(loadCorpus(t, "abilities-resolver", filename), &dsl); err != nil {
		t.Fatal(err)
	}
	ds := EmbeddedDataset()
	for _, cAny := range getList(dsl, "cases") {
		c, _ := asMap(cAny)
		abilityID := getStr(c, "abilityId")
		source, _ := getMap(c, "source")
		ctx, _ := getMap(c, "context")
		perspective := strOr(c, "perspective", "attacker")
		// Frozen specimens exercise the inline translator. Real records must
		// take the same AbilityView path as production consumers so trigger
		// gating, bundle resolution and recipient snapshots are included.
		var result *effectTranslation
		if rawEffect, frozen := c["effect"]; frozen {
			// Ability records the effect grants resolve as printed definitions, the granting
			// ability itself excluded.
			if records, ok := getMap(c, "grantedRecords"); ok {
				lookup := func(id string) map[string]any { record, _ := getMap(records, id); return record }
				rawEffect = ResolveGrantedRecords(rawEffect, lookup, map[string]bool{getStr(source, "abilityId"): true})
			}
			rating, hasRating := c["rating"]
			result = effectToBuffs(withRating(rawEffect, rating, hasRating), source, ctx, perspective)
		} else {
			ability, ok := ds.Abilities.GetAny(abilityID)
			if !ok {
				t.Errorf("unknown ability %q", abilityID)
				continue
			}
			rating, hasRating := c["rating"]
			result = ability.describeRatedBuffs(source, ctx, perspective, rating, hasRating)
		}
		expected, _ := getMap(c, "expected")

		var appliedContribs []any
		for _, b := range result.applied {
			bm, _ := asMap(b)
			appliedContribs = append(appliedContribs, bm["contribution"])
		}
		if got, want := canon(t, orEmpty(appliedContribs)), canon(t, expected["applied"]); got != want {
			t.Errorf("%s (%s) applied = %s, want %s", abilityID, perspective, got, want)
		}

		var reasons []any
		for _, u := range result.unsupported {
			um, _ := asMap(u)
			reasons = append(reasons, um["reason"])
		}
		if got, want := canon(t, orEmpty(reasons)), canon(t, expected["unsupportedReasons"]); got != want {
			t.Errorf("%s (%s) unsupportedReasons = %s, want %s", abilityID, perspective, got, want)
		}

		// Each applied buff's gate (null when ungated), pinned on the rows that carry it.
		if expected["applicableWhen"] != nil {
			var gates []any
			for _, b := range result.applied {
				bm, _ := asMap(b)
				gates = append(gates, bm["applicableWhen"])
			}
			if got, want := canon(t, orEmpty(gates)), canon(t, expected["applicableWhen"]); got != want {
				t.Errorf("%s (%s) applicableWhen = %s, want %s", abilityID, perspective, got, want)
			}
		}

		if expected["activatable"] != nil {
			var acts []any
			for _, aAny := range result.activatable {
				a, _ := asMap(aAny)
				var buffs []any
				for _, b := range getList(a, "buffs") {
					bm, _ := asMap(b)
					buffs = append(buffs, bm["contribution"])
				}
				acts = append(acts, map[string]any{
					"id":             a["id"],
					"label":          a["label"],
					"group":          a["group"],
					"requires":       a["requires"],
					"capRaise":       a["capRaise"],
					"requiresOption": a["requiresOption"],
					"excludesOption": a["excludesOption"],
					"buffs":          orEmpty(buffs),
				})
			}
			// An expected lever omits "group", "requires", "capRaise", "requiresOption" and "excludesOption" when it has none.
			var expActs []any
			for _, eAny := range getList(expected, "activatable") {
				e, _ := asMap(eAny)
				ne := cloneMap(e)
				for _, key := range []string{"group", "requires", "capRaise", "requiresOption", "excludesOption"} {
					if _, has := ne[key]; !has {
						ne[key] = nil
					}
				}
				expActs = append(expActs, ne)
			}
			if got, want := canon(t, orEmpty(acts)), canon(t, orEmpty(expActs)); got != want {
				t.Errorf("%s (%s) activatable = %s, want %s", abilityID, perspective, got, want)
			}
		}
	}
}

func orEmpty(l []any) []any {
	if l == nil {
		return []any{}
	}
	return l
}

func TestFromDSLCorpus(t *testing.T)          { runDSLCorpus(t, "from-dsl.json") }
func TestDefensiveFromDSLCorpus(t *testing.T) { runDSLCorpus(t, "defensive-from-dsl.json") }

func TestCountCappedRerollIsNotAppliedAsUnlimited(t *testing.T) {
	source := map[string]any{
		"kind":        "ability",
		"abilityId":   "count-capped-reroll",
		"abilityKind": "unit",
	}
	translate := func(roll string, count float64) *effectTranslation {
		effect := map[string]any{
			"type":   "re-roll",
			"target": "this-unit",
			"modifier": map[string]any{
				"roll":         roll,
				"result_scope": "any-result",
				"count":        count,
			},
		}
		return effectToBuffs(effect, source, map[string]any{"phase": "shooting"}, "attacker")
	}

	// One die of any result is priced as a single re-rolled die, not an unlimited re-roll.
	one := translate("hit", 1)
	if len(one.applied) != 1 || len(one.unsupported) != 0 {
		t.Fatalf("count 1: applied = %#v, unsupported = %#v", one.applied, one.unsupported)
	}
	buff, _ := asMap(one.applied[0])
	contribution, _ := getMap(buff, "contribution")
	if getStr(contribution, "type") != "reroll-one" || getStr(contribution, "roll") != "hit" {
		t.Fatalf("count 1 contribution = %#v, want reroll-one hit", contribution)
	}

	// A larger finite permission is refused.
	two := translate("hit", 2)
	if len(two.applied) != 0 || len(two.unsupported) != 1 {
		t.Fatalf("count 2: applied = %#v, unsupported = %#v", two.applied, two.unsupported)
	}
	diagnostic, _ := asMap(two.unsupported[0])
	if got := getStr(diagnostic, "reason"); got != "re-roll: a count-capped permission other than one die of any result is not modelled by the expected-value engine" {
		t.Fatalf("count 2 reason = %q", got)
	}

	// A count-capped roll off the damage path is outside it, not count-capped.
	charge := translate("charge", 1)
	if len(charge.applied) != 0 || len(charge.unsupported) != 1 {
		t.Fatalf("charge: applied = %#v, unsupported = %#v", charge.applied, charge.unsupported)
	}
	diagnostic, _ = asMap(charge.unsupported[0])
	if got := getStr(diagnostic, "reason"); !strings.Contains(got, "outside the damage path") {
		t.Fatalf("charge reason = %q", got)
	}
}

// TestEffectTranslationCorpus renders every effect-translation case with the Go describer; the
// rendered text is the contract, byte for byte.
func TestEffectTranslationCorpus(t *testing.T) {
	var cases []map[string]any
	if err := json.Unmarshal(loadCorpus(t, "effect-translation", "cases.json"), &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		ability := map[string]any{"effect": c["effect"]}
		for _, key := range []string{"scope", "usage", "trigger", "applies_to", "optional"} {
			if c[key] != nil {
				ability[key] = c[key]
			}
		}
		want := c["expected"].(map[string]any)["text"]
		if got := describeAbility(ability); got != want {
			t.Errorf("%v:\n got  %q\n want %q", c["caseId"], got, want)
		}
	}
}

func TestStratagemTargetsCorpus(t *testing.T) {
	var corpus map[string]any
	if err := json.Unmarshal(loadCorpus(t, "abilities-resolver", "stratagem-targets.json"), &corpus); err != nil {
		t.Fatal(err)
	}
	cases, _ := corpus["cases"].([]any)
	if len(cases) == 0 {
		t.Fatal("the stratagem-target corpus is empty")
	}
	for _, item := range cases {
		c, _ := asMap(item)
		keywords := map[string]bool{}
		for _, keyword := range getStrList(c, "keywords") {
			keywords[keyword] = true
		}
		got := stratagemCanTarget(map[string]any{"target_restrictions": c["target_restrictions"]}, keywords)
		if want, _ := c["expected"].(bool); got != want {
			t.Errorf("%s: got %v, want %v", getStr(c, "name"), got, want)
		}
	}
}

// TestValidatorCorpus pins the schema validator's closed-enum (path, code)
// errors against conformance/validator, order-insensitively.
func TestValidatorCorpus(t *testing.T) {
	var cases []struct {
		Name           string           `json:"name"`
		Target         string           `json:"target"`
		Input          any              `json:"input"`
		ExpectedErrors []map[string]any `json:"expected_errors"`
	}
	if err := json.Unmarshal(loadCorpus(t, "validator", "cases.json"), &cases); err != nil {
		t.Fatal(err)
	}
	keys := func(errs []map[string]any) []string {
		out := make([]string, 0, len(errs))
		for _, e := range errs {
			out = append(out, cstr(e["path"])+"|"+cstr(e["code"]))
		}
		sort.Strings(out)
		return out
	}
	v := NewSchemaValidator()
	for _, c := range cases {
		if _, ok := validatorTargets[c.Target]; !ok {
			t.Errorf("%s: unknown target %q", c.Name, c.Target)
			continue
		}
		got, want := keys(v.validateTarget(c.Target, c.Input)), keys(c.ExpectedErrors)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s:\n got  %v\n want %v", c.Name, got, want)
		}
	}
}
