package wh40kdc

// Roster-highlighting scope: resolve which units an ability (typically a
// detachment rule) benefits, from its curated applies_to keyword filter.
//
// A unit matches iff it carries every required_keywords entry and none of the
// excluded_keywords, compared against the union of its keywords and
// faction_keywords. Matching is exact-string and case-sensitive. Two distinct
// "no constraint" forms: a nil filter matches nothing; a present filter with
// neither keyword list matches every unit.
//
// Go mirror of python .../scope.py; pinned by conformance/applies-to.

// unitMatchesAppliesTo reports whether a unit owning ownedKeywords (the union
// of its keywords and faction_keywords) falls within appliesTo's scope.
func unitMatchesAppliesTo(appliesTo map[string]any, ownedKeywords []string) bool {
	if appliesTo == nil {
		return false
	}
	owned := map[string]struct{}{}
	for _, k := range ownedKeywords {
		owned[k] = struct{}{}
	}
	for _, kw := range getStrList(appliesTo, "required_keywords") {
		if _, ok := owned[kw]; !ok {
			return false
		}
	}
	for _, kw := range getStrList(appliesTo, "excluded_keywords") {
		if _, ok := owned[kw]; ok {
			return false
		}
	}
	return true
}

// abilityAppliesToUnit unions the unit's keywords and faction_keywords and
// applies the filter.
func abilityAppliesToUnit(appliesTo map[string]any, unit map[string]any) bool {
	owned := append(getStrList(unit, "keywords"), getStrList(unit, "faction_keywords")...)
	return unitMatchesAppliesTo(appliesTo, owned)
}
