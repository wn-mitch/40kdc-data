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
	return true
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
}

type contribAcc struct {
	value  float64
	source map[string]any
}

// resolveBuffs collapses a flat buff stack into a resolved-modifiers read-out.
func resolveBuffs(buffs []any, ctx map[string]any) *resolved {
	out := &resolved{rerolls: map[string]rerollEntry{}}

	var hitContribs, woundContribs []contribAcc
	for _, bAny := range buffs {
		b, _ := asMap(bAny)
		if !buffApplies(b, ctx) {
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
		}
	}
	out.hitMod = capModifier(hitContribs)
	out.woundMod = capModifier(woundContribs)
	return out
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
