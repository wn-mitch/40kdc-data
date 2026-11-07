package wh40kdc

// meetsEnhancementGroups reports whether a bearer meets one eligibility group of an enhancement
// (mirror of TS meetsEnhancementGroups). A keyword group (keyword_restriction_groups, or the flat
// keyword_restrictions as one group) needs every keyword; a datasheet_restriction_groups entry
// needs the bearer's unit to be unit_id and every listed keyword. With no group of either kind any
// bearer qualifies. Exclusions are the caller's.
func meetsEnhancementGroups(enhancement map[string]any, unitID string, has func(string) bool) bool {
	var groups [][]any
	if raw, present := enhancement["keyword_restriction_groups"]; present && raw != nil {
		list, _ := asList(raw)
		for _, rawGroup := range list {
			group, _ := asList(rawGroup)
			groups = append(groups, group)
		}
	} else if raw, present := enhancement["keyword_restrictions"]; present && raw != nil {
		group, _ := asList(raw)
		groups = append(groups, group)
	}
	datasheets, _ := asList(enhancement["datasheet_restriction_groups"])
	if len(groups) == 0 && len(datasheets) == 0 {
		return true
	}
	allHeld := func(keywords []any) bool {
		for _, rawKeyword := range keywords {
			keyword, ok := rawKeyword.(string)
			if !ok || !has(keyword) {
				return false
			}
		}
		return true
	}
	for _, group := range groups {
		if allHeld(group) {
			return true
		}
	}
	for _, rawGroup := range datasheets {
		group, ok := asMap(rawGroup)
		if !ok || getStr(group, "unit_id") != unitID {
			continue
		}
		keywords, _ := asList(group["keywords"])
		if allHeld(keywords) {
			return true
		}
	}
	return false
}

// missingRequiredAbilities returns the core abilities an enhancement requires
// (required_ability_ids, "model with the Deep Strike ability only") that the bearer's datasheet
// does not list in its ability_ids, in the record's order (mirror of TS missingRequiredAbilities).
func missingRequiredAbilities(enhancement map[string]any, bearer map[string]any) []string {
	held := map[string]bool{}
	for _, id := range unitAbilityIDs(bearer) {
		held[id] = true
	}
	var missing []string
	for _, id := range getStrList(enhancement, "required_ability_ids") {
		if !held[id] {
			missing = append(missing, id)
		}
	}
	return missing
}
