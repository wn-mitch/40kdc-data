package wh40kdc

// compare / loadout op handlers. Go mirror of the compare/loadout handlers in
// python .../runner.py. Both build on defensive_buffs_for; the differ exercises
// them via ts,go / py,go (rust skips until its own backfill).

func (s *RunnerState) handleCompare(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("compare args must be an object"))
	}
	attacker, _ := getMap(a, "attacker")
	phase, _ := a["phase"].(string)
	if getStr(attacker, "factionId") == "" || getStr(attacker, "unitId") == "" ||
		getStr(attacker, "weaponId") == "" || !isNumber(attacker["profileIndex"]) ||
		!isStringVal(a["targetProfileId"]) || !isNumber(a["distance"]) ||
		(phase != "shooting" && phase != "fight") {
		return errResp("INVALID_INPUT", detail("compare: malformed attacker/target/distance/phase"))
	}
	modelsFiring := 1
	if isNumber(a["modelsFiring"]) {
		modelsFiring = asInt(a["modelsFiring"])
	}
	distance, _ := num(a["distance"])
	cell, err := compareCell(s.dataset(), getStr(attacker, "factionId"), getStr(attacker, "unitId"),
		getStr(attacker, "weaponId"), asInt(attacker["profileIndex"]), getStr(a, "targetProfileId"),
		distance, phase, modelsFiring)
	if err != nil {
		return errResp("UNKNOWN_ENTITY", detail(err.Error()))
	}
	return okResp(cell)
}

func (s *RunnerState) handleLoadout(args any) map[string]any {
	a, ok := asMap(args)
	if !ok {
		return errResp("INVALID_INPUT", detail("loadout args must be an object"))
	}
	lines, isList := asList(a["lines"])
	phase, _ := a["phase"].(string)
	if !isList || !isStringVal(a["targetProfileId"]) || !isNumber(a["distance"]) ||
		(phase != "shooting" && phase != "fight") {
		return errResp("INVALID_INPUT", detail("loadout: malformed lines/target/distance/phase"))
	}
	parsed := make([]loadoutLine, 0, len(lines))
	for _, lAny := range lines {
		l, _ := asMap(lAny)
		parsed = append(parsed, loadoutLine{
			weaponID:     getStr(l, "weaponId"),
			count:        asInt(l["count"]),
			profileIndex: asInt(l["profileIndex"]),
		})
	}
	distance, _ := num(a["distance"])
	cell, err := loadoutCell(s.dataset(), parsed, getStr(a, "targetProfileId"), distance, phase)
	if err != nil {
		return errResp("UNKNOWN_ENTITY", detail(err.Error()))
	}
	return okResp(cell)
}

func isStringVal(v any) bool {
	_, ok := v.(string)
	return ok
}
