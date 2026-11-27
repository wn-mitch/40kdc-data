package wh40kdc

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Exact allocation into an attached unit: Go mirror of allocateAttached in
// tools/src/cruncher/allocation.ts.

// TargetGroup is one allocation group of an attached target unit (rules 05.03
// and 05.04): one for each CHARACTER model, and one for the other models with
// the same W, Sv and InSv.
type TargetGroup struct {
	Character bool `json:"character"`
}

// GroupAllocation is one group's share of an attached allocation.
type GroupAllocation struct {
	// ModelsDestroyedDistribution is the probability of each number of the
	// group's models destroyed, from 0 to the group's size.
	ModelsDestroyedDistribution []float64 `json:"modelsDestroyedDistribution"`
}

// AttachedAllocationOutput is AllocateAttached's result: the unit's, and each
// group's models destroyed.
type AttachedAllocationOutput struct {
	AllocationOutput
	// WoundsDealtDistribution is the probability of each number of wounds
	// removed from the target unit, from 0 to all of them.
	WoundsDealtDistribution []float64 `json:"woundsDealtDistribution"`
	// Groups is, for each group in the order given, the probability of each
	// number of its models destroyed.
	Groups []GroupAllocation `json:"groups"`
}

// MaxAttachedStates is the largest number of target states AllocateAttached
// tracks before it refuses.
const MaxAttachedStates = 200_000

// sharedRolls is the fields of an attack's model that every group of an
// attached target must share.
func sharedRolls(m *AttackModel) string {
	b, _ := json.Marshal([]any{m.ModelsFiring, m.AttacksStat, m.AttacksReroll, m.AttacksBonus, m.RapidFireStat, m.Torrent, m.HitPass, m.HitCrit, m.SustainedStat, m.Lethal, m.WoundPass, m.WoundCrit, m.Devastating, m.Precision, m.RollMortals})
	return string(b)
}

// AllocateAttached is the exact allocation of several attack lines into an
// attached unit, fired in the order given. lines[l][g] is line l crunched
// against group g: the same attacker and context, with the group's own
// profile, model count and defensive buffs. Each group must see the same Hit
// and Wound rolls, so give every group the attached unit's keywords and its
// Toughness, the highest among the Bodyguard models (05.02.01), and its models
// as context targetModelCount, which Blast and Cleave count.
//
// groups is the defender's allocation order, CHARACTER groups after every
// other group. The current group is the first with a model left; an attack's
// save, Damage and Feel No Pain are that group's, and the damaged model takes
// the next attack. A line with [PRECISION] starts on the first CHARACTER group
// with a model left and keeps it current until the line is resolved or the
// group is destroyed. Saves are made as each wound reaches the current group
// rather than all at once and sorted lowest first, which is exact while every
// group has the same save.
//
// With one group this is the lines allocated in turn into one unit, each from
// what the earlier lines left. Without an explicit defences.Zeroing, the first
// line's first group supplies the damage-zeroing defence, shared across the
// groups.
func AllocateAttached(lines [][]map[string]any, groups []TargetGroup, ds *Dataset, defences AllocationDefences) (AttachedAllocationOutput, error) {
	if len(groups) == 0 {
		return AttachedAllocationOutput{}, &crunchError{"allocateAttached: the target needs at least one group"}
	}
	seenCharacter := false
	for _, group := range groups {
		if group.Character {
			seenCharacter = true
		} else if seenCharacter {
			return AttachedAllocationOutput{}, &crunchError{"allocateAttached: no CHARACTER group can come before a non-CHARACTER group"}
		}
	}
	for _, line := range lines {
		if len(line) != len(groups) {
			return AttachedAllocationOutput{}, &crunchError{"allocateAttached: every line needs one input per group (" + strconv.Itoa(len(groups)) + "), got " + strconv.Itoa(len(line))}
		}
	}
	crunched := make([][]*AttackModel, len(lines))
	for l, line := range lines {
		crunched[l] = make([]*AttackModel, len(line))
		for g, input := range line {
			_, res, model, err := crunchModel(input, ds)
			if err != nil {
				return AttachedAllocationOutput{}, err
			}
			if l == 0 && g == 0 && defences.Zeroing == nil {
				switch {
				case res.zeroingUnit > 0 && res.zeroingModel > 0:
					return AttachedAllocationOutput{}, &crunchError{"allocate: unit-wide and per-model damage zeroing together are not modelled"}
				case res.zeroingUnit > 0:
					defences.Zeroing = &DamageZeroing{Uses: res.zeroingUnit, Per: "unit"}
				case res.zeroingModel > 0:
					defences.Zeroing = &DamageZeroing{Uses: res.zeroingModel, Per: "model"}
				}
			}
			crunched[l][g] = model
		}
	}
	zeroing, err := zeroingOf(defences)
	if err != nil {
		return AttachedAllocationOutput{}, err
	}
	if len(groups) == 1 {
		if len(crunched) == 0 {
			return AttachedAllocationOutput{AllocationOutput{0, 0, []float64{1}}, []float64{1}, []GroupAllocation{{[]float64{1}}}}, nil
		}
		first := crunched[0][0]
		var start []float64
		var result allocated
		for _, line := range crunched {
			model := line[0]
			if model.ModelCount != first.ModelCount || model.Wounds != first.Wounds {
				return AttachedAllocationOutput{}, &crunchError{"allocateSequence: every line must target the same unit"}
			}
			result, err = allocateFrom(model, zeroing, start)
			if err != nil {
				return AttachedAllocationOutput{}, err
			}
			start = result.final
		}
		out, dealt := summariseAllocation(result)
		return AttachedAllocationOutput{out, dealt, []GroupAllocation{{out.ModelsDestroyedDistribution}}}, nil
	}
	if len(crunched) == 0 {
		return AttachedAllocationOutput{}, &crunchError{"allocateAttached: give at least one line to read the target's groups from"}
	}
	geometry := make([]groupGeometry, len(groups))
	for g, model := range crunched[0] {
		models, err := integral(model.ModelCount, "target models")
		if err != nil {
			return AttachedAllocationOutput{}, err
		}
		wounds, err := integral(model.Wounds, "target Wounds")
		if err != nil {
			return AttachedAllocationOutput{}, err
		}
		geometry[g] = groupGeometry{models, wounds}
	}
	var state []float64
	for _, models := range crunched {
		shared := sharedRolls(models[0])
		for g, model := range models {
			if len(model.Unmodelled) > 0 {
				return AttachedAllocationOutput{}, fmt.Errorf("allocate: %s not modelled by exact allocation", strings.Join(model.Unmodelled, ", "))
			}
			if model.ModelCount != float64(geometry[g].models) || model.Wounds != float64(geometry[g].wounds) {
				return AttachedAllocationOutput{}, &crunchError{"allocateAttached: every line must target the same groups"}
			}
			if sharedRolls(model) != shared {
				return AttachedAllocationOutput{}, &crunchError{"allocateAttached: the groups disagree on the attack's Hit or Wound rolls; give each group the attached unit's keywords, Toughness and model count"}
			}
		}
		state, err = allocateGroupsFrom(models, groups, geometry, zeroing, state)
		if err != nil {
			return AttachedAllocationOutput{}, err
		}
	}
	return summarizeGroups(state, geometry, zeroing.Uses+1), nil
}

type groupGeometry struct{ models, wounds int }

// groupStrides is the mixed-radix strides of the groups' remaining wounds,
// and the number of cells.
func groupStrides(geometry []groupGeometry) ([]int, int) {
	strides := make([]int, len(geometry))
	cells := 1
	for g, group := range geometry {
		strides[g] = cells
		cells *= group.models*group.wounds + 1
	}
	return strides, cells
}

// What one wound, critical wound, ability mortal wound or Devastating Wounds
// mortal wound does to the current group.
const (
	kindWound = iota
	kindCritical
	kindOne
	kindDev
)

type groupKind struct {
	unsaved  float64
	removed  []float64
	zeroable bool
}

// allocateGroupsFrom is one line's attacks into the groups, from start (an
// earlier line's states) or (nil) the unit at full strength. A state is the
// wounds each group has left, plus zeroing uses left: a group has at most one
// damaged model, so its wounds left say how many models it has and how hurt
// the damaged one is.
func allocateGroupsFrom(models []*AttackModel, groups []TargetGroup, geometry []groupGeometry, zeroing DamageZeroing, start []float64) ([]float64, error) {
	model := models[0]
	uses := zeroing.Uses + 1
	strides, cells := groupStrides(geometry)
	size := cells * uses
	if size > MaxAttachedStates {
		return nil, &crunchError{"allocate: the attached unit's " + strconv.Itoa(size) + " states exceed the exact allocation bound (" + strconv.Itoa(MaxAttachedStates) + ")"}
	}
	left := func(cell, g int) int {
		return cell / strides[g] % (geometry[g].models*geometry[g].wounds + 1)
	}
	full := 0
	for g, group := range geometry {
		full += group.models * group.wounds * strides[g]
	}
	zeros := func() []float64 { return make([]float64, size) }
	initial := zeros()
	if start != nil {
		copy(initial, start)
	} else {
		initial[full*uses+uses-1] = 1
	}

	split := false
	for _, m := range models {
		split = split || m.CriticalWound != nil
	}
	split = split && !model.Devastating
	params := make([][4]groupKind, len(models))
	for g, m := range models {
		critical := CriticalWound{Unsaved: m.Unsaved, Damage: m.Damage}
		if m.CriticalWound != nil {
			critical = *m.CriticalWound
		}
		devRoll := m.Damage
		if m.CriticalWound != nil {
			devRoll = m.CriticalWound.Damage
		}
		wound, err := woundsLost(m.Damage, m.WoundLost)
		if err != nil {
			return nil, err
		}
		crit, err := woundsLost(critical.Damage, m.WoundLost)
		if err != nil {
			return nil, err
		}
		one, err := woundsLost([]DamageOutcome{{1, 1}}, m.MortalWoundLost)
		if err != nil {
			return nil, err
		}
		dev, err := woundsLost(devRoll, m.MortalWoundLost)
		if err != nil {
			return nil, err
		}
		params[g] = [4]groupKind{
			kindWound:    {m.Unsaved, wound, true},
			kindCritical: {critical.Unsaved, crit, true},
			kindOne:      {1, one, false},
			kindDev:      {1, dev, false},
		}
	}
	firstAlive := func(cell int, order []int) int {
		for _, g := range order {
			if left(cell, g) > 0 {
				return g
			}
		}
		return -1
	}
	defaultOrder := make([]int, len(groups))
	var characters []int
	for g, group := range groups {
		defaultOrder[g] = g
		if group.Character {
			characters = append(characters, g)
		}
	}

	tableModel := *model
	tableModel.Unsaved = 1
	if split {
		tableModel.CriticalWound = &CriticalWound{Unsaved: 1, Damage: model.Damage}
	}
	per, err := perAttackEvents(&tableModel)
	if err != nil {
		return nil, err
	}
	per = trimJoint(per)
	counts, err := attackCounts(model)
	if err != nil {
		return nil, err
	}
	most := len(counts) - 1
	span := func(size int) int { return most*(size-1) + 1 }
	work := most * span(len(per)) * span(len(per[0])) * span(len(per[0][0]))
	if work > MaxEventWork {
		return nil, &crunchError{"allocate: " + strconv.Itoa(most) + " attacks exceed the exact allocation bound (work " + strconv.Itoa(work) + " > " + strconv.Itoa(MaxEventWork) + ")"}
	}
	mortals, err := rollMortalsOf(model)
	if err != nil {
		return nil, err
	}
	normalHit, critHit := model.HitPass-model.HitCrit, model.HitCrit
	if model.Torrent {
		normalHit, critHit = 1, 0
	}
	extras, err := optionalQuantity(model.SustainedStat)
	if err != nil {
		return nil, err
	}
	extras = append([]DamageOutcome(nil), extras...)
	sort.SliceStable(extras, func(i, j int) bool { return extras[i].Value < extras[j].Value })
	extraCounts := make([]int, len(extras))
	for i, extra := range extras {
		if extraCounts[i], err = integral(extra.Value, "Sustained Hits"); err != nil {
			return nil, err
		}
	}
	events := joint{{{0}}}
	if !split {
		acc := joint{{{1}}}
		for attacks := 0; attacks <= most; attacks++ {
			if weight := counts[attacks]; weight > 0 {
				events = addJoint(events, acc, weight)
			}
			if attacks < most {
				acc = convolveJoint(acc, per)
			}
		}
	}

	// The line's attacks from one share of the start, chosen the group
	// [PRECISION] keeps current.
	run := func(from []float64, chosen int) []float64 {
		current := make([]int, cells)
		for cell := range current {
			if chosen >= 0 && left(cell, chosen) > 0 {
				current[cell] = chosen
			} else {
				current[cell] = firstAlive(cell, defaultOrder)
			}
		}
		step := func(state []float64, kind int) []float64 {
			out := zeros()
			for id, p := range state {
				if p == 0 {
					continue
				}
				cell := id / uses
				g := current[cell]
				if g < 0 {
					out[id] += p
					continue
				}
				k := params[g][kind]
				if k.unsaved < 1 {
					out[id] += p * (1 - k.unsaved)
				}
				hit := p * k.unsaved
				if hit == 0 {
					continue
				}
				unused := id % uses
				if k.zeroable && unused > 0 {
					out[id-1] += hit
					continue
				}
				wounds := geometry[g].wounds
				remaining := left(cell, g)
				alive := (remaining + wounds - 1) / wounds
				onModel := remaining - (alive-1)*wounds
				for amount, q := range k.removed {
					if q == 0 {
						continue
					}
					kills := amount >= onModel
					next := remaining
					switch {
					case amount == 0:
					case kills:
						next = (alive - 1) * wounds
					default:
						next = remaining - amount
					}
					refilled := unused
					if kills && zeroing.Per == "model" {
						refilled = uses - 1
					}
					out[(cell+(next-remaining)*strides[g])*uses+refilled] += hit * q
				}
			}
			return out
		}
		stepAll := func(from layers, kind int) layers {
			out := make(layers, len(from))
			for k, layer := range from {
				out[k] = step(layer, kind)
			}
			return out
		}
		shiftAll := func(from layers, by int) layers {
			if by == 0 {
				return from
			}
			out := make(layers, 0, by+len(from))
			for i := 0; i < by; i++ {
				out = append(out, zeros())
			}
			return append(out, from...)
		}
		var pending layers
		if split {
			// Critical wounds with their own save or Damage land in the order their hits wound.
			type part struct {
				weight float64
				state  layers
			}
			blend := func(parts []part) layers {
				out := layers{zeros()}
				for _, p := range parts {
					if p.weight > 0 {
						out = gatherLayers(out, p.state, p.weight, size-1)
					}
				}
				return out
			}
			woundRoll := func(from layers, extra int) layers {
				return blend([]part{
					{1 - model.WoundPass, from},
					{model.WoundPass - model.WoundCrit, shiftAll(stepAll(from, kindWound), mortals.wound)},
					{model.WoundCrit, shiftAll(stepAll(from, kindCritical), mortals.wound+mortals.criticalWound+extra)},
				})
			}
			firstWound := func(from layers) layers {
				if model.Lethal {
					return shiftAll(stepAll(from, kindWound), mortals.wound)
				}
				return woundRoll(from, mortals.criticalWoundOfCriticalHit)
			}
			attack := func(from layers) layers {
				parts := []part{{1 - normalHit - critHit, from}, {normalHit, shiftAll(woundRoll(from, 0), mortals.hit)}}
				if critHit > 0 {
					after := firstWound(shiftAll(from, mortals.hit+mortals.criticalHit))
					done := 0
					for i, count := range extraCounts {
						for ; done < count; done++ {
							after = woundRoll(after, 0)
						}
						parts = append(parts, part{critHit * extras[i].Probability, after})
					}
				}
				return blend(parts)
			}
			state := layers{from}
			for attacks := 0; attacks <= most; attacks++ {
				if weight := counts[attacks]; weight > 0 {
					pending = gatherLayers(pending, state, weight, size-1)
				}
				if attacks == most {
					break
				}
				state = attack(state)
			}
		} else {
			// Wounds, then the ability's mortal wounds, then Devastating Wounds' mortal wounds.
			target := zeros()
			afterNormal := from
			for normalEvents, row := range events {
				if normalEvents > 0 {
					afterNormal = step(afterNormal, kindWound)
				}
				afterOnes := afterNormal
				for ones := 0; ones < len(row[0]); ones++ {
					anyPositive := false
					for _, cell := range row {
						for _, p := range cell[ones:] {
							anyPositive = anyPositive || p > 0
						}
					}
					if !anyPositive {
						break
					}
					if ones > 0 {
						afterOnes = step(afterOnes, kindOne)
					}
					after := afterOnes
					for devEvents, cell := range row {
						if devEvents > 0 {
							after = step(after, kindDev)
						}
						if p := cell[ones]; p > 0 {
							for id, q := range after {
								target[id] += p * q
							}
						}
					}
				}
			}
			pending = layers{target}
		}
		final := zeros()
		if len(pending) > 0 && pending[len(pending)-1] != nil {
			final = pending[len(pending)-1]
		}
		for k := len(pending) - 2; k >= 0; k-- {
			final = step(final, kindOne)
			for id, q := range pending[k] {
				final[id] += q
			}
		}
		return final
	}

	if !model.Precision || len(characters) == 0 {
		return run(initial, -1), nil
	}
	// [PRECISION] picks a CHARACTER group at the start of the line: split the start by which one,
	// indexed by the chosen group plus one (0 when no CHARACTER group is left).
	shares := make([][]float64, len(groups)+1)
	for id, p := range initial {
		if p == 0 {
			continue
		}
		chosen := firstAlive(id/uses, characters)
		if shares[chosen+1] == nil {
			shares[chosen+1] = zeros()
		}
		shares[chosen+1][id] += p
	}
	out := zeros()
	for index, share := range shares {
		if share == nil {
			continue
		}
		for id, q := range run(share, index-1) {
			out[id] += q
		}
	}
	return out, nil
}

func summarizeGroups(final []float64, geometry []groupGeometry, uses int) AttachedAllocationOutput {
	strides, _ := groupStrides(geometry)
	total, totalWounds := 0, 0
	byGroup := make([]GroupAllocation, len(geometry))
	for g, group := range geometry {
		total += group.models
		totalWounds += group.models * group.wounds
		byGroup[g] = GroupAllocation{make([]float64, group.models+1)}
	}
	destroyed := make([]float64, total+1)
	dealt := make([]float64, totalWounds+1)
	damageDealt := 0.0
	for id, p := range final {
		if p == 0 {
			continue
		}
		cell := id / uses
		killed, lost := 0, 0
		for g, group := range geometry {
			remaining := cell / strides[g] % (group.models*group.wounds + 1)
			dead := group.models - (remaining+group.wounds-1)/group.wounds
			byGroup[g].ModelsDestroyedDistribution[dead] += p
			killed += dead
			lost += group.models*group.wounds - remaining
		}
		destroyed[killed] += p
		dealt[lost] += p
		damageDealt += p * float64(lost)
	}
	modelsDestroyed := 0.0
	for count, p := range destroyed {
		modelsDestroyed += p * float64(count)
	}
	return AttachedAllocationOutput{AllocationOutput{damageDealt, modelsDestroyed, destroyed}, dealt, byGroup}
}
