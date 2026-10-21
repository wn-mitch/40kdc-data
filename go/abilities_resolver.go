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
	// of type "replaces".
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
			// The combined unit's keywords: every member's, as one unit.
			keywords := map[string]bool{}
			members := []*UnitView{unit}
			for _, memberID := range getStrList(input, "attachedUnitIds") {
				if member, ok := ds.resolveUnitScoped(memberID, factionID); ok {
					members = append(members, member)
				}
			}
			for _, member := range members {
				for _, keyword := range append(getStrList(member.Raw, "keywords"), getStrList(member.Raw, "faction_keywords")...) {
					keywords[strings.ToLower(keyword)] = true
				}
			}
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
				if !stratagemCanTarget(stratagem, keywords) {
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
				pushUnique(map[string]any{
					"ability": stratAbility,
					"source": map[string]any{
						"kind": "detachment-stratagem", "stratagemId": getStr(stratagem, "id"),
						"cpCost": stratagem["cp_cost"],
					},
					"phases": []string{phase},
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

// stratagemCanTarget reports whether a unit with keywords (lower-cased) can be a stratagem's
// friendly target. A stratagem with no friendly target (none printed, or only enemy targets) does
// not restrict its user here; with several friendly targets, matching any one is enough. The
// resolver does not know which model is the Warlord, so a Warlord target only needs a unit that
// could contain it: one with CHARACTER, the keyword every Warlord carries. Mirrors TS
// stratagemCanTarget.
func stratagemCanTarget(stratagem map[string]any, keywords map[string]bool) bool {
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
	default:
		return true
	}
	has := func(keyword string) bool { return keywords[strings.ToLower(keyword)] }
	friendly := 0
	for _, target := range targets {
		if getStr(target, "side") == "enemy" {
			continue
		}
		friendly++
		ok := true
		if warlord, _ := target["warlord"].(bool); warlord {
			ok = has("character")
		}
		for _, keyword := range getStrList(target, "required_keywords") {
			ok = ok && has(keyword)
		}
		if anyOf := getStrList(target, "required_keywords_any"); len(anyOf) > 0 {
			matched := false
			for _, keyword := range anyOf {
				matched = matched || has(keyword)
			}
			ok = ok && matched
		}
		for _, keyword := range getStrList(target, "excluded_keywords") {
			ok = ok && !has(keyword)
		}
		if ok {
			return true
		}
	}
	return friendly == 0
}
