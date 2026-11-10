package wh40kdc

// Runner ops for a unit's MFM loadout at a total model count: mfm_unit,
// mfm_assignment and check_mfm_unit. Mirrors of the TS runner ops.

// mfmCompositionOf returns the op's composition when it has a loadout (nil
// otherwise), or an error response. A fabricated `composition` arg (`models`,
// optional `tiers`, `loadout`) stands in for a unit's own; without one, the
// unit resolves as check_unit_legality resolves it.
func (s *RunnerState) mfmCompositionOf(op string, args any) (map[string]any, *MfmComposition, map[string]any) {
	if a, ok := asMap(args); ok {
		if raw, present := a["composition"]; present {
			given, ok := asMap(raw)
			if _, isList := given["models"].([]any); !ok || !isList {
				return nil, nil, errResp("INVALID_INPUT", detail(op+".composition must be an object with models"))
			}
			composition, err := decodeMfmComposition(given)
			if err != nil {
				return nil, nil, errResp("INVALID_INPUT", detail(op+": malformed composition: "+err.Error()))
			}
			if composition.Loadout == nil {
				return a, nil, nil
			}
			return a, composition, nil
		}
	}
	a, u, fail := s.mfmUnitOf(op, args)
	if fail != nil {
		return nil, nil, fail
	}
	fid, uid := getStr(u.Raw, "faction_id"), getStr(u.Raw, "id")
	for _, cAny := range s.dataset().allUnitCompositions {
		c, _ := asMap(cAny)
		if getStr(c, "unit_id") != uid || getStr(c, "faction_id") != fid {
			continue
		}
		composition, err := decodeMfmComposition(c)
		if err != nil {
			return nil, nil, errResp("INVALID_INPUT", detail(op+": malformed composition: "+err.Error()))
		}
		if composition.Loadout == nil {
			return a, nil, nil
		}
		return a, composition, nil
	}
	return a, nil, nil
}

// mfmModelCountArg reads a non-negative integer argument.
func mfmModelCountArg(v any) (int, bool) {
	n, ok := v.(float64)
	if !ok || n < 0 || n != float64(int(n)) {
		return 0, false
	}
	return int(n), true
}

func mfmIntsWire(m map[string]int) map[string]any {
	out := make(map[string]any, len(m))
	for k, n := range m {
		out[k] = float64(n)
	}
	return out
}

func mfmItemsWire(items []mfmItem) []any {
	out := make([]any, len(items))
	for i, item := range items {
		out[i] = map[string]any{"id": item.ID, "count": float64(item.Count)}
	}
	return out
}

func mfmGroupsWire(configuration *MfmConfiguration) []any {
	out := make([]any, len(configuration.Groups))
	for i, group := range configuration.Groups {
		out[i] = map[string]any{"model": group.Model, "count": float64(group.Count), "items": mfmItemsWire(group.Items)}
	}
	return out
}

// mfmConfigurationWire is a configuration on the wire: its groups, the unit's
// own wargear and its counts.
func mfmConfigurationWire(configuration *MfmConfiguration) map[string]any {
	return map[string]any{
		"groups": mfmGroupsWire(configuration),
		"unit":   mfmItemsWire(configuration.Unit),
		"counts": mfmIntsWire(configuration.Counts),
	}
}

// handleMfmUnit is a unit at a total model count under its MFM loadout.
// Args: {unitId, factionId?, modelCount, limit?} (limit defaults to 4).
// Returns {rows, base, bounds, groups, candidates}, with the first four null
// and candidates empty when no tier builds the count, or null when the unit
// has no loadout.
func (s *RunnerState) handleMfmUnit(args any) map[string]any {
	a, composition, fail := s.mfmCompositionOf("mfm_unit", args)
	if fail != nil {
		return fail
	}
	modelCount, okCount := mfmModelCountArg(a["modelCount"])
	limit, okLimit := 4, true
	if raw, present := a["limit"]; present {
		limit, okLimit = mfmModelCountArg(raw)
	}
	if !okCount || !okLimit {
		return errResp("INVALID_INPUT", detail("mfm_unit.modelCount/limit must be non-negative integers"))
	}
	if composition == nil {
		return okResp(nil)
	}
	internal := func(err error) map[string]any { return errResp("INTERNAL_ERROR", detail(err.Error())) }
	value := map[string]any{"rows": nil, "base": nil, "bounds": nil, "groups": nil}
	rows := MfmRows(composition, modelCount)
	if rows != nil {
		value["rows"] = mfmIntsWire(rows)
		if counts, legal, ok := MfmBaseLoadout(composition.Loadout, rows); ok {
			value["base"] = map[string]any{"counts": mfmIntsWire(counts), "legal": legal}
			placed, err := MfmAssignment(composition.Loadout, rows, counts)
			if err != nil {
				return internal(err)
			}
			if placed != nil {
				value["groups"] = mfmGroupsWire(placed)
			}
		}
		bounds, err := MfmWeaponBounds(composition.Loadout, rows)
		if err != nil {
			return internal(err)
		}
		if bounds != nil {
			wire := make(map[string]any, len(bounds))
			for id, bound := range bounds {
				wire[id] = map[string]any{"min": float64(bound.Min), "max": float64(bound.Max)}
			}
			value["bounds"] = wire
		}
	}
	candidates, err := MfmUnitCandidates(composition, modelCount, limit)
	if err != nil {
		return internal(err)
	}
	value["candidates"] = toAnyList(candidates)
	return okResp(value)
}

// mfmUnitCountsArgs reads the modelCount and counts shared by mfm_assignment
// and check_mfm_unit, or returns an error response.
func mfmUnitCountsArgs(op string, a map[string]any) (int, map[string]int, map[string]any) {
	modelCount, okCount := mfmModelCountArg(a["modelCount"])
	counts, okCounts := mfmCountsArg(a["counts"])
	if !okCount || !okCounts {
		return 0, nil, errResp("INVALID_INPUT", detail(op+".modelCount/counts must be non-negative integers"))
	}
	return modelCount, counts, nil
}

// handleMfmAssignment is how counts sit on a unit of a total model count.
// Args: {unitId, factionId?, modelCount, counts}. Returns {groups, unit,
// counts}, or null when no legal configuration has these counts or the unit
// has no loadout.
func (s *RunnerState) handleMfmAssignment(args any) map[string]any {
	a, composition, fail := s.mfmCompositionOf("mfm_assignment", args)
	if fail != nil {
		return fail
	}
	modelCount, counts, fail := mfmUnitCountsArgs("mfm_assignment", a)
	if fail != nil {
		return fail
	}
	if composition == nil {
		return okResp(nil)
	}
	rows := MfmRows(composition, modelCount)
	if rows == nil {
		return okResp(nil)
	}
	placed, err := MfmAssignment(composition.Loadout, rows, counts)
	if err != nil {
		return errResp("INTERNAL_ERROR", detail(err.Error()))
	}
	if placed == nil {
		return okResp(nil)
	}
	return okResp(mfmConfigurationWire(placed))
}

// handleCheckMfmUnit is wargear legality at a total model count. Args:
// {unitId, factionId?, modelCount, counts}. Returns [{code, message}], or null
// when the unit has no loadout.
func (s *RunnerState) handleCheckMfmUnit(args any) map[string]any {
	a, composition, fail := s.mfmCompositionOf("check_mfm_unit", args)
	if fail != nil {
		return fail
	}
	modelCount, counts, fail := mfmUnitCountsArgs("check_mfm_unit", a)
	if fail != nil {
		return fail
	}
	if composition == nil {
		return okResp(nil)
	}
	out := []any{}
	for _, v := range MfmUnitViolations(composition, modelCount, counts) {
		out = append(out, map[string]any{"code": v.Code, "message": v.Message})
	}
	return okResp(out)
}
