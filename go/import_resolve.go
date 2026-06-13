package wh40kdc

// Resolve a ParsedRoster onto 40kdc entity ids, producing a Roster. Lenient:
// unmatched names yield resolved:false refs with candidate suggestions. Go
// mirror of python .../imports/resolve.py.

const maxCandidates = 5

type diagBuilder struct {
	resolvedUnits     int
	unresolvedUnits   int
	resolvedWeapons   int
	unresolvedWeapons int
	warnings          []any
}

func (d *diagBuilder) warn(code, message string, rawName any) {
	d.warnings = append(d.warnings, map[string]any{"code": code, "message": message, "raw_name": rawName})
}

func (d *diagBuilder) build() map[string]any {
	w := d.warnings
	if w == nil {
		w = []any{}
	}
	return map[string]any{
		"resolved_units":     float64(d.resolvedUnits),
		"unresolved_units":   float64(d.unresolvedUnits),
		"resolved_weapons":   float64(d.resolvedWeapons),
		"unresolved_weapons": float64(d.unresolvedWeapons),
		"warnings":           w,
	}
}

func refUnresolved(rawName any, candidates []any) map[string]any {
	if candidates == nil {
		candidates = []any{}
	}
	return map[string]any{"id": nil, "raw_name": rawName, "resolved": false, "candidates": candidates}
}

func refResolved(id, rawName any) map[string]any {
	return map[string]any{"id": id, "raw_name": rawName, "resolved": true, "candidates": []any{}}
}

func candFromRaw(records []any) []any {
	out := []any{}
	for i, r := range records {
		if i >= maxCandidates {
			break
		}
		m, _ := asMap(r)
		entry := map[string]any{"id": m["id"]}
		if m["name"] != nil {
			entry["name"] = m["name"]
		}
		out = append(out, entry)
	}
	return out
}

func candFromUnits(records []*UnitView) []any {
	out := []any{}
	for i, r := range records {
		if i >= maxCandidates {
			break
		}
		out = append(out, map[string]any{"id": r.ID(), "name": r.Name()})
	}
	return out
}

func candFromWeapons(records []*WeaponView) []any {
	out := []any{}
	for i, r := range records {
		if i >= maxCandidates {
			break
		}
		out = append(out, map[string]any{"id": r.ID(), "name": r.Name()})
	}
	return out
}

func mapBattleSize(raw any) any {
	s, ok := raw.(string)
	if !ok || s == "" {
		return nil
	}
	key := NormalizeName(s)
	if containsSub(key, "strike force") {
		return "strike-force"
	}
	if containsSub(key, "incursion") {
		return "incursion"
	}
	return nil
}

func containsSub(h, n string) bool { return len(n) == 0 || indexOf(h, n) >= 0 }

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}

func detachmentCap(battleSize any) any {
	switch battleSize {
	case "strike-force":
		return float64(3)
	case "incursion":
		return float64(2)
	}
	return nil
}

func resolveRoster(parsed map[string]any, ds *Dataset, format string) map[string]any {
	diag := &diagBuilder{}
	if parsed["multi_force"] == true {
		diag.warn("multi-force", "Source list contains more than one faction; the primary faction was used for scoping.", nil)
	}

	var factionID any
	if fr, ok := parsed["faction_raw_name"].(string); ok && fr != "" {
		if hit, ok := ds.Factions.Find(fr); ok {
			factionID = hit.ID()
		} else {
			diag.warn("faction-unresolved", "Faction name did not match any 40kdc faction.", fr)
		}
	}
	factionIDStr, _ := factionID.(string)

	detachments := []any{}
	for _, rnAny := range getList(parsed, "detachment_raw_names") {
		rawName := rnAny.(string)
		key := NormalizeName(rawName)
		var scoped map[string]any
		if factionIDStr != "" {
			for _, dAny := range ds.Detachments.ByFaction(factionIDStr) {
				d := dAny.(map[string]any)
				if NormalizeName(getStr(d, "name")) == key {
					scoped = d
					break
				}
			}
		}
		var hit map[string]any
		if scoped != nil {
			hit = scoped
		} else if h, ok := ds.Detachments.Find(rawName); ok {
			hit = h.(map[string]any)
		}
		if hit != nil {
			detachments = append(detachments, map[string]any{
				"ref":     refResolved(hit["id"], rawName),
				"dp_cost": detachmentPointsOrNil(hit),
			})
		} else {
			diag.warn("detachment-unresolved", "Detachment name did not match any 40kdc detachment.", rawName)
			detachments = append(detachments, map[string]any{
				"ref":     refUnresolved(rawName, candFromRaw(ds.Detachments.FindAll(rawName))),
				"dp_cost": nil,
			})
		}
	}
	var detachmentIDs []string
	for _, dAny := range detachments {
		d := dAny.(map[string]any)
		ref := d["ref"].(map[string]any)
		if id, ok := ref["id"].(string); ok {
			detachmentIDs = append(detachmentIDs, id)
		}
	}

	battleSize := mapBattleSize(parsed["battle_size_raw"])
	if bsr, ok := parsed["battle_size_raw"].(string); ok && bsr != "" && battleSize == nil {
		diag.warn("battle-size-unmapped", "Battle size label could not be mapped.", bsr)
	}
	cap := detachmentCap(battleSize)

	if cap != nil && len(detachments) > 0 {
		allKnown := true
		spent := 0.0
		for _, dAny := range detachments {
			d := dAny.(map[string]any)
			if d["dp_cost"] == nil {
				allKnown = false
				break
			}
			spent += asFloat(d["dp_cost"])
		}
		if allKnown && spent > asFloat(cap) {
			diag.warn("detachment-points-exceeded",
				"Detachments cost "+numStr(spent)+" detachment points but the "+battleSize.(string)+" budget is "+numStr(cap)+".", nil)
		}
	}

	units := []any{}
	parsedUnits := getList(parsed, "units")
	for _, puAny := range parsedUnits {
		pu := puAny.(map[string]any)
		units = append(units, resolveUnit(pu, factionIDStr, detachmentIDs, ds, diag))
	}
	inferLeaderAttachments(parsedUnits, units, ds, diag)

	tr := parsed["total_reported"]
	tc := parsed["total_computed"]
	if tr != nil && !numEq(tr, tc) {
		diag.warn("points-mismatch",
			"Source-reported total ("+numStr(tr)+") differs from the sum of cost lines ("+numStr(tc)+").", nil)
	}

	return map[string]any{
		"name":        parsed["name"],
		"source":      map[string]any{"format": format, "generated_by": parsed["generated_by"]},
		"faction_id":  factionID,
		"detachments": detachments,
		"battle_size": battleSize,
		"points": map[string]any{
			"declared_limit": parsed["declared_limit"],
			"detachment_cap": cap,
			"total_reported": parsed["total_reported"],
			"total_computed": parsed["total_computed"],
		},
		"units":        units,
		"game_version": map[string]any{"edition": "11th", "dataslate": "pre-launch-provisional"},
		"diagnostics":  diag.build(),
	}
}

func detachmentPointsOrNil(d map[string]any) any {
	if v, ok := d["detachment_points"]; ok {
		return v
	}
	return nil
}

func resolveUnit(parsed map[string]any, factionID string, detachmentIDs []string, ds *Dataset, diag *diagBuilder) map[string]any {
	rawName := getStr(parsed, "raw_name")
	key := NormalizeName(rawName)
	var scoped *UnitView
	if factionID != "" {
		for _, u := range ds.Units.ByFaction(factionID) {
			if NormalizeName(u.Name()) == key {
				scoped = u
				break
			}
		}
	}
	allHits := ds.Units.FindAll(rawName)
	var hit *UnitView
	if scoped != nil {
		hit = scoped
	} else if len(allHits) > 0 {
		hit = allHits[0]
	}

	var ref map[string]any
	if hit != nil {
		ref = refResolved(hit.ID(), rawName)
		diag.resolvedUnits++
	} else {
		ref = refUnresolved(rawName, candFromUnits(allHits))
		diag.unresolvedUnits++
		diag.warn("unit-unresolved", "Unit name did not match any 40kdc unit.", rawName)
	}

	var enhancement any
	var enhancementPoints any
	if enr, ok := parsed["enhancement_raw_name"].(string); ok && enr != "" {
		enhancement = resolveEnhancement(enr, detachmentIDs, ds, diag)
		enhancementPoints = parsed["enhancement_points"]
	}

	wargear := []any{}
	for _, wAny := range getList(parsed, "wargear") {
		w := wAny.(map[string]any)
		hits := ds.Weapons.FindAll(getStr(w, "raw_name"))
		if len(hits) > 0 {
			diag.resolvedWeapons++
			wargear = append(wargear, map[string]any{"ref": refResolved(hits[0].ID(), w["raw_name"]), "count": w["count"]})
		} else {
			diag.unresolvedWeapons++
			diag.warn("weapon-unresolved", "Weapon name did not match any 40kdc weapon.", w["raw_name"])
			wargear = append(wargear, map[string]any{"ref": refUnresolved(w["raw_name"], candFromWeapons(hits)), "count": w["count"]})
		}
	}

	return map[string]any{
		"ref":                ref,
		"model_count":        parsed["model_count"],
		"points":             parsed["points"],
		"is_warlord":         parsed["is_warlord"],
		"enhancement":        enhancement,
		"enhancement_points": enhancementPoints,
		"wargear":            wargear,
		"leader_attachment":  nil,
	}
}

func resolveEnhancement(rawName string, detachmentIDs []string, ds *Dataset, diag *diagBuilder) map[string]any {
	key := NormalizeName(rawName)
	var scoped map[string]any
	if len(detachmentIDs) > 0 {
		for _, eAny := range ds.Enhancements.All() {
			e := eAny.(map[string]any)
			did, _ := e["detachment_id"].(string)
			if containsStr2(detachmentIDs, did) && NormalizeName(getStr(e, "name")) == key {
				scoped = e
				break
			}
		}
	}
	var hit map[string]any
	if scoped != nil {
		hit = scoped
	} else if h, ok := ds.Enhancements.Find(rawName); ok {
		hit = h.(map[string]any)
	}
	if hit != nil {
		return refResolved(hit["id"], rawName)
	}
	diag.warn("enhancement-unresolved", "Enhancement name did not match any 40kdc enhancement.", rawName)
	return refUnresolved(rawName, candFromRaw(ds.Enhancements.FindAll(rawName)))
}

func inferLeaderAttachments(parsedUnits []any, units []any, ds *Dataset, diag *diagBuilder) {
	bodyguardIDs := map[string]bool{}
	for i, uAny := range units {
		u := uAny.(map[string]any)
		ref := u["ref"].(map[string]any)
		pu := parsedUnits[i].(map[string]any)
		if id, ok := ref["id"].(string); ok && id != "" && pu["is_character"] != true {
			bodyguardIDs[id] = true
		}
	}
	for i, uAny := range units {
		unit := uAny.(map[string]any)
		ref := unit["ref"].(map[string]any)
		pu := parsedUnits[i].(map[string]any)
		leaderID, ok := ref["id"].(string)
		if !ok || leaderID == "" || pu["is_character"] != true {
			continue
		}
		var attachment map[string]any
		for _, laAny := range ds.LeaderAttachments {
			la := laAny.(map[string]any)
			if getStr(la, "leader_id") == leaderID {
				attachment = la
				break
			}
		}
		if attachment == nil {
			continue
		}
		var bodyguardID string
		for _, idAny := range getStrList(attachment, "eligible_bodyguard_ids") {
			if bodyguardIDs[idAny] {
				bodyguardID = idAny
				break
			}
		}
		if bodyguardID == "" {
			continue
		}
		var bodyguard map[string]any
		for _, bAny := range units {
			b := bAny.(map[string]any)
			bref := b["ref"].(map[string]any)
			if bref["id"] == bodyguardID {
				bodyguard = b
				break
			}
		}
		if bodyguard == nil {
			continue
		}
		bref := bodyguard["ref"].(map[string]any)
		unit["leader_attachment"] = map[string]any{
			"bodyguard_ref": refResolved(bodyguardID, bref["raw_name"]),
			"provisional":   true,
		}
		diag.warn("leader-attachment-inferred", "Leader attachment was inferred from leader-attachment data and is provisional.", ref["raw_name"])
	}
}

func asFloat(v any) float64 {
	f, _ := v.(float64)
	return f
}

func numEq(a, b any) bool {
	af, aok := a.(float64)
	bf, bok := b.(float64)
	if aok && bok {
		return af == bf
	}
	return a == b
}
