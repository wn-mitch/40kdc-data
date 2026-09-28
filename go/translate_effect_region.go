package wh40kdc

import "strings"

// The named-region-state container: a rule-defined battlefield region, its
// producers and the consumer branches it gates. Mirror of the named-region half
// of tools/src/translate/effect.ts.

func namedRegionTitle(v any) string {
	return titleCase(cstr(v))
}

func namedRegionRelation(v any) string {
	if v == "wholly-within" {
		return "wholly within"
	}
	return dekebab(cstr(v))
}

func namedRegionKeywords(v any) string {
	values, ok := asList(v)
	if !ok {
		return "?"
	}
	parts := make([]string, len(values))
	for i, value := range values {
		parts[i] = ejstr(value)
	}
	return strings.Join(parts, " or ")
}

func namedRegionPrefix(m map[string]any) string {
	ref, _ := asMap(m["region_ref"])
	region := namedRegionTitle(ref["region_id"])
	producer, _ := asMap(m["producer"])
	sentences := []string{}
	if entries, ok := asList(producer["baseline"]); ok {
		for _, raw := range entries {
			entry, _ := asMap(raw)
			zone := ejstr(entry["zone"])
			switch zone {
			case "own-deployment-zone":
				sentences = append(sentences, "Your deployment zone is always within "+region+".")
			case "?":
			default:
				sentences = append(sentences, namedRegionTitle(zone)+" is always within "+region+".")
			}
		}
	}
	hasPhaseExtension := false
	if entries, ok := asList(producer["phase_extensions"]); ok {
		for _, raw := range entries {
			entry, _ := asMap(raw)
			zone := ejstr(entry["zone"])
			switch zone {
			case "no-mans-land":
				sentences = append(sentences, "At the start of each phase, No Man's Land is within "+region+" until the end of that phase if you control at least half of its objective markers.")
				hasPhaseExtension = true
			case "opponent-deployment-zone":
				if hasPhaseExtension {
					sentences = append(sentences, "The same applies separately to your opponent's deployment zone.")
				} else {
					sentences = append(sentences, "At the start of each phase, your opponent's deployment zone is within "+region+" until the end of that phase if you control at least half of its objective markers.")
				}
				hasPhaseExtension = true
			case "?":
			default:
				label := namedRegionTitle(zone)
				sentences = append(sentences, "At the start of each phase, "+label+" is within "+region+" until the end of that phase if you control at least half of its objective markers.")
				hasPhaseExtension = true
			}
		}
	}
	sourceParts := []string{}
	seenSourceParts := map[string]struct{}{}
	if entries, ok := asList(producer["additive_extensions"]); ok {
		for _, raw := range entries {
			addition, _ := asMap(raw)
			gate, _ := asMap(addition["source_gate"])
			predicate, _ := asMap(gate["unit_predicate"])
			if addition["kind"] == "unit-proximity" {
				keywords := "?"
				if _, ok := asList(predicate["keywords"]); ok {
					keywords = strings.Join(jstrList(predicate["keywords"]), " and ")
				}
				sentences = append(sentences, "The area within "+ejstr(addition["radius_inches"])+"\" of one or more friendly "+keywords+" units is within "+region+", continuously as those units move.")
				continue
			}
			if len(predicate) == 0 {
				continue
			}
			faction := namedRegionTitle(predicate["faction"])
			keywords := namedRegionKeywords(predicate["keywords"])
			radius := ""
			if addition["radius_inches"] != nil {
				radius = ` within ` + ejstr(addition["radius_inches"]) + `"`
			}
			rendered := faction + " units with " + keywords + radius
			if _, duplicate := seenSourceParts[rendered]; duplicate {
				continue
			}
			seenSourceParts[rendered] = struct{}{}
			sourceParts = append(sourceParts, rendered)
		}
	}
	if len(sourceParts) > 0 {
		sentences = append(sentences, "Selected objective markers extend "+region+" around "+strings.Join(sourceParts, " or ")+".")
	}
	return strings.Join(sentences, " ")
}

func namedRegionSubject(m map[string]any) string {
	consumer, _ := asMap(m["consumer"])
	gate, _ := asMap(consumer["beneficiary_gate"])
	faction := ""
	if gate["faction"] != nil {
		faction = namedRegionTitle(gate["faction"])
	}
	factionPart := " from your army"
	if faction != "" {
		factionPart = " from your " + faction + " army"
	}
	return "Models in " + namedRegionKeywords(gate["keywords"]) + " units" + factionPart
}

// rerollCount returns the re-roll modifier's `count` cap, when one is set.
func rerollCount(m map[string]any) (int, bool) {
	switch v := m["count"].(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	}
	return 0, false
}

// rerollCountPhrase renders a count-capped re-roll's subject: "one Hit roll",
// "up to 2 failed Wound rolls", "one roll of 1".
func rerollCountPhrase(m map[string]any, cnt int) string {
	lead, plural := "one", ""
	if cnt != 1 {
		lead, plural = "up to "+itoa(cnt), "s"
	}
	failed := ""
	if m["subset"] == "all-failures" {
		failed = "failed "
	}
	noun := "roll"
	if ejstr(m["roll"]) != "any" {
		noun = rollName(m["roll"]) + " roll"
	}
	ofOne := ""
	if m["subset"] == "ones" {
		ofOne = " of 1"
	}
	return lead + " " + failed + noun + plural + ofOne
}

func namedRegionBranchEffect(branch map[string]any, qualified bool, ctx effCtx) string {
	effect, _ := asMap(branch["effect"])
	modifier, _ := asMap(effect["modifier"])
	roll := rollName(modifier["roll"])
	text := ""
	switch getStr(effect, "type") {
	case "re-roll":
		if cnt, ok := rerollCount(modifier); ok {
			text = "can re-roll " + rerollCountPhrase(modifier, cnt)
		} else if modifier["result_scope"] == "any-result" {
			text = "can re-roll the " + roll + " roll"
		} else if modifier["subset"] == "ones" {
			text = "can re-roll " + roll + " rolls of 1"
		} else {
			text = "can re-roll " + roll + " rolls"
		}
	case "roll-modifier":
		if modifier["value"] != nil {
			text = "gets " + esigned(modifier["operation"], modifier["value"]) + " to " + roll
		}
	}
	if text == "" {
		text = describeEffectInline(effect, ctx)
	}
	if branch["optional"] == false {
		text = strings.Replace(text, "can re-roll", "re-roll", 1)
	}
	if modifier["weapon_keyword"] != nil {
		prefix := ""
		if qualified {
			prefix = "those "
		}
		text += " for " + prefix + ejstr(modifier["weapon_keyword"]) + " attacks"
	}
	return text
}

func namedRegionBranch(m map[string]any, wholeUnit, qualified, conditional bool, ctx effCtx) string {
	consumer, _ := asMap(m["consumer"])
	key := "default_branch"
	if qualified {
		key = "qualified_branch"
	}
	branch, _ := asMap(consumer[key])
	effect := namedRegionBranchEffect(branch, qualified, ctx)
	if conditional {
		return namedRegionSubject(m) + " " + effect
	}
	if !qualified {
		return namedRegionSubject(m) + " " + effect + "."
	}
	if condition, ok := getMap(consumer, "qualified_condition"); ok && condition["operator"] != nil {
		return "If " + describeCondition(condition) + ", those models " + effect + " instead"
	}
	membership, _ := asMap(consumer["membership"])
	ref, _ := asMap(m["region_ref"])
	region := namedRegionTitle(ref["region_id"])
	relation := namedRegionRelation(membership["relation"])
	subject := "If such a model is " + relation + " " + region + ", it"
	if wholeUnit {
		subject = "If such a unit is " + relation + " " + region + ", those models"
	}
	return subject + " " + effect + " instead"
}

func describeNamedRegionState(m map[string]any, ctx effCtx) string {
	consumer, _ := asMap(m["consumer"])
	membership, _ := asMap(consumer["membership"])
	wholeUnit := membership["unit_scope"] == "whole-unit"
	attackGate := ""
	if condition, ok := getMap(consumer, "attack_condition"); ok && condition != nil {
		attackGate = "For each qualifying attack (" + describeCondition(condition) + "): "
	}
	return namedRegionPrefix(m) + " " + attackGate + namedRegionBranch(m, wholeUnit, false, false, ctx) + " " + namedRegionBranch(m, wholeUnit, true, false, ctx)
}

// foughtThisPhase recognizes `not(happened selected-to-fight this phase)` and
func describeNamedRegionConditional(m map[string]any, condition map[string]any, ctx effCtx) string {
	consumer, _ := asMap(m["consumer"])
	membership, _ := asMap(consumer["membership"])
	wholeUnit := membership["unit_scope"] == "whole-unit"
	ops, isNot := conditionOperands(condition, "not")
	negated := isNot && len(ops) == 1
	predicate := describeCondition(condition)
	if negated {
		predicate = describeCondition(ops[0])
	}
	defaultText := namedRegionBranch(m, wholeUnit, false, true, ctx)
	qualifiedText := namedRegionBranch(m, wholeUnit, true, true, ctx)
	if negated {
		return namedRegionPrefix(m) + " Unless " + predicate + ", " + defaultText + ". If " + predicate + ", " + qualifiedText + "."
	}
	return namedRegionPrefix(m) + " When " + predicate + ", " + qualifiedText + ". Otherwise, " + defaultText + "."
}
