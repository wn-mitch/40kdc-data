package wh40kdc

import "strings"

// Keyword reading for the abilities resolver: which units a Stratagem can target, which units a
// rule's applies_to admits, and which abilities a unit's standing rules suppress.

// stratagemSelectsModel reports whether a stratagem's friendly target is one model rather
// than a unit.
func stratagemSelectsModel(stratagem map[string]any) bool {
	for _, target := range stratagemTargets(stratagem) {
		if getStr(target, "side") != "enemy" && getStr(target, "selects") == "model" {
			return true
		}
	}
	return false
}

// stratagemTargets is a stratagem's target_restrictions as a list (one object or several).
func stratagemTargets(stratagem map[string]any) []map[string]any {
	var targets []map[string]any
	switch raw := stratagem["target_restrictions"].(type) {
	case map[string]any:
		targets = []map[string]any{raw}
	case []any:
		for _, item := range raw {
			if target, ok := item.(map[string]any); ok {
				targets = append(targets, target)
			}
		}
	}
	return targets
}

// stratagemCanTarget reports whether a unit with keywords (lower-cased) can be a stratagem's
// friendly target. A stratagem with no friendly target (none printed, or only enemy targets) does
// not restrict its user here; with several friendly targets, matching any one is enough. The
// resolver does not know which model is the Warlord, so a Warlord target only needs a unit that
// could contain it: one with CHARACTER, the keyword every Warlord carries. Mirrors TS
// stratagemCanTarget.
func stratagemCanTarget(stratagem map[string]any, keywords map[string]bool) bool {
	return stratagemCanTargetUnit(stratagem, []map[string]bool{keywords}, nil, nil)
}

// stratagemCanTargetUnit reports whether a unit of members (each member's keywords: a unit and
// the units attached to it) can be a stratagem's friendly target, as stratagemCanTarget. A target
// that selects a model needs one member that meets it alone; a unit target reads every member as
// one combined unit. A target bound to the triggering unit is also held to the keyword lists of
// triggerSubject (its ability's trigger.subject). A keyword that subject requires and no datasheet
// prints (printed says which do; nil means every keyword is printed) is gained in play, so it is
// not held against a unit. Keywords compare by NormalizeName. Mirrors TS stratagemCanTargetUnit.
func stratagemCanTargetUnit(stratagem map[string]any, members []map[string]bool, triggerSubject any, printed func(string) bool) bool {
	targets := stratagemTargets(stratagem)
	var friendly []map[string]any
	for _, target := range targets {
		if getStr(target, "side") != "enemy" {
			friendly = append(friendly, target)
		}
	}
	if len(friendly) == 0 {
		return true
	}
	holds := targetHolds(members, triggerSubject, printed)
	for _, target := range friendly {
		if holds(target) {
			return true
		}
	}
	return false
}

// stratagemTargetNames reports, for a Stratagem with several targets (an array target_restrictions),
// whether a unit of members can be each named friendly target, read as stratagemCanTargetUnit reads
// each target: what {stratagem_target: name} resolves to when the Stratagem is used on that unit.
// Enemy targets are not listed. Mirrors TS stratagemTargetNames.
func stratagemTargetNames(stratagem map[string]any, members []map[string]bool, triggerSubject any, printed func(string) bool) map[string]bool {
	out := map[string]bool{}
	if _, listed := stratagem["target_restrictions"].([]any); !listed {
		return out
	}
	holds := targetHolds(members, triggerSubject, printed)
	for _, target := range stratagemTargets(stratagem) {
		if name, named := target["name"].(string); named && getStr(target, "side") != "enemy" {
			out[name] = holds(target)
		}
	}
	return out
}

// targetHolds reports whether a unit of members meets one friendly Stratagem target.
func targetHolds(members []map[string]bool, triggerSubject any, printed func(string) bool) func(map[string]any) bool {
	normalized := make([]map[string]bool, 0, len(members))
	combined := map[string]bool{}
	for _, member := range members {
		own := map[string]bool{}
		for keyword := range member {
			own[NormalizeName(keyword)] = true
			combined[NormalizeName(keyword)] = true
		}
		normalized = append(normalized, own)
	}
	subject := friendlySubject(triggerSubject)
	return func(target map[string]any) bool {
		candidates := []map[string]bool{combined}
		if getStr(target, "selects") == "model" {
			candidates = normalized
		}
		for _, keywords := range candidates {
			has := func(keyword string) bool { return keywords[NormalizeName(keyword)] }
			gained := func(keyword string) bool { return has(keyword) || (printed != nil && !printed(keyword)) }
			if warlord, _ := target["warlord"].(bool); warlord && !has("character") {
				continue
			}
			if !keywordListsHold(target, has, has) {
				continue
			}
			if eligibilityKeywords(target["eligibility"], gained, has) == verdictFails {
				continue
			}
			if getStr(target, "bound_to") == "triggering-unit" && subject != nil && !keywordListsHold(subject, gained, has) {
				continue
			}
			return true
		}
		return false
	}
}

// friendlySubject is a trigger subject's keyword lists when it names a friendly unit, else nil.
func friendlySubject(subject any) map[string]any {
	raw, ok := subject.(map[string]any)
	if !ok {
		return nil
	}
	if owner, present := raw["owner"]; present && owner != "friendly" {
		return nil
	}
	return map[string]any{
		"required_keywords":     raw["all_of"],
		"required_keywords_any": raw["any_of"],
		"excluded_keywords":     raw["none_of"],
	}
}

// keywordListsHold reports whether a target's required lists hold by required and none of its
// excluded keywords holds by excluded.
func keywordListsHold(target map[string]any, required, excluded func(string) bool) bool {
	for _, keyword := range getStrList(target, "required_keywords") {
		if !required(keyword) {
			return false
		}
	}
	if anyOf := getStrList(target, "required_keywords_any"); len(anyOf) > 0 {
		matched := false
		for _, keyword := range anyOf {
			matched = matched || required(keyword)
		}
		if !matched {
			return false
		}
	}
	for _, keyword := range getStrList(target, "excluded_keywords") {
		if excluded(keyword) {
			return false
		}
	}
	return true
}

// printedKeyword reports whether some datasheet prints a keyword (unit, faction or conditional
// keyword),
// memoised per lookup. It reads the "all" view: a keyword printed only on a Combat Patrol (or
// other non-matched-play) datasheet is still printed.
func (ds *Dataset) printedKeyword() func(string) bool {
	seen := map[string]bool{}
	return func(keyword string) bool {
		key := NormalizeName(keyword)
		if found, ok := seen[key]; ok {
			return found
		}
		found := false
		for _, unit := range ds.allModes().Units.All() {
			for _, own := range unitKeywordNames(unit.Raw) {
				if NormalizeName(own) == key {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		seen[key] = found
		return found
	}
}

// unitKeywordNames is every keyword a datasheet prints: its keywords, faction keywords, and
// conditional keywords whatever their detachment.
func unitKeywordNames(raw map[string]any) []string {
	out := append(append([]string{}, getStrList(raw, "keywords")...), getStrList(raw, "faction_keywords")...)
	for _, entryAny := range getList(raw, "conditional_keywords") {
		if entry, ok := asMap(entryAny); ok && entry != nil {
			if keyword, ok := entry["keyword"].(string); ok {
				out = append(out, keyword)
			}
		}
	}
	return out
}

// memberKeywords is a member's keywords, lower-cased: its datasheet and faction keywords, plus each
// conditional keyword with no required detachment or whose required detachment is detachmentID.
// A nil member has none.
func memberKeywords(member *UnitView, detachmentID string) map[string]bool {
	keywords := map[string]bool{}
	if member == nil {
		return keywords
	}
	for _, keyword := range append(getStrList(member.Raw, "keywords"), getStrList(member.Raw, "faction_keywords")...) {
		keywords[strings.ToLower(keyword)] = true
	}
	for _, entryAny := range getList(member.Raw, "conditional_keywords") {
		entry, ok := asMap(entryAny)
		if !ok || entry == nil {
			continue
		}
		keyword, ok := entry["keyword"].(string)
		if !ok {
			continue
		}
		required := entry["required_detachment_id"]
		if own, named := required.(string); required == nil || (named && detachmentID != "" && own == detachmentID) {
			keywords[strings.ToLower(keyword)] = true
		}
	}
	return keywords
}

// keywordVerdict is a three-way verdict: a keyword check that holds, fails, or cannot be decided
// from keywords alone.
type keywordVerdict int8

const (
	verdictUndecided keywordVerdict = iota
	verdictHolds
	verdictFails
)

func verdictOf(holds bool) keywordVerdict {
	if holds {
		return verdictHolds
	}
	return verdictFails
}

// combinedHas reports, by NormalizeName, whether any member has a keyword: the members read as one
// combined unit.
func combinedHas(members []map[string]bool) func(string) bool {
	combined := map[string]bool{}
	for _, member := range members {
		for keyword := range member {
			combined[NormalizeName(keyword)] = true
		}
	}
	return func(keyword string) bool { return combined[NormalizeName(keyword)] }
}

// appliesToUnit reports whether a rule's applies_to admits a unit of members, read as one combined
// unit. An absent (non-object) filter admits every unit, as does one that is not only keyword
// lists. A required keyword no datasheet prints is one the army gains in play, so it is not held
// against the unit, as for a Stratagem's WHEN. Mirrors TS appliesToUnit.
func appliesToUnit(filter any, members []map[string]bool, printed func(string) bool) bool {
	predicate, ok := asMap(filter)
	if !ok || predicate == nil {
		return true
	}
	has := combinedHas(members)
	required := func(keyword string) bool { return has(keyword) || !printed(keyword) }
	return keywordPredicateHolds(predicate, required, has) != verdictFails
}

// keywordPredicateHolds is a static keyword predicate's verdict: all_of each held by required,
// any_of one held by required, none_of none held by excluded, not_all_of not all held by excluded.
// It is undecided when the filter names anything but those lists and a friendly owner.
func keywordPredicateHolds(filter map[string]any, required, excluded func(string) bool) keywordVerdict {
	for key := range filter {
		switch key {
		case "all_of", "any_of", "none_of", "not_all_of", "owner":
		default:
			return verdictUndecided
		}
	}
	if owner, present := filter["owner"]; present && owner != "friendly" {
		return verdictUndecided
	}
	for _, keyword := range getStrList(filter, "all_of") {
		if !required(keyword) {
			return verdictFails
		}
	}
	if anyOf := getStrList(filter, "any_of"); len(anyOf) > 0 {
		matched := false
		for _, keyword := range anyOf {
			matched = matched || required(keyword)
		}
		if !matched {
			return verdictFails
		}
	}
	for _, keyword := range getStrList(filter, "none_of") {
		if excluded(keyword) {
			return verdictFails
		}
	}
	if notAllOf := getStrList(filter, "not_all_of"); len(notAllOf) > 0 {
		all := true
		for _, keyword := range notAllOf {
			all = all && excluded(keyword)
		}
		if all {
			return verdictFails
		}
	}
	return verdictHolds
}

// eligibilityKeywords is the verdict of a Stratagem target's eligibility (or a conditional's
// condition) on the unit's own keywords: each matches on this-unit (or with no subject) whose
// filter is only keyword lists is decided by keywordPredicateHolds, and/or/not combine verdicts,
// and anything else (battlefield state, history) is undecided. Undecided never refuses the target.
// Mirrors TS eligibilityKeywords.
func eligibilityKeywords(condition any, required, excluded func(string) bool) keywordVerdict {
	node, ok := asMap(condition)
	if !ok || node == nil {
		return verdictUndecided
	}
	operator, isOperator := node["operator"].(string)
	operands, hasOperands := asList(node["operands"])
	if isOperator && hasOperands {
		values := make([]keywordVerdict, 0, len(operands))
		for _, operand := range operands {
			values = append(values, eligibilityKeywords(operand, required, excluded))
		}
		count := func(want keywordVerdict) int {
			n := 0
			for _, value := range values {
				if value == want {
					n++
				}
			}
			return n
		}
		switch {
		case operator == "and" && count(verdictFails) > 0:
			return verdictFails
		case operator == "and" && count(verdictHolds) == len(values):
			return verdictHolds
		case operator == "or" && count(verdictHolds) > 0:
			return verdictHolds
		case operator == "or" && count(verdictFails) == len(values):
			return verdictFails
		case operator == "not" && len(values) == 1 && values[0] != verdictUndecided:
			return verdictOf(values[0] == verdictFails)
		}
		return verdictUndecided
	}
	if node["type"] != "matches" {
		return verdictUndecided
	}
	params, ok := asMap(node["parameters"])
	if !ok || params == nil {
		return verdictUndecided
	}
	if subject, present := params["subject"]; present && subject != "this-unit" {
		return verdictUndecided
	}
	filter, ok := asMap(params["filter"])
	if !ok || filter == nil {
		return verdictUndecided
	}
	return keywordPredicateHolds(filter, required, excluded)
}

// standingSources are the source kinds whose rules hold for the unit without a player choosing
// them in play.
var standingSources = map[string]bool{"army": true, "detachment": true, "unit": true, "attached": true}

// suppressedAbilityIDs is the abilities the unit's standing rules suppress: a rule-state that
// suppresses an ability (named by id) for this unit, or for friendly units whose keywords the unit
// has, reached through sequences, rules bundles, and conditionals whose condition is only keyword
// checks on the unit that hold. A Stratagem's, a supporting unit's, or a triggered or
// battlefield-conditioned suppression is left to play. Mirrors TS suppressedAbilityIds.
func suppressedAbilityIDs(entries []map[string]any, members []map[string]bool, printed func(string) bool) map[string]bool {
	has := combinedHas(members)
	required := func(keyword string) bool { return has(keyword) || !printed(keyword) }
	out := map[string]bool{}
	var walk func(node any)
	walk = func(node any) {
		if list, ok := asList(node); ok {
			for _, child := range list {
				walk(child)
			}
			return
		}
		effect, ok := asMap(node)
		if !ok || effect == nil {
			return
		}
		switch effect["type"] {
		case "conditional":
			if eligibilityKeywords(effect["condition"], required, has) == verdictHolds {
				walk(effect["effect"])
			}
			return
		case "sequence", "rules-bundle":
			walk(effect["steps"])
			return
		case "rule-state":
		default:
			return
		}
		modifier, ok := asMap(effect["modifier"])
		if !ok || modifier == nil || modifier["direction"] != "suppressed" || modifier["rule_kind"] != "ability" {
			return
		}
		rule, ok := modifier["rule"].(string)
		if !ok {
			return
		}
		reaches := effect["target"] == "this-unit"
		if target, isFilter := asMap(effect["target"]); isFilter && target != nil {
			reaches = keywordPredicateHolds(target, required, has) == verdictHolds
		}
		if reaches {
			out[rule] = true
		}
	}
	for _, entry := range entries {
		ability := entry["ability"].(*AbilityView)
		if standingSources[getStr(entry["source"].(map[string]any), "kind")] && ability.Raw["trigger"] == nil {
			walk(ability.Raw["effect"])
		}
	}
	return out
}

// hasFriendlyTarget reports whether a Stratagem names a friendly target in target_restrictions.
func hasFriendlyTarget(stratagem map[string]any) bool {
	for _, target := range stratagemTargets(stratagem) {
		if getStr(target, "side") != "enemy" {
			return true
		}
	}
	return false
}
