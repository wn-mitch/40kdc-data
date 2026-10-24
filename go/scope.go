package wh40kdc

import "strings"

// Roster-highlighting scope: resolve which units an ability (typically a
// detachment rule) benefits, from its curated applies_to keyword filter.
//
// A unit matches iff it satisfies each present canonical keyword predicate:
// all_of requires every keyword, any_of requires at least one, none_of forbids
// every listed keyword, and not_all_of forbids the complete listed set.
// Two distinct "no constraint" forms remain: nil matches nothing, while a
// present empty predicate matches every unit.
// Go mirror of python .../scope.py; pinned by conformance/applies-to.

// unitMatchesAppliesTo reports whether a unit owning ownedKeywords (the union
// of its keywords and faction_keywords) falls within appliesTo's scope.
func unitMatchesAppliesTo(appliesTo map[string]any, ownedKeywords []string) bool {
	if appliesTo == nil {
		return false
	}
	owned := map[string]struct{}{}
	for _, k := range ownedKeywords {
		owned[keywordKey(k)] = struct{}{}
	}
	has := func(kw any) bool {
		s, ok := kw.(string)
		if !ok {
			return false
		}
		_, ok = owned[keywordKey(s)]
		return ok
	}
	if values, ok := asList(appliesTo["all_of"]); ok {
		for _, kw := range values {
			if !has(kw) {
				return false
			}
		}
	}
	if values, ok := asList(appliesTo["any_of"]); ok {
		found := false
		for _, kw := range values {
			if has(kw) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if values, ok := asList(appliesTo["none_of"]); ok {
		for _, kw := range values {
			if has(kw) {
				return false
			}
		}
	}
	if values, ok := asList(appliesTo["not_all_of"]); ok {
		all := true
		for _, kw := range values {
			if !has(kw) {
				all = false
				break
			}
		}
		if all {
			return false
		}
	}
	return true
}

// keywordKey is how two keyword spellings compare: uppercase, with a curly
// apostrophe read as a straight one.
func keywordKey(keyword string) string {
	return strings.ReplaceAll(strings.ToUpper(keyword), "’", "'")
}

// abilityAppliesToUnit unions the unit's keywords and faction_keywords and
// applies the filter.
func abilityAppliesToUnit(appliesTo map[string]any, unit map[string]any) bool {
	owned := append(getStrList(unit, "keywords"), getStrList(unit, "faction_keywords")...)
	return unitMatchesAppliesTo(appliesTo, owned)
}
