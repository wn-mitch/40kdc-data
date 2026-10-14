package wh40kdc

import (
	"regexp"
	"strings"
)

// Selection containers of the effect describer: select-units, for-each-unit,
// designate-target, persistent-designation and leader-model-ability-grant,
// plus the selector noun phrases they share. Mirror of the selection half of
// tools/src/translate/effect.ts.

// selectUnitsSubject renders the select-units selector phrase ("one enemy Vehicle unit within 12\"").
func selectUnitsSubject(sel map[string]any) string {
	var kws []string
	for _, k := range jstrList(sel["keywords"]) {
		kws = append(kws, titleCase(k))
	}
	kw := strings.Join(kws, " ")
	exactCount := sel["count"]
	if exactCount == nil && sel["min_count"] != nil && jsNumber(sel["min_count"]) == jsNumber(sel["max_count"]) {
		exactCount = sel["max_count"]
	}
	bounded := sel["min_count"] != nil && exactCount == nil
	count := sel["max_count"]
	if exactCount != nil {
		count = exactCount
	}
	// A cap set by the battle size or by a count reads after the noun: "up to 1/2/3 enemy units (Incursion/...)".
	capMap, isCap := count.(map[string]any)
	single := jsNumber(count) == 1
	nounBase := "unit"
	if sel["target_kind"] == "model" {
		nounBase = "model"
	}
	noun := nounBase
	if !single {
		noun += "s"
	}
	capPhrase, sized := "", false
	if isCap {
		capPhrase = quantityPhrase(capMap)
		sized = capMap["count_of"] == nil
	}
	quantity := "up to " + ejstr(count)
	if isCap {
		quantity = "any number of"
		if sized {
			quantity = "up to " + capParenTailRe.ReplaceAllString(capPhrase, "")
		}
	} else if exactCount != nil {
		quantity = ejstr(count)
		if single {
			quantity = "one"
		}
	} else if bounded {
		quantity = "from " + ejstr(sel["min_count"]) + " through " + ejstr(sel["max_count"])
	}
	boundOrigin := ""
	if jsTruthy(sel["within_inches_from"]) {
		boundOrigin = " of " + selectionRefName(sel["within_inches_from"], "the bound source unit")
	}
	wholly := ""
	if sel["wholly"] == true {
		wholly = " wholly"
	}
	within := ""
	if sel["within_inches"] != nil {
		within = wholly + " within " + ejstr(sel["within_inches"]) + "\"" + boundOrigin
	} else if sel["range_inches"] != nil {
		origin := boundOrigin
		if origin == "" {
			origin = " of " + referenceOrigin(sel["reference"])
		}
		within = wholly + " within " + ejstr(sel["range_inches"]) + "\"" + origin
	}
	visible := ""
	if jsTruthy(sel["visible_to"]) {
		visible = " visible to " + selectionRefName(sel["visible_to"], "the bound source unit")
	} else if sel["visibility_required"] == true {
		visible = " visible to the bearer"
	}
	inclusive := ""
	if bounded {
		inclusive = ", inclusive"
	}
	eligibility := ""
	if el, ok := asMap(sel["eligibility"]); ok && el != nil {
		eligibility = " " + describeSelectionEligibility(el)
	}
	if kw != "" {
		kw = " " + kw
	}
	capTail := ""
	if isCap {
		noun = nounBase + "s"
		capTail = " (at most " + capPhrase + ")"
		if sized {
			capTail = " (" + capParenInnerRe.ReplaceAllString(capPhrase, "$1") + ")"
		}
	}
	return quantity + " " + ejstr(sel["owner"]) + kw + " " + noun + capTail + selectionModelFilters(sel) + inclusive + within + visible + eligibility
}

func selectionModelFilters(sel map[string]any) string {
	names := ""
	if l, ok := asList(sel["model_names"]); ok {
		names = " named " + orList(jstrList(l))
	}
	exclusions := ""
	if l, ok := asList(sel["excluded_keywords"]); ok && len(l) > 0 {
		kind := "units"
		if sel["target_kind"] == "model" {
			kind = "models"
		}
		exclusions = " (excluding " + kind + " with " + orList(jstrList(l)) + ")"
	}
	return names + exclusions
}

func selectionLimitPhrase(limit map[string]any, noun string) string {
	times := numStr(limit["count"]) + " times"
	if limit["count"] == 1.0 {
		times = "once"
	}
	return "each " + noun + " can be selected for this ability at most " + times + " per " + dekebab(ejstr(limit["period"])) + " across your army"
}

func selectUnitsEngagement(sel map[string]any) string {
	var parts []string
	noun := "unit"
	if sel["target_kind"] == "model" {
		noun = "model"
	}
	origin := referenceOrigin(sel["reference"])
	switch sel["engagement_relation"] {
	case "engaged-with-bearer":
		parts = append(parts, "For each selected "+noun+", it must be within Engagement Range of "+origin+".")
	case "not-engaged-with-bearer":
		parts = append(parts, "For each selected "+noun+", it must not be within Engagement Range of "+origin+".")
	}
	if limit, ok := asMap(sel["selection_limit"]); ok && limit != nil {
		parts = append(parts, capitalize(selectionLimitPhrase(limit, noun))+".")
	}
	return strings.Join(parts, " ")
}

var (
	capParenTailRe  = regexp.MustCompile(` \(.*\)$`)
	capParenInnerRe = regexp.MustCompile(`^.*\((.*)\)$`)
)

func selectUnitsPlural(sel map[string]any) bool {
	// A cap set by the battle size or a count can select more than one.
	if _, ok := sel["max_count"].(map[string]any); ok && sel["count"] == nil {
		return true
	}
	count := sel["count"]
	if count == nil {
		count = sel["max_count"]
	}
	return jsNumber(count) > 1
}

var theUnitPossRe = regexp.MustCompile(`\b[Tt]he unit's\b`)
var theUnitRe = regexp.MustCompile(`\b[Tt]he unit\b`)

func selectedRecipient(text string, sel map[string]any) string {
	noun := "unit"
	if sel["target_kind"] == "model" {
		noun = "model"
	}
	recipient := "the selected " + noun
	if selectUnitsPlural(sel) {
		recipient = "each selected " + noun
	}
	text = theUnitPossRe.ReplaceAllStringFunc(text, func(match string) string {
		if match[0] == 'T' {
			return "Each selected " + noun + "'s"
		}
		return recipient + "'s"
	})
	return theUnitRe.ReplaceAllStringFunc(text, func(match string) string {
		if match[0] == 'T' {
			return "Each selected " + noun
		}
		return recipient
	})
}

func selectedContext(ctx effCtx, sel map[string]any) effCtx {
	model := sel["target_kind"] == "model"
	ctx.selectedUnit = !model
	ctx.selectedModel = model
	ctx.unitSubject = ""
	return ctx
}

func selectUnitsInline(sel, effect map[string]any, ctx effCtx) string {
	subject := selectUnitsSubject(sel)
	engagement := selectUnitsEngagement(sel)
	binding := selectionBinding(sel)
	nested := selectedRecipient(describeEffectInline(effect, selectedContext(ctx, sel)), sel)
	if engagement != "" {
		return "select " + subject + binding + ". " + engagement + " " + capitalize(nested)
	}
	return "select " + subject + binding + ": " + nested
}

var thisModelLeadRe = regexp.MustCompile(`^this model\b`)

// leaderModelAbilityGrantClause renders the beneficiary-only leader relation
// without exposing a bearer fallback.
func leaderModelAbilityGrantClause(e map[string]any, ctx effCtx) string {
	filter := mapOr(e["leader_filter"])
	identity := ""
	if jsTruthy(filter["identity"]) {
		identity = titleCase(ejstr(filter["identity"]))
	}
	var kwParts []string
	for _, k := range getList(filter, "keywords") {
		kwParts = append(kwParts, bracketKeyword(k))
	}
	keywords := strings.Join(kwParts, " and ")
	role := "the attached leader model"
	if e["beneficiary"] == "attached-character-leader" {
		role = "the attached CHARACTER leader model"
	}
	leader := role
	if identity != "" {
		leader += " identified as " + identity
	}
	if keywords != "" {
		leader += " with " + keywords
	}
	var unitParts []string
	for _, k := range getList(e, "attached_unit_filter") {
		unitParts = append(unitParts, bracketKeyword(k))
	}
	source := "the bearer unit"
	if len(unitParts) > 0 {
		source += " with " + strings.Join(unitParts, " and ")
	}
	nested := mapOr(mapOr(e["grant"])["effect"])
	withTarget := make(map[string]any, len(nested)+1)
	for k, v := range nested {
		withTarget[k] = v
	}
	withTarget["target"] = "this-model"
	rendered := replaceFirst(thisModelLeadRe, describeEffectInline(withTarget, ctx), "that leader model")
	return "while " + leader + " leads " + source + ", " + rendered
}

// referenceOrigin is the range/engagement origin phrase for a selector's `reference`.
func referenceOrigin(reference any) string {
	switch reference {
	case "bearer-transport":
		return "this model's unit's Transport"
	case "bearer-unit":
		return "this model's unit"
	}
	return "the bearer"
}

// forEachUnitSubject renders the for-each-unit selector phrase ("enemy unit within 6\"").
func forEachUnitSubject(sel map[string]any) string {
	var keywordList []string
	for _, k := range jstrList(sel["keywords"]) {
		keywordList = append(keywordList, titleCase(k))
	}
	keywords := ""
	if len(keywordList) > 0 {
		if sel["keyword_match"] == "any" {
			keywords = orList(keywordList) + " "
		} else {
			keywords = strings.Join(keywordList, " ") + " "
		}
	}
	within := ""
	if sel["within_inches"] != nil {
		within += " within " + ejstr(sel["within_inches"]) + "\""
	}
	if jsTruthy(sel["within_objective"]) {
		within += " within range of " + selectionRefName(sel["within_objective"], "the selected objective marker")
	}
	origin := referenceOrigin(sel["reference"])
	engagement := ""
	switch sel["engagement_relation"] {
	case "engaged-with-bearer":
		engagement = " in Engagement Range of " + origin
	case "not-engaged-with-bearer":
		engagement = " not in Engagement Range of " + origin
	}
	noun := "unit"
	if sel["target_kind"] == "model" {
		noun = "model"
	}
	eligibility := ""
	if jsTruthy(sel["eligibility"]) {
		eligibility = " " + describeSelectionEligibility(mapOr(sel["eligibility"]))
	}
	member := ""
	if sel["member_of"] == "bearer-unit" {
		member = " in this model's unit"
	}
	return ejstr(sel["owner"]) + " " + keywords + noun + selectionModelFilters(sel) + member + within + engagement + eligibility + selectionBinding(sel)
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

func designationTargetSubjectBase(sel map[string]any) string {
	disposition := "enemy"
	if sel["scope"] == "friendly-unit" {
		disposition = "friendly"
	}
	var keywords []string
	if l, ok := asList(sel["keywords"]); ok {
		for _, k := range l {
			keywords = append(keywords, titleCase(ejstr(k)))
		}
	}
	join := " "
	if sel["keyword_match"] == "any" {
		join = " or "
	}
	keywordText := ""
	if len(keywords) > 0 {
		keywordText = " " + strings.Join(keywords, join)
	}
	reference := referenceOrigin(sel["reference"])
	origin := ""
	if jsTruthy(sel["within_inches_from"]) {
		origin = " of " + selectionRefName(sel["within_inches_from"], "the bound source unit")
	} else if jsTruthy(sel["reference"]) {
		origin = " of " + reference
	}
	within := ""
	if sel["within_inches"] != nil {
		within = " within " + ejstr(sel["within_inches"]) + "\"" + origin
	}
	visible := ""
	if jsTruthy(sel["visible_to"]) {
		visible = " visible to " + selectionRefName(sel["visible_to"], "the bound source unit")
	} else if jsTruthy(sel["visibility_required"]) {
		visible = " visible to " + reference
	}
	exclusions := ""
	if l, ok := asList(sel["excluded_keywords"]); ok && len(l) > 0 {
		exclusions = " (excluding " + strings.Join(jstrList(l), " and ") + " units)"
	}
	return disposition + keywordText + " unit" + within + visible + exclusions
}

func designationTargetSubject(sel map[string]any) string {
	limit := ""
	if l, ok := asMap(sel["selection_limit"]); ok && l != nil {
		limit = " (" + selectionLimitPhrase(l, "unit") + ")"
	}
	elig := ""
	if el, ok := asMap(sel["eligibility"]); ok && el != nil {
		elig = " " + describeSelectionEligibility(el)
	}
	return designationTargetSubjectBase(sel) + elig + selectionBinding(sel) + limit
}

func designationAttackerPhrase(applies map[string]any, block bool) string {
	modelKeywords := strings.Join(jstrList(applies["attacker_keywords"]), " ")
	unitKeywords := strings.Join(jstrList(applies["attacker_unit_keywords"]), " ")
	attacker := "a friendly unit"
	if unitKeywords != "" {
		mk := ""
		if modelKeywords != "" {
			mk = " " + modelKeywords
		}
		attacker = "a" + mk + " model in a friendly " + unitKeywords + " unit"
	} else if modelKeywords != "" {
		attacker = "a friendly " + modelKeywords + " model"
	}
	if block {
		return "each time " + attacker + " makes an attack against it"
	}
	return "each time " + attacker + " attacks it"
}

func persistentDesignationName(designation, scope any) string {
	label := titleCase(ejstr(designation))
	if scope == "objective-marker" {
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
	recipient := consumer["beneficiary"] == "bearer" || consumer["beneficiary"] == "unit"
	return recipient &&
		((sel["scope"] == "enemy-unit" && consumer["relation"] == "attacks-selected-unit") ||
			(sel["scope"] == "objective-marker" && consumer["relation"] == "within-selected-marker"))
}

func persistentDesignationLead(e map[string]any) string {
	sel := designationSelect(e)
	noun := "enemy unit"
	if sel["scope"] == "objective-marker" {
		noun = "objective marker"
	}
	label := persistentDesignationLabel(e["designation"], sel["scope"])
	lead := "select"
	if jsTruthy(sel["timing"]) {
		lead = describeTiming(sel["timing"]) + ", select"
	}
	clauses := []string{lead + " one " + noun + label + selectionBinding(sel) + "."}
	if jsTruthy(sel["allow_while_embarked"]) {
		clauses = append(clauses, "This selection can be made while this unit is embarked.")
	}
	lifecycle, hasLifecycle := asMap(e["lifecycle"])
	if hasLifecycle && lifecycle != nil {
		if replacement, ok := asMap(lifecycle["replace"]); ok && replacement != nil && sel["selection_policy"] == "replace-on-destroyed" {
			name := selectionRefName(replacement["reference"], persistentDesignationName(e["designation"], sel["scope"]))
			must := "you must"
			if jsTruthy(replacement["optional"]) {
				must = "you may"
			}
			clauses = append(clauses, "When "+name+" is destroyed, "+must+" select one new "+noun+" to replace it.")
		}
		if lifecycle["exclusivity"] == "one-active-per-bearer-unit" {
			clauses = append(clauses, "Only one such designation can be active for this bearer unit.")
		}
		if lifecycle["expiry"] == "battle-end" && e["duration"] != "battle" {
			clauses = append(clauses, "This designation expires at the end of the battle.")
		}
	}
	return strings.Join(clauses, " ")
}

func persistentDesignationWhen(e map[string]any) string {
	sel := designationSelect(e)
	consumer := mapOr(e["consumer"])
	name := selectionRefName(consumer["reference"], persistentDesignationName(e["designation"], sel["scope"]))
	bearer := "this model"
	if consumer["beneficiary"] == "unit" {
		bearer = "a model in this unit"
	}
	var relation string
	if consumer["relation"] == "within-selected-marker" {
		relation = "while " + bearer + " is within range of " + name
	} else {
		against := "it"
		if jsTruthy(consumer["reference"]) {
			against = name
		}
		relation = "each time " + bearer + " makes an attack against " + against
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
	previous := selectionRefName(replacement["reference"], persistentDesignationName(e["designation"], sel["scope"]))
	label := persistentDesignationLabel(e["designation"], sel["scope"])
	embarked := ""
	if jsTruthy(sel["allow_while_embarked"]) {
		embarked = ". This selection can be made while this unit is embarked"
	}
	must := "you must"
	if jsTruthy(replacement["optional"]) {
		must = "you may"
	}
	return "when " + previous + " is destroyed, " + must + " select one new enemy unit" + label +
		" to replace this bearer unit's existing designation" + selectionBinding(sel) +
		". Its existing effects apply to the new target without changing the designation's battle-end expiry" + embarked
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
	it := "it"
	if sel["selection_mode"] == "any-number" {
		it = "them"
	}
	return ", binding " + it + " as " + dekebab(strings.ReplaceAll(b, "_", "-"))
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
	selectLead := "select"
	if jsTruthy(sel["timing"]) {
		selectLead = describeTiming(sel["timing"]) + ", select"
	}
	_, durTrail := durationClauses(e["duration"])
	applies := mapOr(e["applies"])
	when := designateTargetWhen(applies, false)
	whenClause := when
	if durTrail != "" {
		whenClause = durTrail + ", " + when
	}
	recipientCtx := designatedRecipientContext(applies, ctx)
	return selectLead + " one " + designationTargetSubject(sel) + desig + "; " + whenClause + ", " + describeEffectInline(mapOr(applies["effect"]), recipientCtx)
}

func designateTargetBlock(e map[string]any, indent, arrow string, depth int, ctx effCtx) string {
	sel := designationSelect(e)
	desig := ""
	if jsTruthy(e["designation"]) {
		desig = designationLabel(e["designation"])
	}
	applies := mapOr(e["applies"])
	inner := mapOr(applies["effect"])
	selectLead := "Select"
	if jsTruthy(sel["timing"]) {
		selectLead = capitalize(describeTiming(sel["timing"])) + ", select"
	}
	_, durTrail := durationClauses(e["duration"])
	when := designateTargetWhen(applies, true)
	whenClause := capitalize(when)
	if durTrail != "" {
		whenClause = capitalize(durTrail) + ", " + when
	}
	head := indent + arrow + selectLead + " one " + designationTargetSubject(sel) + desig + ". " + whenClause
	recipientCtx := designatedRecipientContext(applies, ctx)
	if containerTypes[ejstrType(inner)] {
		return head + ":\n" + describeEffect(inner, depth+1, recipientCtx)
	}
	return head + ", " + describeEffectInline(inner, recipientCtx) + "."
}
