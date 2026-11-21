package wh40kdc

// equipableByNonCharacter reports whether a unit that is not a CHARACTER may be given the
// enhancement: an Upgrade, or one the record marks equipable (mirror of TS
// equipableByNonCharacter).
func equipableByNonCharacter(enhancement map[string]any) bool {
	return enhancement["upgrade_tag"] == true || enhancement["equipable_by_non_character"] == true
}

// missingRequiredWargear returns the weapons an enhancement requires (required_wargear_ids) that
// the bearer's chosen loadout counts do not carry, in the record's order (mirror of TS
// missingRequiredWargear).
func missingRequiredWargear(enhancement map[string]any, counts map[string]int) []string {
	var missing []string
	for _, id := range getStrList(enhancement, "required_wargear_ids") {
		if counts[id] <= 0 {
			missing = append(missing, id)
		}
	}
	return missing
}

// attachmentGateContext holds the roster facts an attachment group's detachment and
// shared-keyword gates read.
type attachmentGateContext struct {
	presentUnitIDs    map[string]struct{}
	detachmentIDs     []string
	leaderKeywords    map[string]struct{}
	bodyguardKeywords map[string]struct{}
}

// groupGatesHold reports whether a group's required detachment is selected, its excluded
// detachment is not, and both the leader and the bodyguard carry its required shared keyword.
func groupGatesHold(group map[string]any, ctx attachmentGateContext) bool {
	if required, ok := group["required_detachment_id"].(string); ok && !contains(ctx.detachmentIDs, required) {
		return false
	}
	if excluded, ok := group["excluded_detachment_id"].(string); ok && contains(ctx.detachmentIDs, excluded) {
		return false
	}
	keyword, ok := group["required_shared_keyword"].(string)
	if !ok {
		return true
	}
	_, leaderHas := ctx.leaderKeywords[keyword]
	_, bodyguardHas := ctx.bodyguardKeywords[keyword]
	return leaderHas && bodyguardHas
}

// attachmentGatesHold reports whether leaderID may join bodyguardID under the roster's
// detachment and shared-keyword gates: true when an unconditional id or keyword clause admits the
// bodyguard or a roster-applicable conditional group listing it has its gates hold; false when
// every such group fails a gate. A bodyguard no group lists is true here (eligibility itself is
// checked elsewhere). Mirror of TS attachmentGatesHold.
func attachmentGatesHold(ds *Dataset, leaderID, bodyguardID string, ctx attachmentGateContext) bool {
	bodyguard, bodyguardOK := ds.Units.GetAny(bodyguardID)
	gated := false
	for _, laAny := range ds.LeaderAttachments {
		la, _ := asMap(laAny)
		if getStr(la, "leader_id") != leaderID {
			continue
		}
		if contains(getStrList(la, "eligible_bodyguard_ids"), bodyguardID) ||
			(bodyguardOK && matchesBodyguardKeywords(la, bodyguard.Raw)) {
			return true
		}
		for _, groupAny := range getList(la, "conditional_groups") {
			group, ok := asMap(groupAny)
			if !ok || !contains(getStrList(group, "eligible_bodyguard_ids"), bodyguardID) ||
				!conditionalAttachmentGroupApplies(group, ctx.presentUnitIDs) {
				continue
			}
			if groupGatesHold(group, ctx) {
				return true
			}
			gated = true
		}
	}
	return !gated
}
