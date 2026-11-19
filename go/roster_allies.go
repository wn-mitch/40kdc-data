package wh40kdc

import "sort"

// Allied-pool attribution and keyword caps for the roster checker. Mirror of TS
// data/roster-allies.ts; pinned by the roster_validation conformance corpus.

// allyViolation is an army-level violation the allied-pool checks raise.
type allyViolation struct {
	code string
	id   string
}

// unitRecordKey identifies a resolved unit record by (faction_id, id).
func unitRecordKey(view *UnitView) string {
	return getStr(view.Raw, "faction_id") + "::" + getStr(view.Raw, "id")
}

// attributeAllies returns the offered allied rule each foreign roster unit is
// included through, keyed by index into views. A unit is foreign when its
// faction_id differs from the army's and it carries a Faction keyword the army
// faction lacks. It is attributed to the first offered, non-exclusive rule
// (alliesFor order) whose pool (allyUnitsFor) lists its id; otherwise it is
// left out.
func attributeAllies(ds *Dataset, factionID string, detachmentIDs []string, armyKeywordSet map[string]struct{}, views []*UnitView) map[int]map[string]any {
	out := map[int]map[string]any{}
	if factionID == "" {
		return out
	}
	type pool struct {
		rule map[string]any
		ids  map[string]struct{}
	}
	var pools []pool
	for _, ruleAny := range ds.alliesFor(factionID, detachmentIDs) {
		rule := ruleAny.(map[string]any)
		if rule["exclusive"] == true {
			continue
		}
		ids := map[string]struct{}{}
		for _, u := range ds.allyUnitsFor(getStr(rule, "id")) {
			ids[u.ID()] = struct{}{}
		}
		pools = append(pools, pool{rule, ids})
	}
	for idx, view := range views {
		if view == nil || getStr(view.Raw, "faction_id") == factionID {
			continue
		}
		inArmy := true
		for _, k := range getStrList(view.Raw, "faction_keywords") {
			if _, ok := armyKeywordSet[k]; !ok {
				inArmy = false
				break
			}
		}
		if inArmy {
			continue
		}
		for _, p := range pools {
			if _, ok := p.ids[view.ID()]; ok {
				out[idx] = p.rule
				break
			}
		}
	}
	return out
}

// allyKeywordLimitViolations returns the keyword-cap violations of one allied
// rule over the keyword sets of the units included through it (keywords match
// case-insensitively): each keyword_limits cap at battleSize, less one counted
// receiver unit per donor unit for each exemption; and, for
// keyword_limits_exclusive, more than one limited keyword present at any
// battle size.
func allyKeywordLimitViolations(rule map[string]any, members []map[string]struct{}, battleSize string) []allyViolation {
	var out []allyViolation
	lowered := make([]map[string]struct{}, len(members))
	for i, kws := range members {
		lowered[i] = map[string]struct{}{}
		for k := range kws {
			lowered[i][lower(k)] = struct{}{}
		}
	}
	has := func(kws map[string]struct{}, k string) bool {
		_, ok := kws[lower(k)]
		return ok
	}
	hasAll := func(kws map[string]struct{}, need []string) bool {
		for _, k := range need {
			if !has(kws, k) {
				return false
			}
		}
		return true
	}
	ruleID := getStr(rule, "id")
	limits := getList(rule, "keyword_limits")
	for _, limitAny := range limits {
		limit, ok := asMap(limitAny)
		if !ok || battleSize == "" || getStr(limit, "battle_size") != battleSize {
			continue
		}
		keyword := getStr(limit, "keyword")
		var counted []int
		for i, kws := range lowered {
			if has(kws, keyword) {
				counted = append(counted, i)
			}
		}
		exempt := map[int]struct{}{}
		for _, exAny := range getList(limit, "exemptions") {
			ex, ok := asMap(exAny)
			if !ok {
				continue
			}
			donorKeywords := getStrList(ex, "donor_keywords")
			receiverKeywords := getStrList(ex, "receiver_keywords")
			donors := 0
			for _, kws := range lowered {
				if hasAll(kws, donorKeywords) {
					donors++
				}
			}
			for _, i := range counted {
				if donors == 0 {
					break
				}
				if _, done := exempt[i]; done || !hasAll(lowered[i], receiverKeywords) {
					continue
				}
				exempt[i] = struct{}{}
				donors--
			}
		}
		if len(counted)-len(exempt) > asInt(limit["max_count"]) {
			out = append(out, allyViolation{"ally-keyword-limit-exceeded", ruleID + ":" + keyword})
		}
	}
	if rule["keyword_limits_exclusive"] == true {
		seen := map[string]struct{}{}
		var used []string
		for _, limitAny := range limits {
			limit, ok := asMap(limitAny)
			if !ok {
				continue
			}
			keyword := getStr(limit, "keyword")
			if _, dup := seen[keyword]; dup {
				continue
			}
			seen[keyword] = struct{}{}
			for _, kws := range lowered {
				if has(kws, keyword) {
					used = append(used, keyword)
					break
				}
			}
		}
		sort.Strings(used)
		if len(used) > 1 {
			out = append(out, allyViolation{"ally-keyword-limits-exclusive", ruleID})
		}
	}
	return out
}
