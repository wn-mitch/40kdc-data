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

func namedRegionPrefix(m map[string]any) string {
	region := namedRegionTitle(mapOr(m["region_ref"])["region_id"])
	producer := mapOr(m["producer"])
	var sentences []string
	for _, raw := range getList(producer, "baseline") {
		entry := mapOr(raw)
		duration := expiryTrail(entry["duration"])
		sentence := capitalize(regionPhrase(mapOr(entry["region"]))) + " is within " + region
		if duration != "" {
			sentence += " " + duration
		}
		sentences = append(sentences, sentence+".")
	}
	for _, raw := range getList(producer, "phase_extensions") {
		entry := mapOr(raw)
		var triggers []string
		for _, trigger := range normalizeTriggers(entry["trigger"]) {
			if phrase := describeReactiveTrigger(trigger); phrase != "" {
				triggers = append(triggers, phrase)
			}
		}
		duration := expiryTrail(entry["duration"])
		sentence := capitalize(strings.Join(triggers, " or ")) + ", if " + describeCondition(mapOr(entry["condition"])) + ", " +
			regionPhrase(mapOr(entry["region"])) + " is within " + region
		if duration != "" {
			sentence += " " + duration
		}
		sentences = append(sentences, sentence+" (evaluated once at that time).")
	}
	for _, raw := range getList(producer, "additive_extensions") {
		entry := mapOr(raw)
		sentences = append(sentences, "The area within "+rangePhrase(entry["range"])+" of one or more "+
			filterSubject(mapOr(entry["filter"]), effCtx{})+" is within "+region+", continuously as those units move.")
	}
	return strings.Join(sentences, " ")
}

func namedRegionSubject(m map[string]any) string {
	return filterSubject(mapOr(mapOr(m["consumer"])["beneficiary_filter"]), effCtx{})
}

func namedRegionBranchText(m map[string]any, wholeUnit, qualified, conditional bool, ctx effCtx) string {
	consumer := mapOr(m["consumer"])
	key := "default_branch"
	if qualified {
		key = "qualified_branch"
	}
	branch := mapOr(consumer[key])
	subject := namedRegionSubject(m)
	inner := ctx
	inner.unitSubject = subject
	effect := describeEffectInline(mapOr(branch["effect"]), inner)
	if conditional {
		return effect
	}
	if !qualified {
		return capitalize(effect) + "."
	}
	if condition, ok := asMap(consumer["qualified_condition"]); ok && condition != nil && len(condition) > 0 {
		return "If " + describeCondition(condition) + ", " + effect + " instead"
	}
	membership := mapOr(consumer["membership"])
	region := namedRegionTitle(mapOr(m["region_ref"])["region_id"])
	membershipSubject := "such a model"
	if wholeUnit {
		membershipSubject = "such a unit"
	}
	return "If " + membershipSubject + " is " + namedRegionRelation(membership["relation"]) + " " + region + ", " + effect + " instead"
}

func describeNamedRegionState(m map[string]any, ctx effCtx) string {
	consumer := mapOr(m["consumer"])
	membership := mapOr(consumer["membership"])
	wholeUnit := membership["unit_scope"] == "whole-unit"
	attackGate := ""
	if condition, ok := asMap(consumer["attack_condition"]); ok && condition != nil {
		attackGate = "For each qualifying attack (" + describeCondition(condition) + "): "
	}
	return namedRegionPrefix(m) + " " + attackGate +
		namedRegionBranchText(m, wholeUnit, false, false, ctx) + " " +
		namedRegionBranchText(m, wholeUnit, true, false, ctx)
}

func describeNamedRegionConditional(m map[string]any, condition map[string]any, ctx effCtx) string {
	consumer := mapOr(m["consumer"])
	membership := mapOr(consumer["membership"])
	wholeUnit := membership["unit_scope"] == "whole-unit"
	ops, isNot := conditionOperands(condition, "not")
	negated := isNot && len(ops) == 1
	predicate := describeCondition(condition)
	if negated {
		predicate = describeCondition(ops[0])
	}
	defaultText := namedRegionBranchText(m, wholeUnit, false, true, ctx)
	qualifiedText := namedRegionBranchText(m, wholeUnit, true, true, ctx)
	if negated {
		return namedRegionPrefix(m) + " Unless " + predicate + ", " + defaultText + ". If " + predicate + ", " + qualifiedText + "."
	}
	return namedRegionPrefix(m) + " When " + predicate + ", " + qualifiedText + ". Otherwise, " + defaultText + "."
}
