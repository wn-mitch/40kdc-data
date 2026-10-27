package wh40kdc

import (
	"sort"
	"strings"
)

// Whole-army roster legality: the per-unit loadout check (loadout.go) layered
// with the nine army-construction dimensions. Go mirror of
// tools/src/data/roster-resolve.ts (validateRosterCore / NormRoster).

// normUnit is one unit in the normalised roster the core checker consumes.
// Empty-string enhancementID / leaderBodyguardID means "null".
type normUnit struct {
	unitID            string
	modelCount        int
	isWarlord         bool
	enhancementID     string
	leaderBodyguardID string
	keywordOverrides  []string
	counts            map[string]int
}

// normRoster is the compact roster spec shared by the runner op. factionID and
// battleSize are "" for null; forceDisposition is nil for null (distinct from
// the empty string, which is a picked-but-blank disposition).
type normRoster struct {
	factionID        string
	battleSize       string
	forceDisposition *string
	detachmentIDs    []string
	units            []normUnit
}

// unitLoadoutResult is the per-unit loadout verdict (the building block layered
// under the army checks). Carries the resolved unit's index and its violations.
type unitLoadoutResult struct {
	unitIndex  int
	violations []map[string]string
}

// rosterViolation is one army-level legality violation. unitIndex is -1 for an
// army-wide violation; severity is "error" or "warn".
type rosterViolation struct {
	code      string
	id        string
	unitIndex int
	severity  string
}

// validateRosterCore runs the per-unit loadout check on every resolved unit,
// then the nine army-construction dimensions. Returns the per-unit loadout
// results (resolved units, in source order) and the army violations (unsorted;
// the runner op assembles + sorts the final lines). Mirror of the TS reference.
func validateRosterCore(spec normRoster, ds *Dataset) ([]unitLoadoutResult, []rosterViolation) {
	var army []rosterViolation
	push := func(severity, code, id string, unitIndex int) {
		army = append(army, rosterViolation{code: code, id: id, unitIndex: unitIndex, severity: severity})
	}
	errV := func(code, id string, unitIndex int) { push("error", code, id, unitIndex) }

	resolveUnit := func(unitID string) *UnitView {
		if unitID == "" {
			return nil
		}
		if spec.factionID != "" {
			if uv, ok := ds.Units.GetInFaction(unitID, spec.factionID); ok {
				return uv
			}
		}
		if uv, ok := ds.Units.GetAny(unitID); ok {
			return uv
		}
		return nil
	}
	// The army faction's keywords ([Imperium, Adeptus Astartes, Blood Angels]
	// for a chapter): every unit in the faction's pool owns them — the
	// <CHAPTER>-style keyword that chapter-shared datasheet records can't
	// carry. Granted with the same subset rule that scopes a chapter's unit
	// pool, so allied units never gain them.
	var armyKeywords []string
	if spec.factionID != "" {
		if fac, ok := ds.Factions.Get(spec.factionID); ok {
			armyKeywords = getStrList(fac.Raw, "keywords")
		}
	}
	armyKeywordSet := map[string]struct{}{}
	for _, k := range armyKeywords {
		armyKeywordSet[k] = struct{}{}
	}
	keywordSet := func(view *UnitView, overrides []string) map[string]struct{} {
		s := map[string]struct{}{}
		for _, k := range getStrList(view.Raw, "keywords") {
			s[k] = struct{}{}
		}
		for _, k := range getStrList(view.Raw, "faction_keywords") {
			s[k] = struct{}{}
		}
		s[getStr(view.Raw, "name")] = struct{}{}
		if len(armyKeywordSet) > 0 {
			inPool := true
			for _, k := range getStrList(view.Raw, "faction_keywords") {
				if _, ok := armyKeywordSet[k]; !ok {
					inPool = false
					break
				}
			}
			if inPool {
				for _, k := range armyKeywords {
					s[k] = struct{}{}
				}
			}
		}
		for _, grantAny := range getList(view.Raw, "conditional_keywords") {
			grant, ok := asMap(grantAny)
			if !ok {
				continue
			}
			if requiredDetachmentID := getStr(grant, "required_detachment_id"); requiredDetachmentID != "" &&
				!contains(spec.detachmentIDs, requiredDetachmentID) {
				continue
			}
			if requiredFactionKeyword := getStr(grant, "required_faction_keyword"); requiredFactionKeyword != "" {
				if _, ok := armyKeywordSet[requiredFactionKeyword]; !ok {
					continue
				}
			}
			s[getStr(grant, "keyword")] = struct{}{}
		}
		for _, keyword := range overrides {
			s[keyword] = struct{}{}
		}
		return s
	}
	isCharacter := func(view *UnitView) bool {
		r := getStr(view.Raw, "role")
		return r == "character" || r == "epic-hero" || contains(getStrList(view.Raw, "keywords"), "Character")
	}

	views := make([]*UnitView, len(spec.units))
	for i, u := range spec.units {
		views[i] = resolveUnit(u.unitID)
	}

	// --- Per-unit loadout (reuse the tier/bounds checker). --------------------
	var units []unitLoadoutResult
	for idx, su := range spec.units {
		view := views[idx]
		if view == nil {
			continue
		}
		models, tiers := ds.unitCompositionOf(view.Raw)
		units = append(units, unitLoadoutResult{
			unitIndex:  idx,
			violations: checkUnitLegality(view.Raw, su.modelCount, ds.wargearOptionsOf(view.Raw), su.counts, models, tiers),
		})
	}

	// Resolved detachments (drop ids absent from the dataset).
	var detachments []map[string]any
	// Shared detachment ids (Codex chapters) resolve within the roster's
	// faction; fall back first-wins when the spec names no faction.
	for _, id := range spec.detachmentIDs {
		if detachment := lookupDetachment(ds, id, spec.factionID); detachment != nil {
			detachments = append(detachments, detachment)
		}
	}

	// --- Enhancements: per-unit eligibility + army-wide uniqueness. -----------
	enhUses := map[string]int{}
	for idx, su := range spec.units {
		if su.enhancementID == "" {
			continue
		}
		enhUses[su.enhancementID]++
		eAny, eok := ds.Enhancements.Get(su.enhancementID)
		view := views[idx]
		if !eok || view == nil {
			continue
		}
		enh := eAny.(map[string]any)
		enhID := getStr(enh, "id")
		if !contains(spec.detachmentIDs, getStr(enh, "detachment_id")) {
			errV("enhancement-wrong-detachment", enhID, idx)
		}
		if !isCharacter(view) && !contains(su.keywordOverrides, "Character") && enh["upgrade_tag"] != true {
			errV("enhancement-on-non-character", enhID, idx)
		}
		kws := keywordSet(view, su.keywordOverrides)
		// 11e Select Enhancements: EPIC HERO models cannot be given Enhancements
		// (Upgrades included). Mirror of TS enhancement-on-epic-hero.
		if _, epic := kws["Epic Hero"]; epic || getStr(view.Raw, "role") == "epic-hero" {
			errV("enhancement-on-epic-hero", enhID, idx)
		}
		// A unit whose every model is excluded_from_enhancements has no model that
		// can carry the Enhancement. Mirror of TS enhancement-on-excluded-model.
		if rows, _ := ds.unitCompositionOf(view.Raw); len(rows) > 0 {
			allExcluded := true
			for _, rAny := range rows {
				if r, ok := asMap(rAny); !ok || r["excluded_from_enhancements"] != true {
					allExcluded = false
					break
				}
			}
			if allExcluded {
				errV("enhancement-on-excluded-model", enhID, idx)
			}
		}
		// Keyword groups or datasheet groups (mirror of TS meetsEnhancementGroups).
		eligible := meetsEnhancementGroups(enh, view.ID(), func(keyword string) bool {
			_, held := kws[keyword]
			return held
		})
		if !eligible {
			errV("enhancement-keyword-mismatch", enhID, idx)
		}
		for _, k := range getStrList(enh, "exclusion_keywords") {
			if _, has := kws[k]; has {
				errV("enhancement-excluded-keyword", enhID, idx)
				break
			}
		}
	}
	for enhID, uses := range enhUses {
		maxTargets := 1
		if eAny, ok := ds.Enhancements.Get(enhID); ok {
			if mt, has := eAny.(map[string]any)["max_targets"]; has && mt != nil {
				maxTargets = asInt(mt)
			}
		}
		if uses > maxTargets {
			errV("enhancement-over-max-targets", enhID, -1)
		}
	}

	// --- Leader attachment. ----------------------------------------------------
	for idx, su := range spec.units {
		view := views[idx]
		if view == nil {
			continue
		}
		if su.leaderBodyguardID != "" {
			eligible := bodyguardEligibleIDs(ds, view.ID())
			if su.enhancementID != "" {
				if enhancementAny, ok := ds.Enhancements.Get(su.enhancementID); ok {
					for _, bodyguardID := range getStrList(enhancementAny.(map[string]any), "attachment_bodyguard_ids") {
						eligible[bodyguardID] = struct{}{}
					}
				}
			}
			if _, ok := eligible[su.leaderBodyguardID]; !ok {
				errV("leader-attachment-illegal", view.ID(), idx)
			}
		} else if getStr(view.Raw, "attachment_role") == "support" &&
			(isCharacter(view) || contains(su.keywordOverrides, "Character")) {
			errV("leader-must-attach", view.ID(), idx)
		}
	}

	// --- Points total (ordinal-aware) + enhancement costs. --------------------
	// Host-aware: a foreign unit with an allied_points entry for this army
	// (Agents' Imperium price, a chapter's reprice of a shared datasheet)
	// prices from that entry, not its native table.
	var rosterFaction map[string]any
	if spec.factionID != "" {
		if f, ok := ds.Factions.Get(spec.factionID); ok {
			rosterFaction = f.Raw
		}
	}
	ordinals := map[string]int{}
	unitCosts := make([]int, len(spec.units))
	total := 0
	for idx, su := range spec.units {
		view := views[idx]
		if view == nil {
			continue
		}
		ord := ordinals[su.unitID] + 1
		ordinals[su.unitID] = ord
		cost := armyUnitPoints(view.Raw, su.modelCount, ord, rosterFaction, spec.detachmentIDs)
		cost += wargearPoints(view.Raw, su.counts)
		if su.enhancementID != "" {
			if eAny, ok := ds.Enhancements.Get(su.enhancementID); ok {
				cost += asInt(eAny.(map[string]any)["cost"])
			}
		}
		unitCosts[idx] = cost
		total += cost
	}
	if limit, ok := pointsLimitForBattleSize(spec.battleSize); ok && total > limit {
		errV("points-over-limit", "roster", -1)
	}

	// --- Detachment-point budget. ---------------------------------------------
	cap, capOk := detachmentCapForBattleSize(spec.battleSize)
	dpUsed := 0
	for _, d := range detachments {
		dpUsed += asInt(d["detachment_points"])
	}
	if capOk && dpUsed > cap {
		errV("detachment-points-over", "roster", -1)
	}

	// --- Force disposition (advisory / warn). ---------------------------------
	// Any selected detachment may grant the pick; detachments whose data does
	// not record force_dispositions (key absent or null) are skipped, and when
	// none record them the check is inconclusive and stays silent.
	if spec.forceDisposition == nil {
		push("warn", "disposition-not-picked", "roster", -1)
	} else {
		recorded, granted := false, false
		for _, d := range detachments {
			if fd, ok := d["force_dispositions"]; ok && fd != nil {
				recorded = true
				if contains(toStrList(fd), *spec.forceDisposition) {
					granted = true
				}
			}
		}
		if recorded && !granted {
			push("warn", "disposition-invalid", *spec.forceDisposition, -1)
		}
	}

	// --- Detachment tag uniqueness (one per shared tag). ----------------------
	tagCounts := map[string]int{}
	for _, d := range detachments {
		for _, t := range getStrList(d, "tags") {
			tagCounts[t]++
		}
	}
	for tag, n := range tagCounts {
		if n > 1 {
			errV("detachment-tag-conflict", tag, -1)
		}
	}

	// --- Detachment restrictions (required/excluded army keywords, per unit). -
	for _, d := range detachments {
		r, ok := getMap(d, "restrictions")
		if !ok {
			continue
		}
		required := getStrList(r, "required_keywords")
		excluded := getStrList(r, "excluded_keywords")
		for idx := range spec.units {
			view := views[idx]
			if view == nil {
				continue
			}
			kws := keywordSet(view, spec.units[idx].keywordOverrides)
			for _, k := range required {
				if _, has := kws[k]; !has {
					errV("detachment-restriction-required", view.ID(), idx)
					break
				}
			}
			for _, k := range excluded {
				if _, has := kws[k]; has {
					errV("detachment-restriction-excluded", view.ID(), idx)
					break
				}
			}
		}
	}

	// --- Faction exclusions (a generic unit barred from this army's chapter). --
	// The shared Space Marine pool can't drop a generic datasheet for one chapter,
	// so a removed-without-replacement unit (e.g. Librarians for Black Templars)
	// carries excluded_faction_keywords; it is illegal when the army's faction
	// keywords intersect that list. Mirror of TS unit-excluded-from-faction.
	if spec.factionID != "" {
		factionKeywords := map[string]struct{}{}
		if fac, ok := ds.Factions.Get(spec.factionID); ok {
			for _, k := range getStrList(fac.Raw, "keywords") {
				factionKeywords[k] = struct{}{}
			}
		}
		if len(factionKeywords) > 0 {
			for idx := range spec.units {
				view := views[idx]
				if view == nil {
					continue
				}
				for _, k := range getStrList(view.Raw, "excluded_faction_keywords") {
					if _, has := factionKeywords[k]; has {
						errV("unit-excluded-from-faction", view.ID(), idx)
						break
					}
				}
			}
		}
	}

	// --- Warlord present (exactly one). ---------------------------------------
	warlords := 0
	for _, su := range spec.units {
		if su.isWarlord {
			warlords++
		}
	}
	if warlords == 0 {
		errV("no-warlord", "roster", -1)
	} else if warlords > 1 {
		errV("multiple-warlords", "roster", -1)
	}

	// --- Detachment Warlord requirement (e.g. Devoted of Ynnead). -------------
	// Checked only when a Warlord is chosen; a missing one is no-warlord above.
	for _, d := range detachments {
		mandated := map[string]bool{}
		for _, m := range getList(d, "mandatory_warlord_datasheet_ids") {
			if id, ok := m.(string); ok {
				mandated[id] = true
			}
		}
		if len(mandated) == 0 || warlords == 0 {
			continue
		}
		satisfied := false
		for _, su := range spec.units {
			if su.isWarlord && mandated[su.unitID] {
				satisfied = true
				break
			}
		}
		if !satisfied {
			errV("warlord-not-mandated", getStr(d, "id"), -1)
		}
	}

	// --- Detachment datasheet exclusions (e.g. Shadow Legion). ----------------
	for _, d := range detachments {
		excluded := map[string]bool{}
		for _, x := range getList(d, "excluded_datasheet_ids") {
			if id, ok := x.(string); ok {
				excluded[id] = true
			}
		}
		for idx, su := range spec.units {
			if excluded[su.unitID] {
				errV("detachment-excluded-datasheet", su.unitID, idx)
			}
		}
	}

	// --- Unit limit per datasheet (11e Select Battle Size). Mirror of TS. -----
	// incursion 2 / strike-force 3, doubled for BATTLELINE (incl. detachment-
	// granted) and DEDICATED TRANSPORT units; every EPIC HERO is limited to 1.
	unitLimit, unitLimitOk := unitLimitForBattleSize(spec.battleSize)
	type copyCount struct{ count, limit int }
	copies := map[string]*copyCount{}
	var copyOrder []string
	for idx, v := range views {
		if v == nil {
			continue
		}
		kws := keywordSet(v, spec.units[idx].keywordOverrides)
		role := getStr(v.Raw, "role")
		_, epic := kws["Epic Hero"]
		_, battleline := kws["Battleline"]
		_, transport := kws["Dedicated Transport"]
		limit, ok := unitLimit, unitLimitOk
		if role == "epic-hero" || epic {
			limit, ok = 1, true
		} else if ok && (role == "battleline" || role == "dedicated-transport" || battleline || transport) {
			limit *= 2
		}
		if !ok {
			continue
		}
		id := v.ID()
		c, seen := copies[id]
		if !seen {
			c = &copyCount{0, limit}
			copies[id] = c
			copyOrder = append(copyOrder, id)
		}
		c.count++
		if limit > c.limit {
			c.limit = limit
		}
	}
	for _, id := range copyOrder {
		if c := copies[id]; c.count > c.limit {
			errV("unit-limit-exceeded", id, -1)
		}
	}

	// --- Enhancement limit (incursion 2, strike-force 4), distinct choices. ---
	if enhLimit, ok := enhancementLimitForBattleSize(spec.battleSize); ok {
		chosen := map[string]bool{}
		for _, su := range spec.units {
			if su.enhancementID != "" {
				chosen[su.enhancementID] = true
			}
		}
		if len(chosen) > enhLimit {
			errV("enhancement-limit-exceeded", "roster", -1)
		}
	}

	// --- Army-wide keyword caps (faction keyword_limits). Mirror of TS. -------
	sortedStrs := func(xs []string) []string {
		out := append([]string(nil), xs...)
		sort.Strings(out)
		return out
	}
	sameStrs := func(a, b []string) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if a[i] != b[i] {
				return false
			}
		}
		return true
	}
	for _, klAny := range getList(rosterFaction, "keyword_limits") {
		kl, ok := asMap(klAny)
		if !ok {
			continue
		}
		keys := sortedStrs(getStrList(kl, "keywords"))
		limit := asInt(kl["max"])
		overridden := false
		for _, d := range detachments {
			for _, oAny := range getList(d, "keyword_limit_overrides") {
				o, ok := asMap(oAny)
				if !ok || !sameStrs(sortedStrs(getStrList(o, "keywords")), keys) {
					continue
				}
				om := asInt(o["max"])
				if !overridden || om > limit {
					limit = om
				}
				overridden = true
			}
		}
		exempt := getStrList(kl, "exempt_faction_keywords")
		var counted []map[string]struct{}
		for idx, v := range views {
			if v == nil {
				continue
			}
			isExempt := false
			for _, fk := range getStrList(v.Raw, "faction_keywords") {
				if contains(exempt, fk) {
					isExempt = true
					break
				}
			}
			if !isExempt {
				counted = append(counted, keywordSet(v, spec.units[idx].keywordOverrides))
			}
		}
		// "units": units carrying every keyword. "alternatives": distinct
		// keywords present on any unit (Farsight / Ethereal).
		count := 0
		if getStr(kl, "mode") == "alternatives" {
			for _, k := range keys {
				for _, kws := range counted {
					if _, has := kws[k]; has {
						count++
						break
					}
				}
			}
		} else {
			for _, kws := range counted {
				all := true
				for _, k := range keys {
					if _, has := kws[k]; !has {
						all = false
						break
					}
				}
				if all {
					count++
				}
			}
		}
		if count > limit {
			errV("keyword-limit-exceeded", strings.Join(keys, "+"), -1)
		}
	}

	// --- Exclusive allied pools (the army faction's own pool-only units). -----
	// Mirror of TS: the rule must be offered, and its points cap and
	// Warlord/Enhancement locks apply; a selected detachment's mandatory or
	// granted Warlord datasheets lift the Warlord lock.
	detachmentWarlords := map[string]bool{}
	for _, d := range detachments {
		for _, id := range getStrList(d, "mandatory_warlord_datasheet_ids") {
			detachmentWarlords[id] = true
		}
		for _, id := range getStrList(d, "granted_warlord_datasheet_ids") {
			detachmentWarlords[id] = true
		}
	}
	if spec.factionID != "" {
		for _, ruleAny := range ds.AlliedRules.All() {
			rule, ok := asMap(ruleAny)
			if !ok || rule["exclusive"] != true || getStr(rule, "source_faction_id") != spec.factionID {
				continue
			}
			pool := getStrList(rule, "source_datasheet_ids")
			var members []int
			for idx, su := range spec.units {
				if views[idx] != nil && getStr(views[idx].Raw, "faction_id") == spec.factionID && contains(pool, su.unitID) {
					members = append(members, idx)
				}
			}
			if len(members) == 0 {
				continue
			}
			armyAny := getStrList(rule, "army_keywords_any")
			armyGate := len(armyAny) == 0
			for _, k := range armyAny {
				if _, has := armyKeywordSet[k]; has {
					armyGate = true
					break
				}
			}
			detAny := getStrList(rule, "detachment_ids")
			detGate := len(detAny) == 0
			for _, id := range detAny {
				if contains(spec.detachmentIDs, id) {
					detGate = true
					break
				}
			}
			if !armyGate || !detGate {
				for _, idx := range members {
					errV("ally-pool-not-offered", spec.units[idx].unitID, idx)
				}
			}
			for _, pAny := range getList(rule, "points_limits") {
				p, ok := asMap(pAny)
				if !ok || getStr(p, "battle_size") != spec.battleSize {
					continue
				}
				spent := 0
				for _, idx := range members {
					spent += unitCosts[idx]
				}
				if spent > asInt(p["max_points"]) {
					errV("ally-points-over-limit", getStr(rule, "id"), -1)
				}
				break
			}
			for _, idx := range members {
				su := spec.units[idx]
				if rule["cannot_be_warlord"] == true && su.isWarlord && !detachmentWarlords[su.unitID] {
					errV("ally-cannot-be-warlord", su.unitID, idx)
				}
				if rule["cannot_take_enhancements"] == true && su.enhancementID != "" {
					errV("ally-cannot-take-enhancements", su.unitID, idx)
				}
			}
		}
	}

	// --- Unit minimums (e.g. Houndpack: 3+ WAR DOG units). --------------------
	for _, d := range detachments {
		for _, umAny := range getList(d, "unit_minimums") {
			um, _ := asMap(umAny)
			keyword := getStr(um, "keyword")
			minN := asInt(um["min"])
			count := 0
			for idx, v := range views {
				if v == nil {
					continue
				}
				if _, has := keywordSet(v, spec.units[idx].keywordOverrides)[keyword]; has {
					count++
				}
			}
			if count < minN {
				errV("unit-minimum-unmet", keyword, -1)
			}
		}
	}

	return units, army
}

// bodyguardEligibleIDs is the set of body-unit ids the given leader can attach
// to — its leader-attachment `eligible_bodyguard_ids` that resolve to a known
// unit. Mirror of Dataset.bodyguardsAttachableFrom (membership only).
func bodyguardEligibleIDs(ds *Dataset, leaderUnitID string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, laAny := range ds.LeaderAttachments {
		la, _ := asMap(laAny)
		if getStr(la, "leader_id") != leaderUnitID {
			continue
		}
		for _, bid := range getStrList(la, "eligible_bodyguard_ids") {
			// Faction-agnostic attachment data — GetAny.
			if _, ok := ds.Units.GetAny(bid); ok {
				out[bid] = struct{}{}
			}
		}
	}
	return out
}
