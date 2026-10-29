package wh40kdc

import (
	"regexp"
	"strings"
)

// Selection containers of the effect describer: select-units, for-each-unit,
// designate-target and persistent-designation, plus the selector noun phrases
// they share. Mirror of the selection half of tools/src/translate/effect.ts.

func selectorSubject(sel map[string]any, plural bool) string {
	subject := strings.TrimPrefix(filterSubject(mapOr(sel["filter"]), effCtx{}), "all ")
	if plural {
		return subject
	}
	subject = strings.Replace(subject, "units", "unit", 1)
	subject = strings.Replace(subject, "models", "model", 1)
	return strings.Replace(subject, "that are", "that is", 1)
}

// selectUnitsSubject renders a canonical unit selector's filter and inclusive
// count bounds ("up to two enemy units", "at least one model").
func selectUnitsSubject(sel map[string]any) string {
	filter := mapOr(sel["filter"])
	phrase, plural := selectorCountPhrase(sel)
	subject := strings.TrimPrefix(filterSubject(filter, effCtx{}), "all ")
	if !plural {
		subject = strings.Replace(subject, "units", "unit", 1)
		subject = strings.Replace(subject, "models", "model", 1)
		subject = strings.Replace(subject, "that are", "that is", 1)
	}
	bounds, _ := getMap(sel, "count")
	cap, _ := asMap(bounds["max"])
	if cap != nil && (bounds["min"] == nil || jsNumber(bounds["min"]) == 0) {
		capPhrase := quantityPhrase(cap)
		if cap["count_of"] != nil {
			phrase = "any number of"
			return phrase + " " + subject + " (at most " + capPhrase + ")" + selectionEligibilityAndLimit(sel)
		}
		phrase = "up to " + capParenTailRe.ReplaceAllString(capPhrase, "")
		return phrase + " " + subject + " (" + capParenInnerRe.ReplaceAllString(capPhrase, "$1") + ")" + selectionEligibilityAndLimit(sel)
	}
	return phrase + " " + subject + selectionEligibilityAndLimit(sel)
}

func selectorCountPhrase(sel map[string]any) (string, bool) {
	bounds := mapOr(sel["count"])
	quantity := func(value any) string {
		if m, ok := asMap(value); ok && m != nil {
			return quantityPhrase(m)
		}
		if jsNumber(value) == 1 {
			return "one"
		}
		return ejstr(value)
	}
	min, max := bounds["min"], bounds["max"]
	same := min != nil && max != nil && quantity(min) == quantity(max)
	switch {
	case same:
		return quantity(min), jsNumber(max) != 1
	case min != nil && max != nil && jsNumber(min) != 0:
		return "from " + quantity(min) + " through " + quantity(max), jsNumber(max) != 1
	case max != nil:
		return "up to " + quantity(max), jsNumber(max) != 1
	case min != nil:
		// "Select one or more models", not "at least one models".
		if jsNumber(min) == 1 {
			return "one or more", true
		}
		return "at least " + quantity(min), true
	default:
		return "each", false
	}
}

func selectionEligibilityAndLimit(sel map[string]any) string {
	out := ""
	if el, ok := asMap(sel["eligibility"]); ok && el != nil {
		out += " " + describeSelectionEligibility(el)
	}
	if limit, ok := asMap(sel["limit"]); ok && limit != nil {
		out += " (" + selectionLimitPhrase(limit, selectorNoun(sel)) + ")"
	}
	return out
}

func selectorNoun(sel map[string]any) string {
	if filter, ok := asMap(sel["filter"]); ok && filter != nil && filter["level"] == "model" {
		return "model"
	}
	return "unit"
}

func selectionLimitPhrase(limit map[string]any, noun string) string {
	times := numStr(limit["count"]) + " times"
	if limit["count"] == 1.0 {
		times = "once"
	}
	return "each " + noun + " can be selected for this ability at most " + times + " per " + dekebab(ejstr(limit["period"])) + " across your army"
}

func selectUnitsEngagement(sel map[string]any) string {
	filter := mapOr(sel["filter"])
	noun := selectorNoun(sel)
	var parts []string
	if engaged := filter["engaged_with"]; engaged != nil {
		parts = append(parts, "For each selected "+noun+", it must be within Engagement Range of "+unitRefPhrase(engaged, "the referenced unit")+".")
	}
	if notEngaged := filter["not_engaged_with"]; notEngaged != nil {
		parts = append(parts, "For each selected "+noun+", it must not be within Engagement Range of "+unitRefPhrase(notEngaged, "the referenced unit")+".")
	}
	if limit, ok := asMap(sel["limit"]); ok && limit != nil {
		parts = append(parts, capitalize(selectionLimitPhrase(limit, noun))+".")
	}
	return strings.Join(parts, " ")
}

var (
	capParenTailRe  = regexp.MustCompile(` \(.*\)$`)
	capParenInnerRe = regexp.MustCompile(`^.*\((.*)\)$`)
)

func selectUnitsPlural(sel map[string]any) bool {
	bounds := mapOr(sel["count"])
	min, max := bounds["min"], bounds["max"]
	if max == nil {
		return true
	}
	if min != nil && jsNumber(min) == jsNumber(max) && jsNumber(max) == 1 {
		return false
	}
	return jsNumber(max) != 1
}

var theUnitPossRe = regexp.MustCompile(`\b[Tt]he unit's\b`)
var theUnitRe = regexp.MustCompile(`\b[Tt]he unit\b`)

func selectedRecipient(text string, sel map[string]any) string {
	noun := selectorNoun(sel)
	recipient := "the selected " + noun
	if selectUnitsPlural(sel) {
		recipient = "each selected " + noun
	}
	// Membership remains relative to the bearer/current unit, not the selected recipient.
	const membership = "\ue000"
	text = strings.ReplaceAll(text, "in the unit", membership)
	text = theUnitPossRe.ReplaceAllStringFunc(text, func(match string) string {
		if match[0] == 'T' {
			return "Each selected " + noun + "'s"
		}
		return recipient + "'s"
	})
	text = theUnitRe.ReplaceAllStringFunc(text, func(match string) string {
		if match[0] == 'T' {
			return "Each selected " + noun
		}
		return recipient
	})
	return strings.ReplaceAll(text, membership, "in the unit")
}

func selectedContext(ctx effCtx, sel map[string]any) effCtx {
	model := selectorNoun(sel) == "model"
	ctx.selectedUnit = !model
	ctx.selectedModel = model
	ctx.unitSubject = ""
	return ctx
}

func selectUnitsInline(sel, effect map[string]any, ctx effCtx) string {
	subject := selectUnitsSubject(sel)
	binding := selectionBinding(sel)
	nested := selectedRecipient(describeEffectInline(effect, selectedContext(ctx, sel)), sel)
	return "select " + subject + binding + ": " + nested
}

// forEachUnitSubject renders the canonical for-each-unit selector phrase.
func forEachUnitSubject(sel map[string]any) string {
	eligibility := ""
	if el, ok := asMap(sel["eligibility"]); ok && el != nil {
		eligibility = " " + describeSelectionEligibility(el)
	}
	return selectorSubject(sel, false) + eligibility + selectionBinding(sel) + selectionLimitCanonical(sel, selectorNoun(sel))
}

func selectionLimitCanonical(sel map[string]any, noun string) string {
	limit, ok := asMap(sel["limit"])
	if !ok || limit == nil {
		return ""
	}
	times := ejstr(limit["count"]) + " times"
	if jsNumber(limit["count"]) == 1 {
		times = "once"
	}
	return " (each " + noun + " can be selected for this ability at most " + times + " per " + strings.ReplaceAll(ejstr(limit["period"]), "-", " ") + " across your army)"
}

var targetSuffixRe = regexp.MustCompile(`\bTarget$`)
var markerSuffixRe = regexp.MustCompile(`\bMarker$`)

// designationLabel is a designate-target mark's parenthetical ("(your Suppressed target)").
func designationLabel(designation any) string {
	label := titleCase(ejstr(designation))
	if targetSuffixRe.MatchString(label) {
		return " (your " + label + ")"
	}
	return " (your " + label + " target)"
}

func designationTargetSubject(sel map[string]any) string {
	selector := mapOr(sel["selector"])
	if sel["kind"] == "objective" {
		return objectiveSelectorPhrase(selector)
	}
	return selectUnitsSubject(selector) + selectionBinding(selector)
}

func designationAttackerPhrase(applies map[string]any, block bool) string {
	model, hasModel := asMap(applies["attacker_filter"])
	unit, hasUnit := asMap(applies["attacker_unit_filter"])
	attacker := "a friendly unit"
	if hasUnit && unit != nil {
		modelSubject := "model"
		if hasModel && model != nil {
			copy := map[string]any{"owner": "any", "level": "model"}
			for k, v := range model {
				copy[k] = v
			}
			modelSubject = selectorSubject(map[string]any{"filter": copy}, false)
		}
		copy := map[string]any{"owner": "friendly"}
		for k, v := range unit {
			copy[k] = v
		}
		attacker = "a " + modelSubject + " in a " + selectorSubject(map[string]any{"filter": copy}, false)
	} else if hasModel && model != nil {
		copy := map[string]any{"owner": "friendly", "level": "model"}
		for k, v := range model {
			copy[k] = v
		}
		attacker = "a " + selectorSubject(map[string]any{"filter": copy}, false)
	}
	if block {
		return "each time " + attacker + " makes an attack against it"
	}
	return "each time " + attacker + " attacks it"
}

func persistentDesignationName(designation, scope any) string {
	label := titleCase(ejstr(designation))
	if scope == "objective" {
		if markerSuffixRe.MatchString(label) {
			return "your " + label
		}
		return "your " + label + " Marker"
	}
	if targetSuffixRe.MatchString(label) {
		return "your " + label
	}
	return "your " + label + " target"
}

func persistentDesignationLabel(designation, scope any) string {
	return " (" + persistentDesignationName(designation, scope) + ")"
}

// designationSelect returns a designation's `select` object (empty when it is a string or absent).
func designationSelect(e map[string]any) map[string]any {
	return mapOr(e["select"])
}

func persistentDesignationSupported(e map[string]any) bool {
	sel := designationSelect(e)
	consumer := mapOr(e["consumer"])
	recipient := consumer["beneficiary"] == "this-model" || consumer["beneficiary"] == "this-unit"
	kind := getStr(sel, "kind")
	return recipient &&
		((kind == "unit" && consumer["relation"] == "attacks-selected-unit") ||
			(kind == "objective" && consumer["relation"] == "within-selected-marker"))
}

func persistentDesignationLead(e map[string]any) string {
	sel := designationSelect(e)
	noun := designationTargetSubject(sel)
	label := persistentDesignationLabel(e["designation"], sel["kind"])
	clauses := []string{"select " + noun + label + "."}
	if jsTruthy(e["allow_while_embarked"]) {
		clauses = append(clauses, "This selection can be made while this unit is embarked.")
	}
	lifecycle := mapOr(e["lifecycle"])
	if replacement, ok := asMap(lifecycle["replace"]); ok && replacement != nil && e["selection_policy"] == "replace-on-destroyed" {
		must := "you must"
		if jsTruthy(replacement["optional"]) {
			must = "you may"
		}
		clauses = append(clauses, "When "+persistentDesignationName(e["designation"], sel["kind"])+" is destroyed, "+must+" select "+noun+" to replace it.")
	}
	if lifecycle["exclusivity"] == "one-active-per-bearer-unit" {
		clauses = append(clauses, "Only one such designation can be active for this bearer unit.")
	}
	return strings.Join(clauses, " ")
}

func persistentDesignationWhen(e map[string]any) string {
	sel := designationSelect(e)
	consumer := mapOr(e["consumer"])
	name := persistentDesignationName(e["designation"], sel["kind"])
	bearer := "this model"
	if consumer["beneficiary"] == "this-unit" {
		bearer = "a model in this unit"
	}
	relation := "each time " + bearer + " makes an attack against it"
	if consumer["relation"] == "within-selected-marker" {
		relation = "while " + bearer + " is within range of " + name
	}
	_, trail := durationClauses(e["duration"])
	if trail != "" {
		return capitalize(trail) + ", " + relation
	}
	return relation
}

func persistentDesignationReplacement(e map[string]any) string {
	sel := designationSelect(e)
	replacement := mapOr(mapOr(e["lifecycle"])["replace"])
	previous := persistentDesignationName(e["designation"], sel["kind"])
	label := persistentDesignationLabel(e["designation"], sel["kind"])
	embarked := ""
	if jsTruthy(e["allow_while_embarked"]) {
		embarked = ". This selection can be made while this unit is embarked"
	}
	must := "you must"
	if jsTruthy(replacement["optional"]) {
		must = "you may"
	}
	return "when " + previous + " is destroyed, " + must + " select " + designationTargetSubject(sel) + label +
		" to replace this bearer unit's existing designation. Its existing effects apply to the new target without changing the designation's expiry" + embarked
}

func selectionRefName(ref any, fallback string) string {
	value := mapOr(ref)
	id := value["selection_var"]
	if id == nil {
		id = value["event_var"]
	}
	if s, ok := id.(string); ok && s != "" {
		return "the bound " + dekebab(strings.ReplaceAll(s, "_", "-"))
	}
	return fallback
}

func selectionBinding(sel map[string]any) string {
	b, ok := sel["bind_as"].(string)
	if !ok || b == "" {
		return ""
	}
	_, plural := selectorCountPhrase(sel)
	it := "it"
	if plural {
		it = "them"
	}
	return ", binding " + it + " as " + strings.ReplaceAll(strings.ReplaceAll(b, "_", " "), "-", " ")
}

func designatedAttackWhen(applies map[string]any) string {
	source := selectionRefName(applies["beneficiary"], "the selected beneficiary unit")
	target := selectionRefName(applies["reference"], "the selected designated target")
	return "each time " + source + " makes an attack against " + target
}

func designatedRecipientContext(applies map[string]any, ctx effCtx) effCtx {
	if applies["to"] != "bound-unit-attacks-reference" {
		return ctx
	}
	ctx.unitSubject = selectionRefName(applies["beneficiary"], "the selected beneficiary unit")
	return ctx
}

// designateTargetWhen is the attack relation a designate-target mark's effect applies under.
func designateTargetWhen(applies map[string]any, block bool) string {
	switch applies["to"] {
	case "target":
		return "while it is your target"
	case "bearer-attacks-target":
		if block {
			return "each time this unit makes an attack against it"
		}
		return "each time this unit attacks it"
	case "bound-unit-attacks-reference":
		return designatedAttackWhen(applies)
	}
	return designationAttackerPhrase(applies, block)
}

func designateTargetInline(e map[string]any, ctx effCtx) string {
	sel := designationSelect(e)
	desig := ""
	if jsTruthy(e["designation"]) {
		desig = designationLabel(e["designation"])
	}
	_, durTrail := durationClauses(e["duration"])
	applies := mapOr(e["applies"])
	when := designateTargetWhen(applies, false)
	whenClause := when
	if durTrail != "" {
		whenClause = durTrail + ", " + when
	}
	recipientCtx := designatedRecipientContext(applies, ctx)
	return "select " + designationTargetSubject(sel) + desig + "; " + whenClause + ", " + describeEffectInline(mapOr(applies["effect"]), recipientCtx)
}

func designateTargetBlock(e map[string]any, indent, arrow string, depth int, ctx effCtx) string {
	sel := designationSelect(e)
	desig := ""
	if jsTruthy(e["designation"]) {
		desig = designationLabel(e["designation"])
	}
	applies := mapOr(e["applies"])
	inner := mapOr(applies["effect"])
	_, durTrail := durationClauses(e["duration"])
	when := designateTargetWhen(applies, true)
	whenClause := capitalize(when)
	if durTrail != "" {
		whenClause = capitalize(durTrail) + ", " + when
	}
	head := indent + arrow + "Select " + designationTargetSubject(sel) + desig + ". " + whenClause
	recipientCtx := designatedRecipientContext(applies, ctx)
	if containerTypes[ejstrType(inner)] {
		return head + ":\n" + describeEffect(inner, depth+1, recipientCtx)
	}
	return head + ", " + describeEffectInline(inner, recipientCtx) + "."
}
