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
		if getStr(contribution, "type") == "reroll" && getStr(contribution, "roll") != rt {
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
	// Range gate: drop only when distance is known and exceeds the range.
	if w["maxRangeInches"] != nil && ctx["distanceInches"] != nil {
		maxRange, _ := num(w["maxRangeInches"])
		distance, _ := num(ctx["distanceInches"])
		if distance > maxRange {
			return false
		}
	}
	// Weapon-name gate: permissive when the context carries no weaponNames.
	if wn, ok := w["weaponName"].(string); ok && ctx["weaponNames"] != nil {
		if !containsAny(getList(ctx, "weaponNames"), wn) {
			return false
		}
	}
	return true
}

// weaponKeywordGate is the buff's applicableWhen.weaponKeyword, if it carries one.
func weaponKeywordGate(buff map[string]any) (string, bool) {
	w, _ := getMap(buff, "applicableWhen")
	k, ok := w["weaponKeyword"].(string)
	return k, ok
}

// liveBuffs reports, per buff, whether its gates hold. A weapon-keyword gate
// reads the weapon's printed keywords plus the keywords other live buffs grant,
// so one pass is repeated until no further gated buff joins ("weapons with
// Lethal Hits gain Rapid Fire 1" sees a granted Lethal Hits). Permissive when
// the context carries no weaponKeywords.
func liveBuffs(buffs []any, ctx map[string]any) []bool {
	live := make([]bool, len(buffs))
	pending := make([]bool, len(buffs))
	gatedByKeyword := ctx["weaponKeywords"] != nil
	for i, bAny := range buffs {
		b, _ := asMap(bAny)
		_, gated := weaponKeywordGate(b)
		if !buffApplies(b, ctx) {
			continue
		}
		if gated && gatedByKeyword {
			pending[i] = true
		} else {
			live[i] = true
		}
	}
	if !gatedByKeyword {
		return live
	}
	for {
		keywords := map[string]bool{}
		for _, k := range getList(ctx, "weaponKeywords") {
			if ks, ok := k.(string); ok {
				keywords[ks] = true
			}
		}
		for i, bAny := range buffs {
			if !live[i] {
				continue
			}
			b, _ := asMap(bAny)
			c, _ := getMap(b, "contribution")
			if getStr(c, "type") == "extra-keyword" {
				ref, _ := getMap(c, "keywordRef")
				keywords[getStr(ref, "keyword_id")] = true
			}
		}
		joined := false
		for i, bAny := range buffs {
			if !pending[i] {
				continue
			}
			b, _ := asMap(bAny)
			if k, _ := weaponKeywordGate(b); keywords[k] {
				pending[i] = false
				live[i] = true
				joined = true
			}
		}
		if !joined {
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
	extraKeywords                               []extraKw
	feelNoPain, feelNoPainMortal                *fnpState
	damageReduction                             float64
	damageReductionSet                          bool
	damageReductionRank                         int
	invulnerable                                *invState
	invulnerableRank                            int
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
