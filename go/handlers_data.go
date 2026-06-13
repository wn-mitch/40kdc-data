package wh40kdc

import "sort"

// handleLinkedQuery dispatches the Dataset read-path queries. Go mirror of
// python runner._handle_linked_query.
func (s *RunnerState) handleLinkedQuery(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("linked_query args must be an object"))
	}
	query, ok := a["query"].(string)
	if !ok {
		return errResp("INVALID_INPUT", detail("linked_query.query must be a string"))
	}
	ds := s.dataset()
	in, _ := asMap(a["input"])
	if in == nil {
		in = map[string]any{}
	}
	unitID := getStr(in, "unitId")

	unknownUnit := func() map[string]any {
		return errResp("UNKNOWN_ENTITY", map[string]any{"kind": "unit", "id": in["unitId"]})
	}

	switch query {
	case "find_unit":
		if u, ok := ds.Units.Find(getStr(in, "query")); ok {
			return okResp(u.ID())
		}
		return okResp(nil)
	case "find_weapon":
		if w, ok := ds.Weapons.Find(getStr(in, "query")); ok {
			return okResp(w.ID())
		}
		return okResp(nil)
	case "find_faction":
		if f, ok := ds.Factions.Find(getStr(in, "query")); ok {
			return okResp(f.ID())
		}
		return okResp(nil)
	case "find_ability":
		if ab, ok := ds.Abilities.Find(getStr(in, "query")); ok {
			return okResp(ab.ID())
		}
		return okResp(nil)
	case "abilities_of":
		u, ok := ds.Units.Get(unitID)
		if !ok {
			return unknownUnit()
		}
		return okResp(idsOfAbilities(u.Abilities()))
	case "weapons_of":
		u, ok := ds.Units.Get(unitID)
		if !ok {
			return unknownUnit()
		}
		return okResp(idsOfWeapons(u.Weapons()))
	case "wargear_options_of":
		u, ok := ds.Units.Get(unitID)
		if !ok {
			return unknownUnit()
		}
		out := []any{}
		for _, o := range u.WargearOptions() {
			out = append(out, getStr(o.(map[string]any), "id"))
		}
		return okResp(out)
	case "maximal_loadout":
		u, ok := ds.Units.Get(unitID)
		if !ok {
			return unknownUnit()
		}
		modelCount := asInt(in["modelCount"])
		lo := maximalLoadout(u.Raw, modelCount, ds.wargearOptionsOf(u.Raw))
		strs := make([]string, 0, len(lo))
		for id, n := range lo {
			strs = append(strs, id+":"+itoa(n))
		}
		sort.Strings(strs)
		return okResp(toAnyList(strs))
	case "phases_of":
		ab, ok := ds.Abilities.Get(getStr(in, "abilityId"))
		if !ok {
			return errResp("UNKNOWN_ENTITY", map[string]any{"kind": "ability", "id": in["abilityId"]})
		}
		return okResp(toAnyList(ab.Phases()))
	case "faction_of":
		u, ok := ds.Units.Get(unitID)
		if !ok {
			return unknownUnit()
		}
		if f, ok := u.Faction(); ok {
			return okResp(f.ID())
		}
		return okResp(nil)
	case "base_size_of":
		u, ok := ds.Units.Get(unitID)
		if !ok {
			return unknownUnit()
		}
		bs, _ := getMap(u.Raw, "base_size_mm")
		if enc, ok := encodeBase(bs); ok {
			return okResp(enc)
		}
		return okResp(nil)
	case "model_bases_of":
		if _, ok := ds.Units.Get(unitID); !ok {
			return unknownUnit()
		}
		var comp map[string]any
		for _, cAny := range ds.UnitCompositions {
			c, _ := asMap(cAny)
			if getStr(c, "unit_id") == unitID {
				comp = c
				break
			}
		}
		out := []any{}
		for _, mAny := range getList(comp, "models") {
			m, _ := asMap(mAny)
			bs, _ := getMap(m, "base_size_mm")
			enc, ok := encodeBase(bs)
			if !ok {
				enc = "none"
			}
			out = append(out, getStr(m, "name")+"="+enc)
		}
		return okResp(out)
	case "abilities_of_faction":
		return okResp(idsOfAbilities(ds.Abilities.ByFaction(getStr(in, "factionId"))))
	case "weapons_of_faction":
		f, ok := ds.Factions.Get(getStr(in, "factionId"))
		if !ok {
			return errResp("UNKNOWN_ENTITY", map[string]any{"kind": "faction", "id": in["factionId"]})
		}
		return okResp(idsOfWeapons(f.Weapons()))
	case "units_with_keyword":
		out := []any{}
		for _, u := range ds.unitsWithKeyword(getStr(in, "keyword")) {
			out = append(out, u.ID())
		}
		return okResp(out)
	case "allies_for":
		detIDs := getStrList(in, "detachmentIds")
		out := []any{}
		for _, r := range ds.alliesFor(getStr(in, "factionId"), detIDs) {
			out = append(out, getStr(r.(map[string]any), "id"))
		}
		return okResp(out)
	case "ally_units_for":
		out := []any{}
		for _, u := range ds.allyUnitsFor(getStr(in, "ruleId")) {
			out = append(out, u.ID())
		}
		return okResp(out)
	default:
		return errResp("INVALID_INPUT", detail("unknown linked_query: "+query))
	}
}

func (s *RunnerState) handleMatchAppliesTo(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("match_applies_to args must be an object"))
	}
	units := getList(a, "units")
	if units == nil {
		if _, isList := a["units"].([]any); !isList {
			return errResp("INVALID_INPUT", detail("match_applies_to.units must be an array"))
		}
	}
	appliesTo, _ := getMap(a, "applies_to")
	matched := []any{}
	for _, uAny := range units {
		u, _ := asMap(uAny)
		owned := append(getStrList(u, "keywords"), getStrList(u, "faction_keywords")...)
		if unitMatchesAppliesTo(appliesTo, owned) {
			matched = append(matched, getStr(u, "id"))
		}
	}
	return okResp(map[string]any{"matchedIds": matched})
}

func idsOfAbilities(xs []*AbilityView) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x.ID()
	}
	return out
}

func idsOfWeapons(xs []*WeaponView) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x.ID()
	}
	return out
}

func toAnyList(xs []string) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}
