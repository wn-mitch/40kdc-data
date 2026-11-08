package wh40kdc

import "strconv"

// One attack's joint event distribution for the allocation stage: normal damage
// events, mortal-wound events (Devastating Wounds) or critical-wound events, and
// the mortal wounds an ability inflicts on the attack's rolls. Mirrors perAttack
// and its table helpers in tools/src/cruncher/allocation.ts, in the same
// arithmetic order.

// joint holds probabilities indexed [normal events][mortal events][ability mortal wounds].
type joint [][][]float64

func newJoint(rows, columns, depth int) joint {
	out := make(joint, rows)
	for k := range out {
		out[k] = make([][]float64, columns)
		for j := range out[k] {
			out[k][j] = make([]float64, depth)
		}
	}
	return out
}

func convolveJoint(left, right joint) joint {
	out := newJoint(len(left)+len(right)-1, len(left[0])+len(right[0])-1, len(left[0][0])+len(right[0][0])-1)
	for k, row := range left {
		for j, cell := range row {
			for a, p := range cell {
				if p == 0 {
					continue
				}
				for k2, other := range right {
					for j2, cell2 := range other {
						for a2, q := range cell2 {
							if q != 0 {
								out[k+k2][j+j2][a+a2] += p * q
							}
						}
					}
				}
			}
		}
	}
	return out
}

// trimJoint drops trailing all-zero rows, columns and depth; convolution skips
// zeros, so the nonzero values are unchanged.
func trimJoint(table joint) joint {
	rows := len(table)
	for rows > 1 && allZeroCells(table[rows-1]) {
		rows--
	}
	columns := len(table[0])
	for columns > 1 {
		empty := true
		for _, row := range table[:rows] {
			if !allZero(row[columns-1]) {
				empty = false
				break
			}
		}
		if !empty {
			break
		}
		columns--
	}
	depth := len(table[0][0])
	for depth > 1 {
		empty := true
		for _, row := range table[:rows] {
			for _, cell := range row[:columns] {
				if cell[depth-1] != 0 {
					empty = false
				}
			}
		}
		if !empty {
			break
		}
		depth--
	}
	out := make(joint, rows)
	for k := range out {
		out[k] = make([][]float64, columns)
		for j := range out[k] {
			out[k][j] = append([]float64(nil), table[k][j][:depth]...)
		}
	}
	return out
}

func allZero(row []float64) bool {
	for _, p := range row {
		if p != 0 {
			return false
		}
	}
	return true
}

func allZeroCells(row [][]float64) bool {
	for _, cell := range row {
		if !allZero(cell) {
			return false
		}
	}
	return true
}

func powerJoint(base joint, times int) joint {
	out := joint{{{1}}}
	for i := 0; i < times; i++ {
		out = convolveJoint(out, base)
	}
	return out
}

// addJoint returns into + weight * from, grown to fit both.
func addJoint(into, from joint, weight float64) joint {
	grown := newJoint(max(len(into), len(from)), max(len(into[0]), len(from[0])), max(len(into[0][0]), len(from[0][0])))
	for k, row := range into {
		for j, cell := range row {
			for a, p := range cell {
				grown[k][j][a] += p
			}
		}
	}
	for k, row := range from {
		for j, cell := range row {
			for a, p := range cell {
				grown[k][j][a] += weight * p
			}
		}
	}
	return grown
}

// shiftJoint raises every ability mortal-wound count in table by by.
func shiftJoint(table joint, by int) joint {
	if by == 0 {
		return table
	}
	out := make(joint, len(table))
	for k, row := range table {
		out[k] = make([][]float64, len(row))
		for j, cell := range row {
			out[k][j] = append(make([]float64, by), cell...)
		}
	}
	return out
}

// rollMortalsWhole is RollMortalCounts checked whole and not negative.
type rollMortalsWhole struct {
	hit, criticalHit, wound, criticalWound, criticalWoundOfCriticalHit int
}

func rollMortalsOf(model *AttackModel) (rollMortalsWhole, error) {
	var out rollMortalsWhole
	for _, field := range []struct {
		value float64
		key   string
		into  *int
	}{
		{model.RollMortals.Hit, "hit", &out.hit},
		{model.RollMortals.CriticalHit, "criticalHit", &out.criticalHit},
		{model.RollMortals.Wound, "wound", &out.wound},
		{model.RollMortals.CriticalWound, "criticalWound", &out.criticalWound},
		{model.RollMortals.CriticalWoundOfCriticalHit, "criticalWoundOfCriticalHit", &out.criticalWoundOfCriticalHit},
	} {
		count, err := integral(field.value, "mortal wounds on a roll ("+field.key+")")
		if err != nil {
			return out, err
		}
		if count < 0 {
			return out, &crunchError{"allocate: mortal wounds on a roll (" + field.key + ") must not be negative, got " + strconv.Itoa(count)}
		}
		*field.into = count
	}
	return out, nil
}

// perAttackEvents is the distribution of one attack's normal damage events, its
// second kind of event and the mortal wounds its rolls inflict.
func perAttackEvents(model *AttackModel) (joint, error) {
	mortals, err := rollMortalsOf(model)
	if err != nil {
		return nil, err
	}
	// The second axis counts mortal wounds with Devastating Wounds, otherwise unsaved
	// critical wounds when they have their own save and Damage (CriticalWound), else none.
	normalWound := model.WoundPass - model.WoundCrit
	critToMain := model.WoundCrit
	toSecond := 0.0
	critUnsaved, critRow, critColumn := model.Unsaved, 1, 0
	switch {
	case model.Devastating:
		critToMain = 0
		toSecond = model.WoundCrit
		critUnsaved, critRow, critColumn = 1, 0, 1
	case model.CriticalWound != nil:
		critToMain = 0
		toSecond = model.WoundCrit * model.CriticalWound.Unsaved
		critUnsaved, critRow, critColumn = model.CriticalWound.Unsaved, 0, 1
	}
	toMain := (normalWound + critToMain) * model.Unsaved
	// extra: the mortal wounds a critical wound inflicts beyond every critical wound's.
	woundRoll := func(extra int) joint {
		onWound := mortals.wound
		onCritical := onWound + mortals.criticalWound + extra
		if onWound == 0 && onCritical == 0 {
			return joint{{{1 - toMain - toSecond}, {toSecond}}, {{toMain}, {0}}}
		}
		out := newJoint(2, 2, max(onWound, onCritical)+1)
		out[0][0][0] += 1 - model.WoundPass
		out[1][0][onWound] += normalWound * model.Unsaved
		out[0][0][onWound] += normalWound * (1 - model.Unsaved)
		out[critRow][critColumn][onCritical] += model.WoundCrit * critUnsaved
		out[0][0][onCritical] += model.WoundCrit * (1 - critUnsaved)
		return out
	}
	autoWound := shiftJoint(joint{{{1 - model.Unsaved}}, {{model.Unsaved}}}, mortals.wound)
	normalHit, critHit := model.HitPass-model.HitCrit, model.HitCrit
	if model.Torrent {
		normalHit, critHit = 1, 0
	}
	result := addJoint(joint{{{1 - normalHit - critHit}}}, shiftJoint(woundRoll(0), mortals.hit), normalHit)
	if critHit > 0 {
		first := autoWound
		if !model.Lethal {
			first = woundRoll(mortals.criticalWoundOfCriticalHit)
		}
		plain := woundRoll(0)
		extras, err := optionalQuantity(model.SustainedStat)
		if err != nil {
			return nil, err
		}
		for _, extra := range extras {
			count, err := integral(extra.Value, "Sustained Hits")
			if err != nil {
				return nil, err
			}
			hits := shiftJoint(convolveJoint(first, powerJoint(plain, count)), mortals.hit+mortals.criticalHit)
			result = addJoint(result, hits, critHit*extra.Probability)
		}
	}
	return result, nil
}
