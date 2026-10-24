package wh40kdc

import "encoding/json"

// The flat Buff shape every contribution flows through, and resolveBuffs which
// collapses a stack into a resolved-modifiers read-out the engine consumes. Go
// mirror of python .../cruncher/buffs.py. Buffs are plain map[string]any
// (wire shape: {source, contribution, applicableWhen?}).

var sourceKindRank = map[string]int{
	"ability:army":                 0,
	"ability:detachment":           1,
	"ability:detachment-stratagem": 2,
	"ability:unit":                 3,
	"ability:attached":             4,
	"ability:support":              5,
	"manual":                       6,
	"weapon-keyword":               7,
}

func rankOf(s map[string]any) int {
	if getStr(s, "kind") == "ability" {
		if r, ok := sourceKindRank["ability:"+getStr(s, "abilityKind")]; ok {
			return r
		}
		return 99
	}
	if r, ok := sourceKindRank[getStr(s, "kind")]; ok {
		return r
	}
	return 99
}
func anyList(v any) []any {
	if list, ok := v.([]any); ok {
		return list
	}
	if list, ok := v.([]map[string]any); ok {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = item
		}
		return out
	}
	return nil
}

func buffApplies(buff map[string]any, ctx map[string]any) bool {
	w, ok := getMap(buff, "applicableWhen")
	if !ok || len(w) == 0 {
		return true
	}
	if phases := getList(w, "phases"); len(phases) > 0 {
		if !containsAny(phases, getStr(ctx, "phase")) {
			return false
		}
	}
	contribution, _ := getMap(buff, "contribution")
	if rt := getStr(w, "rollType"); rt != "" {
		if ct := getStr(contribution, "type"); (ct == "reroll" || ct == "reroll-one") && getStr(contribution, "roll") != rt {
			return false
		}
	}
	if rk := getStr(w, "requiresTargetKeyword"); rk != "" {
		if !containsAny(getList(ctx, "targetKeywords"), lower(rk)) {
			return false
		}
	}
	// Excluded target keywords: permissive when the target's keywords are unknown.
	if excluded, ok := asList(w["excludedTargetKeywords"]); ok && len(excluded) > 0 && ctx["targetKeywords"] != nil {
		target := getList(ctx, "targetKeywords")
		for _, k := range excluded {
			if ks, ok := k.(string); ok && containsAny(target, lower(ks)) {
				return false
			}
		}
	}
	if rk := getStr(w, "requiresAttackerKeyword"); rk != "" {
		if !containsAny(getList(ctx, "attackerKeywords"), lower(rk)) {
			return false
		}
	}
	maxRangeValue := w["maxRangeInches"]
	if maxRangeValue == nil {
		maxRangeValue = w["max_range_inches"]
	}
	if maxRangeValue != nil {
		if ctx["distanceInches"] == nil {
			return false
		}
		maxRange, maxOK := num(maxRangeValue)
		distance, distanceOK := num(ctx["distanceInches"])
		if !maxOK || !distanceOK || distance > maxRange {
			return false
		}
	}
	// Weapon-name gate: permissive when the context carries no weaponNames.
	if wn, ok := w["weaponName"].(string); ok && ctx["weaponNames"] != nil {
		if !containsAny(getList(ctx, "weaponNames"), wn) {
			return false
		}
	}
	if excluded, ok := asList(w["excludedWeaponNames"]); ok && len(excluded) > 0 && ctx["weaponNames"] != nil {
		for _, name := range excluded {
			if n, ok := name.(string); ok && containsAny(getList(ctx, "weaponNames"), n) {
				return false
			}
		}
	}
	// Weapon-keyword selectors and weaponRequirements read the weapon's keywords
	// plus the keywords live buffs grant, so liveBuffs checks them.
	if w["unresolvedWeaponRef"] != nil {
		return false
	}
	return true
}

// weaponKeywordRefMatches reports whether a weapon keyword ref meets a structured
// selector: the same catalog id and every parameter the selector names. A
// target_keyword compares case-insensitively; a list parameter needs a list of the
// same length holding every selector item (case-insensitive). Omitting a parameter
// means any rating. Mirror of `matches` in liveBuffs in tools/src/cruncher/buffs.ts.
func weaponKeywordRefMatches(ref, selector map[string]any) bool {
	if getStr(ref, "keyword_id") != getStr(selector, "keyword_id") {
		return false
	}
	actualParams := mapOr(ref["parameters"])
	for key, want := range mapOr(selector["parameters"]) {
		actual := actualParams[key]
		if key == "target_keyword" {
			a, aOK := actual.(string)
			b, bOK := want.(string)
			if aOK && bOK {
				if lower(a) != lower(b) {
					return false
				}
				continue
			}
		}
		if wantList, ok := want.([]any); ok {
			actualList, ok := actual.([]any)
			if !ok || len(actualList) != len(wantList) {
				return false
			}
			for _, item := range wantList {
				text, ok := item.(string)
				if !ok {
					return false
				}
				found := false
				for _, candidate := range actualList {
					if c, ok := candidate.(string); ok && lower(c) == lower(text) {
						found = true
						break
					}
				}
				if !found {
					return false
				}
			}
			continue
		}
		if !strictScalarEqual(actual, want) {
			return false
		}
	}
	return true
}

// strictScalarEqual is JS `===` on decoded JSON: scalars compare by value, and
// objects or lists (compared by identity in JS) never match.
func strictScalarEqual(a, b any) bool {
	switch a.(type) {
	case nil, string, float64, bool, int:
		switch b.(type) {
		case nil, string, float64, bool, int:
			if x, ok := num(a); ok {
				if y, ok := num(b); ok {
					return x == y
				}
			}
			return a == b
		}
	}
	return false
}

func weaponSelectorsNeedParameters(selectors []any) bool {
	for _, item := range selectors {
		selector, _ := asMap(item)
		if selector != nil && len(mapOr(selector["parameters"])) > 0 {
			return true
		}
	}
	return false
}

// weaponGatesHold reports whether a buff's weapon gate holds against refs, the
// weapon's printed keyword refs plus those live buffs grant. exclusions selects
// whether the inclusion selectors (weaponKeywords) or the exclusions
// (excludedWeaponKeywords) are checked; weapon names and every weaponRequirements
// entry are checked either way. An exclusion fails closed when a ref of its
// keyword lacks a parameter the exclusion names. refs nil means the context
// carries no weapon keywords: a selector naming no parameters then holds, one
// naming parameters fails. Mirror of `gatesHold` in tools/src/cruncher/buffs.ts.
func weaponGatesHold(gate map[string]any, refs []map[string]any, ctx map[string]any, exclusions bool) bool {
	if gate == nil {
		return true
	}
	if wn, ok := gate["weaponName"].(string); ok && ctx["weaponNames"] != nil && !containsAny(getList(ctx, "weaponNames"), wn) {
		return false
	}
	if excluded, ok := asList(gate["excludedWeaponNames"]); ok && ctx["weaponNames"] != nil {
		for _, name := range excluded {
			if n, ok := name.(string); ok && containsAny(getList(ctx, "weaponNames"), n) {
				return false
			}
		}
	}
	if gate["unresolvedWeaponRef"] != nil {
		return false
	}
	for _, requirementAny := range anyList(gate["weaponRequirements"]) {
		requirement, _ := asMap(requirementAny)
		if !weaponGatesHold(requirement, refs, ctx, exclusions) {
			return false
		}
	}
	if !exclusions {
		if legacy, ok := gate["weaponKeyword"].(string); ok && refs != nil {
			found := false
			for _, ref := range refs {
				if keywordKey(getStr(ref, "keyword_id")) == keywordKey(legacy) {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
	}
	key := "weaponKeywords"
	if exclusions {
		key = "excludedWeaponKeywords"
	}
	selectors := anyList(gate[key])
	if gate[key] == nil {
		return true
	}
	if refs == nil {
		return !weaponSelectorsNeedParameters(selectors)
	}
	found := false
	for _, selectorAny := range selectors {
		selector, _ := asMap(selectorAny)
		if selector == nil {
			continue
		}
		for _, ref := range refs {
			if exclusions && getStr(ref, "keyword_id") == getStr(selector, "keyword_id") {
				params := mapOr(ref["parameters"])
				for name := range mapOr(selector["parameters"]) {
					if _, present := params[name]; !present {
						return false
					}
				}
			}
			if weaponKeywordRefMatches(ref, selector) {
				found = true
			}
		}
	}
	return found != exclusions
}

// printedWeaponKeywordRefs is the weapon's printed keywords as refs: the context's
// weaponKeywordRefs, else its weaponKeywords ids, else nil when it carries neither.
func printedWeaponKeywordRefs(ctx map[string]any) []map[string]any {
	refs := []map[string]any{}
	if ctx["weaponKeywordRefs"] != nil {
		for _, raw := range anyList(ctx["weaponKeywordRefs"]) {
			if ref, ok := asMap(raw); ok && ref != nil {
				refs = append(refs, ref)
			}
		}
		return refs
	}
	if ctx["weaponKeywords"] != nil {
		for _, raw := range getList(ctx, "weaponKeywords") {
			if id, ok := raw.(string); ok {
				refs = append(refs, map[string]any{"keyword_id": id})
			}
		}
		return refs
	}
	return nil
}

// withGrantedKeywords appends the keyword refs that the included buffs grant to printed.
func withGrantedKeywords(printed []map[string]any, buffs []any, included []bool) []map[string]any {
	if printed == nil {
		return nil
	}
	refs := append([]map[string]any{}, printed...)
	for i, bAny := range buffs {
		if !included[i] {
			continue
		}
		b, _ := asMap(bAny)
		c, _ := getMap(b, "contribution")
		if getStr(c, "type") == "extra-keyword" {
			if ref, ok := getMap(c, "keywordRef"); ok && ref != nil {
				refs = append(refs, ref)
			}
		}
	}
	return refs
}

// liveBuffs reports, per buff, whether its gates hold. A weapon-keyword gate reads
// the weapon's printed keywords plus the keywords other live buffs grant, so one
// pass is repeated until no further gated buff joins ("weapons with Lethal Hits
// gain Rapid Fire 1" sees a granted Lethal Hits). Positive dependencies resolve
// first; exclusions then apply against the complete candidate keyword set so a
// granted keyword cannot bypass one, and buffs whose inclusion rested on an
// excluded buff's keyword drop out until the set is stable. Mirror of liveBuffs
// in tools/src/cruncher/buffs.ts.
func liveBuffs(buffs []any, ctx map[string]any) []bool {
	gates := make([]map[string]any, len(buffs))
	base := make([]bool, len(buffs))
	for i, bAny := range buffs {
		b, _ := asMap(bAny)
		gates[i], _ = getMap(b, "applicableWhen")
		base[i] = buffApplies(b, ctx)
	}
	printed := printedWeaponKeywordRefs(ctx)
	selected := make([]bool, len(buffs))
	for {
		refs := withGrantedKeywords(printed, buffs, selected)
		joined := false
		for i := range buffs {
			if base[i] && !selected[i] && weaponGatesHold(gates[i], refs, ctx, false) {
				selected[i] = true
				joined = true
			}
		}
		if !joined {
			break
		}
	}
	refs := withGrantedKeywords(printed, buffs, selected)
	live := make([]bool, len(buffs))
	for i := range buffs {
		live[i] = selected[i] && weaponGatesHold(gates[i], refs, ctx, true)
	}
	for {
		remaining := withGrantedKeywords(printed, buffs, live)
		dropped := false
		for i := range buffs {
			if live[i] && !weaponGatesHold(gates[i], remaining, ctx, false) {
				live[i] = false
				dropped = true
			}
		}
		if !dropped {
			return live
		}
	}
}

func keyOf(ref map[string]any) string {
	params, _ := getMap(ref, "parameters")
	if params == nil {
		params = map[string]any{}
	}
	b, _ := json.Marshal(params)
	return getStr(ref, "keyword_id") + "::" + string(b)
}

type rerollEntry struct {
	subset string
	rank   int
}

type extraKw struct {
	keywordRef map[string]any
	source     map[string]any
}

type fnpState struct{ threshold float64 }

// rankedValue is a best-wins value with the rank of the source that set it.
type rankedValue struct {
	value float64
	rank  int
}
type invState struct{ threshold float64 }

type resolved struct {
	hitMod, woundMod                            float64
	saveMod, damageMod, attacksMod, strengthMod float64
	toughnessMod, apMod                         float64
	coverActive                                 bool
	coverRank                                   int
	rerolls                                     map[string]rerollEntry
	// rerollOne holds, per roll, the rank of the dominant "reroll-one" source;
	// several sources still give one die.
	rerollOne                    map[string]int
	extraKeywords                []extraKw
	feelNoPain, feelNoPainMortal *fnpState
	damageReduction              float64
	damageReductionSet           bool
	damageReductionRank          int
	invulnerable                 *invState
	invulnerableRank             int
	// critThresholds holds the lowest critical threshold per roll ("hit"/"wound").
	critThresholds map[string]rankedValue
	// ignoreModifiers holds the rank of the source per roll whose negative modifiers are ignored.
	ignoreModifiers map[string]int
	// skillMod sums WS/BS characteristic improvements.
	skillMod map[string]float64
	// saveCharacteristic is the ability-set Save; nil keeps the printed one.
	saveCharacteristic *rankedValue
}

type contribAcc struct {
	value  float64
	source map[string]any
}

// resolveBuffs collapses a flat buff stack into a resolved-modifiers read-out.
func resolveBuffs(buffs []any, ctx map[string]any) *resolved {
	out := &resolved{
		rerolls:         map[string]rerollEntry{},
		rerollOne:       map[string]int{},
		critThresholds:  map[string]rankedValue{},
		ignoreModifiers: map[string]int{},
		skillMod:        map[string]float64{"WS": 0, "BS": 0},
	}

	var hitContribs, woundContribs []contribAcc
	live := liveBuffs(buffs, ctx)
	for i, bAny := range buffs {
		b, _ := asMap(bAny)
		if !live[i] {
			continue
		}
		c, _ := getMap(b, "contribution")
		source, _ := getMap(b, "source")
		val, _ := num(c["value"])
		switch getStr(c, "type") {
		case "hit-mod":
			hitContribs = append(hitContribs, contribAcc{val, source})
		case "wound-mod":
			woundContribs = append(woundContribs, contribAcc{val, source})
		case "save-mod":
			out.saveMod += val
		case "cover":
			if !out.coverActive || rankOf(source) < out.coverRank {
				out.coverActive = true
				out.coverRank = rankOf(source)
			}
		case "reroll":
			roll := getStr(c, "roll")
			incoming := getStr(c, "subset")
			cur, exists := out.rerolls[roll]
			if !exists {
				out.rerolls[roll] = rerollEntry{incoming, rankOf(source)}
			} else {
				stronger := (incoming == "all-failures" && cur.subset == "ones") ||
					(incoming == cur.subset && rankOf(source) < cur.rank)
				if stronger {
					out.rerolls[roll] = rerollEntry{incoming, rankOf(source)}
				}
			}
		case "reroll-one":
			roll := getStr(c, "roll")
			if cur, exists := out.rerollOne[roll]; !exists || rankOf(source) < cur {
				out.rerollOne[roll] = rankOf(source)
			}
		case "extra-keyword":
			ref, _ := getMap(c, "keywordRef")
			key := keyOf(ref)
			dup := false
			for _, e := range out.extraKeywords {
				if keyOf(e.keywordRef) == key {
					dup = true
					break
				}
			}
			if !dup {
				out.extraKeywords = append(out.extraKeywords, extraKw{ref, source})
			}
		case "feel-no-pain":
			threshold, _ := num(c["threshold"])
			if getStr(c, "scope") == "mortal" {
				if out.feelNoPainMortal == nil || threshold < out.feelNoPainMortal.threshold {
					out.feelNoPainMortal = &fnpState{threshold}
				}
			} else {
				if out.feelNoPain == nil || threshold < out.feelNoPain.threshold {
					out.feelNoPain = &fnpState{threshold}
				}
			}
		case "damage-mod":
			out.damageMod += val
		case "attacks-mod":
			out.attacksMod += val
		case "strength-mod":
			out.strengthMod += val
		case "toughness-mod":
			out.toughnessMod += val
		case "ap-mod":
			out.apMod += val
		case "damage-reduction":
			if !out.damageReductionSet || val > out.damageReduction ||
				(val == out.damageReduction && rankOf(source) < out.damageReductionRank) {
				out.damageReduction = val
				out.damageReductionSet = true
				out.damageReductionRank = rankOf(source)
			}
		case "invulnerable-save":
			threshold, _ := num(c["threshold"])
			if out.invulnerable == nil || threshold < out.invulnerable.threshold ||
				(threshold == out.invulnerable.threshold && rankOf(source) < out.invulnerableRank) {
				out.invulnerable = &invState{threshold}
				out.invulnerableRank = rankOf(source)
			}
		case "crit-threshold":
			roll := getStr(c, "roll")
			cur, exists := out.critThresholds[roll]
			if !exists || val < cur.value || (val == cur.value && rankOf(source) < cur.rank) {
				out.critThresholds[roll] = rankedValue{val, rankOf(source)}
			}
		case "ignore-modifiers":
			roll := getStr(c, "roll")
			cur, exists := out.ignoreModifiers[roll]
			if !exists || rankOf(source) < cur {
				out.ignoreModifiers[roll] = rankOf(source)
			}
		case "skill-mod":
			out.skillMod[getStr(c, "stat")] += val
		case "save-characteristic":
			sc := out.saveCharacteristic
			if sc == nil || val < sc.value || (val == sc.value && rankOf(source) < sc.rank) {
				out.saveCharacteristic = &rankedValue{val, rankOf(source)}
			}
		}
	}
	_, ignoreHit := out.ignoreModifiers["hit"]
	_, ignoreWound := out.ignoreModifiers["wound"]
	out.hitMod = capModifier(keptContribs(hitContribs, ignoreHit))
	out.woundMod = capModifier(keptContribs(woundContribs, ignoreWound))
	return out
}

// keptContribs drops the negative modifiers of an ignored roll; its positive ones still apply.
func keptContribs(contribs []contribAcc, ignored bool) []contribAcc {
	if !ignored {
		return contribs
	}
	kept := make([]contribAcc, 0, len(contribs))
	for _, c := range contribs {
		if c.value > 0 {
			kept = append(kept, c)
		}
	}
	return kept
}

func capModifier(contribs []contribAcc) float64 {
	if len(contribs) == 0 {
		return 0
	}
	total := 0.0
	for _, c := range contribs {
		total += c.value
	}
	capped := math64Max(-1, math64Min(1, total))
	return capped
}

func math64Max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
func math64Min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// findKeyword returns the keywordRef of the first extra-keyword matching id.
func (r *resolved) findKeyword(id string) map[string]any {
	for _, e := range r.extraKeywords {
		if getStr(e.keywordRef, "keyword_id") == id {
			return e.keywordRef
		}
	}
	return nil
}
