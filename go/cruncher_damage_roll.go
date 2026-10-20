package wh40kdc

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Per-attack damage as an exact distribution over the Damage roll. Go mirror of
// tools/src/cruncher/damage-roll.ts.
//
// A Damage characteristic is either fixed (`3`) or a dice expression (`D6`,
// `2D3`, `D6+1`). Each rolled total passes through the same transform the
// engine applies to every attack: add Melta and the damage modifier, floor at
// 0, then subtract damage reduction to a minimum of 1 when reduction is
// active. The expectation is taken over that transformed value, so a floor or
// a reduction acts on each roll rather than on the mean.

// damageRollInput is the per-attack damage request. reroll is "", "ones", or
// "all-failures".
type damageRollInput struct {
	stat      any     // the profile's printed D: a number or a dice expression
	bonus     float64 // flat bonus added after the roll (Melta at half range)
	modifier  float64 // summed damage modifier
	reduction float64 // defender damage reduction; 0 when inactive
	reroll    string  // damage-roll reroll permission, "" for none
}

type damageOutcome struct {
	value       float64
	probability float64
}

type damageRollResult struct {
	distribution []damageOutcome // ascending by value
	expected     float64
	rerollUsed   bool // whether the reroll permission changed any outcome
}

type diceExpression struct {
	count, die int
	offset     float64
}

// parseDamage returns either a fixed value (dice == nil) or a dice expression.
func parseDamage(stat any) (float64, *diceExpression, error) {
	if isNumber(stat) {
		f, _ := num(stat)
		if !math.IsNaN(f) && !math.IsInf(f, 0) {
			return f, nil, nil
		}
	}
	s, ok := stat.(string)
	if !ok {
		raw, _ := json.Marshal(stat)
		return 0, nil, &crunchError{"damageRoll: unresolved quantity " + string(raw)}
	}
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return 0, nil, &crunchError{"damageRoll: empty quantity"}
	}
	if asNumber, err := strconv.ParseFloat(trimmed, 64); err == nil && !math.IsInf(asNumber, 0) && !math.IsNaN(asNumber) {
		return asNumber, nil, nil
	}
	m := diceRe.FindStringSubmatch(trimmed)
	if m == nil {
		return 0, nil, &crunchError{"damageRoll: cannot parse \"" + s + "\""}
	}
	count := 1
	if m[1] != "" {
		count, _ = strconv.Atoi(m[1])
	}
	die, _ := strconv.Atoi(m[2])
	offset := 0
	if m[3] != "" {
		offset, _ = strconv.Atoi(m[3])
	}
	return 0, &diceExpression{count, die, float64(offset)}, nil
}

type diceTotal struct {
	total       int
	probability float64
}

// diceTotals is the distribution of the summed dice, ascending by total.
func diceTotals(count, die int) []diceTotal {
	totals := []diceTotal{{0, 1}}
	for i := 0; i < count; i++ {
		acc := map[int]float64{}
		var keys []int
		for _, t := range totals {
			for face := 1; face <= die; face++ {
				k := t.total + face
				if _, seen := acc[k]; !seen {
					keys = append(keys, k)
				}
				acc[k] += t.probability / float64(die)
			}
		}
		sort.Ints(keys)
		next := make([]diceTotal, 0, len(keys))
		for _, k := range keys {
			next = append(next, diceTotal{k, acc[k]})
		}
		totals = next
	}
	return totals
}

// damageRoll computes exact per-attack damage. A reroll replaces a roll only
// when the replacement's expected final damage exceeds the kept roll's, which
// is the optimal one-shot policy. `ones` permits rerolling a dice total of 1,
// so it can only act on a single die; `all-failures` permits rerolling any
// total.
func damageRoll(in damageRollInput) (damageRollResult, error) {
	final := func(rolled float64) float64 {
		beforeReduction := math.Max(0, rolled+in.bonus+in.modifier)
		if in.reduction > 0 {
			return math.Max(1, beforeReduction-in.reduction)
		}
		return beforeReduction
	}
	fixed, dice, err := parseDamage(in.stat)
	if err != nil {
		return damageRollResult{}, err
	}
	if dice == nil {
		value := final(fixed)
		return damageRollResult{[]damageOutcome{{value, 1}}, value, false}, nil
	}
	totals := diceTotals(dice.count, dice.die)
	fresh := 0.0
	for _, t := range totals {
		fresh += t.probability * final(float64(t.total)+dice.offset)
	}
	outcomes := map[float64]float64{}
	var values []float64
	add := func(value, probability float64) {
		if _, seen := outcomes[value]; !seen {
			values = append(values, value)
		}
		outcomes[value] += probability
	}
	rerollUsed := false
	for _, t := range totals {
		kept := final(float64(t.total) + dice.offset)
		eligible := in.reroll == "all-failures" || (in.reroll == "ones" && t.total == 1)
		if eligible && kept < fresh {
			rerollUsed = true
			for _, again := range totals {
				add(final(float64(again.total)+dice.offset), t.probability*again.probability)
			}
		} else {
			add(kept, t.probability)
		}
	}
	sort.Float64s(values)
	distribution := make([]damageOutcome, 0, len(values))
	expected := 0.0
	for _, v := range values {
		distribution = append(distribution, damageOutcome{v, outcomes[v]})
		expected += v * outcomes[v]
	}
	return damageRollResult{distribution, expected, rerollUsed}, nil
}
