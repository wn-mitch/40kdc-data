package wh40kdc

import (
	"math"
	"sort"
)

// Critical wounds with their own AP and Damage. A buff gated
// `onCritical: "wound"` applies only to the attacks that score a critical
// wound, so those wounds take their save at their own AP and deal their own
// Damage, and with Devastating Wounds their mortal wounds deal that Damage.
// Mirror of tools/src/cruncher/critical-wounds.ts.

// CriticalWound is a critical wound's chance to go unsaved and its per-attack
// Damage, ascending by value.
type CriticalWound struct {
	Unsaved float64
	Damage  []DamageOutcome
}

// hasCriticalWoundBuffs reports whether any buff applies only on a critical wound.
func hasCriticalWoundBuffs(buffs []any) bool {
	for _, raw := range buffs {
		buff, _ := asMap(raw)
		when, _ := getMap(buff, "applicableWhen")
		if getStr(when, "onCritical") == "wound" {
			return true
		}
	}
	return false
}

// resolveCriticalWound resolves the buffs for an attack that scored a critical wound.
func resolveCriticalWound(buffs []any, ctx map[string]any) *resolved {
	critical := cloneMap(ctx)
	critical["criticalRoll"] = "wound"
	return resolveBuffs(buffs, critical)
}

// saveStream is one stream of wounds taking a save: its wounds, save chance,
// re-rollable failure chance and re-rolled save chance.
type saveStream struct {
	wounds, saved, open, fresh float64
}

// splitUnsaved returns the expected unsaved wounds of streams that take the
// same save at different targets, with a "re-roll one saving throw" spent on
// the stream a failed save is likelier to come from, and the re-rolled dice.
func splitUnsaved(streams []saveStream, rerollOne bool) (unsaved, dice float64) {
	pool, failing, refunded := 0.0, 0.0, 0.0
	for _, s := range streams {
		unsaved += s.wounds * (1 - s.saved)
		pool += s.wounds
		failing += s.wounds * s.open
		refunded += s.wounds * s.open * s.fresh
	}
	if !rerollOne || pool <= 0 || failing <= 0 {
		return unsaved, 0
	}
	dice = oneRerollDice(pool, failing/pool)
	// The re-rolled save comes from each stream in proportion to its re-rollable failures.
	return unsaved - dice*refunded/failing, dice
}

// mixDistributions mixes per-roll damage distributions by weight, ascending by
// value with each value once, as oneDamageRerollGain reads them.
func mixDistributions(weights []float64, distributions [][]DamageOutcome) []DamageOutcome {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	byValue := map[float64]float64{}
	for i, distribution := range distributions {
		for _, outcome := range distribution {
			if total > 0 {
				byValue[outcome.Value] += outcome.Probability * weights[i] / total
			} else {
				byValue[outcome.Value] += 0
			}
		}
	}
	mixed := make([]DamageOutcome, 0, len(byValue))
	for value, probability := range byValue {
		mixed = append(mixed, DamageOutcome{Value: value, Probability: probability})
	}
	sort.Slice(mixed, func(i, j int) bool { return mixed[i].Value < mixed[j].Value })
	return mixed
}

// criticalSaveStream is the save a stream of wounds takes at target.
func criticalSaveStream(target, wounds float64, reroll string) saveStream {
	if target >= 7 {
		return saveStream{wounds: wounds}
	}
	pass, _, open := checkProbabilities(target, 0, reroll, true, false, 7)
	fresh, _, _ := checkProbabilities(target, 0, "none", true, false, 7)
	return saveStream{wounds: wounds, saved: pass, open: open, fresh: fresh}
}

// attackAp is the AP an attack has under r; worsening AP stops at 0.
func attackAp(r *resolved, printedAp any) float64 {
	return math.Min(0, numOr0(r.setOr("AP", printedAp))+r.apMod)
}
