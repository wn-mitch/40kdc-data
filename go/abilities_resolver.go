package wh40kdc

import "strings"

// Walks the dataset for every ability that could apply to a chosen unit in a
// chosen phase. Go mirror of python .../abilities_resolver.py. Entries are
// map[string]any{"ability": *AbilityView, "source": map, "phases": []string}.

func (ds *Dataset) resolveUnitScoped(id, fid string) (*UnitView, bool) {
	if fid != "" {
		if scoped, ok := ds.Units.GetInFaction(id, fid); ok {
			return scoped, true
		}
	}
	return ds.Units.GetAny(id)
}

func resolveEligibleAbilities(ds *Dataset, input map[string]any, phase string) []map[string]any {
	unit, ok := ds.resolveUnitScoped(getStr(input, "unitId"), getStr(input, "factionId"))
	if !ok {
		return nil
	}
	factionID := getStr(input, "factionId")
	if factionID == "" {
		factionID = getStr(unit.Raw, "faction_id")
	}
	seen := map[string]struct{}{}
	var out []map[string]any

	pushUnique := func(entry map[string]any) {
		source := entry["source"].(map[string]any)
		ability := entry["ability"].(*AbilityView)
		key := getStr(source, "kind") + "::" + ability.ID()
		if _, dup := seen[key]; dup {
			return
		}
		seen[key] = struct{}{}
		out = append(out, entry)
	}

	phaseMatches := func(ability *AbilityView) bool {
		phases := ability.Phases()
		return len(phases) == 0 || contains(phases, phase)
	}
	intersect := func(phases []string) []string {
		if contains(phases, phase) {
			return []string{phase}
		}
		return phases
	}

	// 1. Army. One with a detachment_id (a Combat Patrol box's own army rule) applies only in
	// that detachment, and there it replaces each army rule it names with an interactions entry
	// of type "replaces". In a Combat Patrol detachment only the army rules it lists apply.
	army := []*AbilityView{}
	replaced := map[string]bool{}
	for _, ability := range ds.Abilities.ByFaction(factionID) {
		if getStr(ability.Raw, "ability_type") != "faction" {
			continue
		}
		if own := getStr(ability.Raw, "detachment_id"); own != "" && own != getStr(input, "detachmentId") {
			continue
		}
		army = append(army, ability)
		interactions, _ := ability.Raw["interactions"].([]any)
		for _, entryAny := range interactions {
			if entry, ok := asMap(entryAny); ok && getStr(entry, "type") == "replaces" {
				replaced[getStr(entry, "ability_ref")] = true
			}
		}
	}
	// A Combat Patrol detachment's detachment_rule_ids are its complete army-rule set.
	if patrol, ok := ds.combatPatrolDetachment(getStr(input, "detachmentId"), factionID); ok {
		listed := map[string]bool{}
		for _, id := range getStrList(patrol, "detachment_rule_ids") {
			listed[id] = true
		}
		for _, ability := range army {
			if id := getStr(ability.Raw, "ability_id"); !listed[id] {
				replaced[id] = true
			}
		}
	}
	for _, ability := range army {
		if replaced[getStr(ability.Raw, "ability_id")] || !phaseMatches(ability) {
			continue
		}
		pushUnique(map[string]any{"ability": ability, "source": map[string]any{"kind": "army"}, "phases": intersect(ability.Phases())})
	}

	detachmentID := getStr(input, "detachmentId")
	if detachmentID != "" {
		// 2. Detachment abilities.
		for _, ability := range ds.Abilities.All() {
			if getStr(ability.Raw, "ability_type") != "detachment" {
				continue
			}
			if getStr(ability.Raw, "detachment_id") != detachmentID || !phaseMatches(ability) {
				continue
			}
			pushUnique(map[string]any{"ability": ability, "source": map[string]any{"kind": "detachment", "detachmentId": detachmentID}, "phases": intersect(ability.Phases())})
		}
		// 3. Detachment stratagems.
		// Shared Codex detachment ids resolve within the requesting faction,
		// falling back first-wins (mirrors the TS resolver).
		detAny, ok := ds.Detachments.GetInFaction(detachmentID, factionID)
		if !ok {
			detAny, ok = ds.Detachments.GetAny(detachmentID)
		}
		if ok {
			// Each member's keywords; a unit target reads them as one combined unit.
			members := []*UnitView{unit}
			for _, memberID := range getStrList(input, "attachedUnitIds") {
				if member, ok := ds.resolveUnitScoped(memberID, factionID); ok {
					members = append(members, member)
				}
			}
			memberKeywords := make([]map[string]bool, 0, len(members))
			for _, member := range members {
				keywords := map[string]bool{}
				for _, keyword := range append(getStrList(member.Raw, "keywords"), getStrList(member.Raw, "faction_keywords")...) {
					keywords[strings.ToLower(keyword)] = true
				}
				memberKeywords = append(memberKeywords, keywords)
			}
			printed := ds.printedKeyword()
			det := detAny.(map[string]any)
			for _, stratID := range getStrList(det, "stratagem_ids") {
				stratAny, ok := ds.Stratagems.Get(stratID)
				if !ok {
					continue
				}
				stratagem := stratAny.(map[string]any)
				stratPhases := getStrList(stratagem, "phases")
				if len(stratPhases) == 0 || !contains(stratPhases, phase) {
					continue
				}
				abilityID, ok := stratagem["ability_id"].(string)
				if !ok {
					continue
				}
				// Ability ids are unique: one record per stratagem, wherever its detachment is replicated.
				stratAbility, ok := ds.Abilities.Get(abilityID)
				if !ok {
					continue
				}
				trigger, _ := stratAbility.Raw["trigger"].(map[string]any)
				if !stratagemCanTargetUnit(stratagem, memberKeywords, trigger["subject"], printed) {
					continue
				}
				stratagemSource := map[string]any{
					"kind": "detachment-stratagem", "stratagemId": getStr(stratagem, "id"),
					"cpCost": stratagem["cp_cost"],
				}
				if stratagemSelectsModel(stratagem) {
					stratagemSource["selectsModel"] = true
				}
				pushUnique(map[string]any{
					"ability": stratAbility,
					"source":  stratagemSource,
					"phases":  []string{phase},
				})
			}
		}
	}

	// 4. Unit's own abilities.
	for _, ability := range unit.Abilities() {
		if !phaseMatches(ability) {
			continue
		}
		pushUnique(rated(map[string]any{"ability": ability, "source": map[string]any{"kind": "unit", "unitId": getStr(input, "unitId")}, "phases": intersect(ability.Phases())}, unit, ability))
	}

	// 5. Attached members.
	for _, memberID := range getStrList(input, "attachedUnitIds") {
		member, ok := ds.resolveUnitScoped(memberID, factionID)
		if !ok {
			continue
		}
		for _, ability := range member.Abilities() {
			if !phaseMatches(ability) {
				continue
			}
			pushUnique(rated(map[string]any{"ability": ability, "source": map[string]any{"kind": "attached", "unitId": memberID}, "phases": intersect(ability.Phases())}, member, ability))
		}
	}

	// 6. Supporting units — only abilities that can reach another unit (an aura,
	// a friendly or enemy unit filter, a unit selection); an ability that only
	// names its own unit describes a buff that never reaches the input unit.
	for _, supportID := range getStrList(input, "supportingUnitIds") {
		supporter, ok := ds.resolveUnitScoped(supportID, factionID)
		if !ok {
			continue
		}
		for _, ability := range supporter.Abilities() {
			if !phaseMatches(ability) {
				continue
			}
			if !reachesOtherUnits(ability.Raw["effect"]) {
				continue
			}
			pushUnique(rated(map[string]any{"ability": ability, "source": map[string]any{"kind": "support", "sourceUnitId": supportID}, "phases": intersect(ability.Phases())}, supporter, ability))
		}
	}
	return out
}

// rated adds the rating the owning unit prints for a rated rule (Feel No Pain 5+ -> 5).
func rated(entry map[string]any, unit *UnitView, ability *AbilityView) map[string]any {
	if r, ok := unit.RatingOf(ability.ID()); ok {
		entry["rating"] = r
	}
	return entry
}

// reachesOtherUnits reports whether an effect can reach a unit other than its
// own: an aura, a unit-filter target (friendly or enemy), or a unit selection.
// The translator decides what of it reaches the input unit.
func reachesOtherUnits(effect any) bool {
	switch node := effect.(type) {
	case []any:
		for _, child := range node {
			if reachesOtherUnits(child) {
				return true
			}
		}
	case map[string]any:
		if node["type"] == "aura" || node["type"] == "select-units" {
			return true
		}
		if target, ok := node["target"].(map[string]any); ok && (target["owner"] == "friendly" || target["owner"] == "enemy") {
			return true
		}
		for _, child := range node {
			if reachesOtherUnits(child) {
				return true
			}
		}
	}
	return false
}

func isAuraScope(rng any) bool {
	s, ok := rng.(string)
	if !ok {
		return false
	}
	return len(s) >= 5 && s[:5] == "aura-" || s == "any-on-battlefield" || s == "any-visible"
}

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
	for _, target := range friendly {
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
			if getStr(target, "bound_to") == "triggering-unit" && subject != nil && !keywordListsHold(subject, gained, has) {
				continue
			}
			return true
		}
	}
	return false
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

// printedKeyword reports whether some datasheet prints a keyword (unit or faction keyword),
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
			for _, own := range append(getStrList(unit.Raw, "keywords"), getStrList(unit.Raw, "faction_keywords")...) {
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

// combatPatrolDetachment is the detachment detachmentID names (resolved within factionID first)
// when it is a Combat Patrol box's: its game_modes include "combat-patrol".
func (ds *Dataset) combatPatrolDetachment(detachmentID, factionID string) (map[string]any, bool) {
	if detachmentID == "" {
		return nil, false
	}
	detAny, ok := ds.Detachments.GetInFaction(detachmentID, factionID)
	if !ok {
		detAny, ok = ds.Detachments.GetAny(detachmentID)
	}
	if !ok {
		return nil, false
	}
	det, ok := detAny.(map[string]any)
	if !ok || !contains(getStrList(det, "game_modes"), "combat-patrol") {
		return nil, false
	}
	return det, true
}
