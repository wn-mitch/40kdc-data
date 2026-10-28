package wh40kdc

import "strings"

// historicalSnapshotAbilities rediscovers an attested ability after its former
// attachment is gone. The source must still belong to the historical owner,
// either intrinsically or through an enhancement the current detachment lets
// that owner take; snapshots never manufacture a source.
func historicalSnapshotAbilities(ds *Dataset, input, context map[string]any, perspective string) []map[string]any {
	faction := getStr(input, "factionId")
	if faction == "" {
		if unit, ok := ds.Units.GetAny(getStr(input, "unitId")); ok {
			faction = getStr(unit.Raw, "faction_id")
		}
	}
	seen := map[string]bool{}
	out := []map[string]any{}
	for _, raw := range getList(context, "recipientSnapshots") {
		snapshot, ok := asMap(raw)
		if !ok || getStr(snapshot, "perspective") != perspective || getStr(snapshot, "recipientUnitId") != getStr(input, "unitId") {
			continue
		}
		source, ok := asMap(snapshot["source"])
		if !ok || source == nil {
			continue
		}
		kind := getStr(source, "abilityKind")
		if kind != "unit" && kind != "attached" && kind != "support" {
			continue
		}
		sourceUnitID := getStr(snapshot, "sourceUnitId")
		if kind == "unit" {
			if sourceUnitID != getStr(input, "unitId") {
				continue
			}
		} else if sourceUnitID == "" || sourceUnitID != getStr(source, "sourceUnitId") {
			continue
		}
		owner, ok := ds.Units.GetInFaction(sourceUnitID, faction)
		if !ok {
			owner, ok = ds.Units.GetAny(sourceUnitID)
		}
		if !ok || owner == nil {
			continue
		}
		abilityID := getStr(source, "abilityId")
		ability, ok := ds.Abilities.GetInFaction(abilityID, faction)
		if !ok {
			ability, ok = ds.Abilities.GetInFaction(abilityID, "core")
		}
		if !ok || ability == nil {
			continue
		}
		intrinsic := false
		for _, held := range owner.Abilities() {
			if held.ID() == ability.ID() {
				intrinsic = true
				break
			}
		}
		eligibleEnhancement := false
		if !intrinsic {
			// Resolves the enhancement a (detachment, ability) pair names, so it
			// reads every game mode: a Combat Patrol detachment's enhancement
			// is hidden from the matched-play listing but still resolves.
			for _, enhancementAny := range ds.allModes().Enhancements.All() {
				enhancement, ok := asMap(enhancementAny)
				if !ok || getStr(enhancement, "ability_id") != ability.ID() || getStr(enhancement, "detachment_id") != getStr(input, "detachmentId") {
					continue
				}
				if historicalEnhancementEligible(ds, enhancement, owner) {
					eligibleEnhancement = true
					break
				}
			}
		}
		if !intrinsic && !eligibleEnhancement {
			continue
		}
		key := kind + "::" + ability.ID() + "::" + sourceUnitID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, map[string]any{"ability": ability, "source": source})
	}
	return out
}

func historicalEnhancementEligible(ds *Dataset, enhancement map[string]any, owner *UnitView) bool {
	keywords := map[string]bool{}
	for _, keyword := range append(owner.Keywords(), owner.FactionKeywords()...) {
		keywords[strings.ToLower(keyword)] = true
	}
	has := func(keyword string) bool { return keywords[strings.ToLower(keyword)] }
	if !has("character") && enhancement["upgrade_tag"] != true {
		return false
	}
	if getStr(owner.Raw, "role") == "epic-hero" || has("epic hero") {
		return false
	}
	if rows, _ := ds.unitCompositionOf(owner.Raw); len(rows) > 0 {
		allExcluded := true
		for _, raw := range rows {
			model, ok := asMap(raw)
			if !ok || model["excluded_from_enhancements"] != true {
				allExcluded = false
				break
			}
		}
		if allExcluded {
			return false
		}
	}
	if !meetsEnhancementGroups(enhancement, owner.ID(), has) {
		return false
	}
	return !historicalEnhancementExcluded(enhancement, has)
}

func historicalEnhancementExcluded(enhancement map[string]any, has func(string) bool) bool {
	for _, keyword := range getStrList(enhancement, "exclusion_keywords") {
		if has(keyword) {
			return true
		}
	}
	return false
}

func getListValue(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	return nil
}

func getStringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
