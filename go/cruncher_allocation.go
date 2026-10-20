package wh40kdc

import (
	"math"
	"strconv"
)

// The discrete allocation stage: what one shooting or fighting unit's attacks
// do to the models of the target unit, as an exact distribution rather than an
// expected value. Go mirror of tools/src/cruncher/allocation.ts.
//
// Each attack that gets through deals its Damage to one model; damage beyond
// that model's remaining wounds is lost, and an already damaged model takes the
// next attack. Feel No Pain rolls once for each wound that would be lost.
// Devastating Wounds mortal wounds are inflicted after all normal damage and
// also damage at most one model each, the rest being lost.
//
// The state is (models alive, wounds left on the damaged model). Event counts
// come from the exact joint distribution of normal and mortal damage events per
// attack, so Sustained Hits, Lethal Hits and Devastating Wounds keep their
// correlation within an attack.

// AttackModel is the per-roll parameters behind one crunch, for the discrete
// allocation stage: every probability is the one the
// expected-value stages use. Mirror of AttackModel in tools/src/cruncher/engine.ts.
type AttackModel struct {
	ModelsFiring float64
	// AttacksStat is one model's Attacks characteristic, before AttacksBonus.
	AttacksStat any
	// AttacksBonus is the flat attacks every model adds: the modifier and Blast.
	AttacksBonus float64
	// RapidFireStat is Rapid Fire's extra attacks per model when active, else nil.
	RapidFireStat    any
	Torrent          bool
	HitPass, HitCrit float64
	// SustainedStat is Sustained Hits' extra hits per critical hit, else nil.
	SustainedStat        any
	Lethal               bool
	WoundPass, WoundCrit float64
	Devastating          bool
	// Unsaved is the probability a wound that reaches the save is not saved.
	Unsaved float64
	// Damage is the final per-attack damage distribution, ascending by value.
	Damage []DamageOutcome
	// WoundLost and MortalWoundLost are the probabilities each wound is lost
	// despite Feel No Pain: on every wound, and on mortal wounds only.
	WoundLost, MortalWoundLost float64
	Wounds                     float64
	ModelCount                 float64
}

// AllocationOutput is the allocation of one crunch's attacks into the target.
type AllocationOutput struct {
	// DamageDealt is the expected wounds removed from the target unit.
	DamageDealt     float64 `json:"damageDealt"`
	ModelsDestroyed float64 `json:"modelsDestroyed"`
	// ModelsDestroyedDistribution is the probability of each number of models
	// destroyed, from 0 to the unit's size.
	ModelsDestroyedDistribution []float64 `json:"modelsDestroyedDistribution"`
}

// joint holds probabilities indexed [normal events][mortal events].
type joint [][]float64

func newJoint(rows, columns int) joint {
	out := make(joint, rows)
	for k := range out {
		out[k] = make([]float64, columns)
	}
	return out
}

func convolveJoint(left, right joint) joint {
	out := newJoint(len(left)+len(right)-1, len(left[0])+len(right[0])-1)
	for k, row := range left {
		for j, p := range row {
			if p == 0 {
				continue
			}
			for k2, other := range right {
				for j2, q := range other {
					if q != 0 {
						out[k+k2][j+j2] += p * q
					}
				}
			}
		}
	}
	return out
}

func powerJoint(base joint, times int) joint {
	out := joint{{1}}
	for i := 0; i < times; i++ {
		out = convolveJoint(out, base)
	}
	return out
}

// addJoint returns into + weight * from, grown to fit both.
func addJoint(into, from joint, weight float64) joint {
	grown := newJoint(max(len(into), len(from)), max(len(into[0]), len(from[0])))
	for k, row := range into {
		for j, p := range row {
			grown[k][j] += p
		}
	}
	for k, row := range from {
		for j, p := range row {
			grown[k][j] += weight * p
		}
	}
	return grown
}

// integral returns value as an int, or an error when it is not a whole number.
func integral(value float64, what string) (int, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value != math.Trunc(value) {
		return 0, &crunchError{"allocate: " + what + " must be a whole number, got " + strconv.FormatFloat(value, 'g', -1, 64)}
	}
	return int(value), nil
}

// optionalQuantity is the distribution of an optional quantity: 0 for sure when absent.
func optionalQuantity(stat any) ([]DamageOutcome, error) {
	if stat == nil {
		return []DamageOutcome{{0, 1}}, nil
	}
	return quantityDistribution(stat)
}

// perAttackEvents is the distribution of one attack's normal and mortal damage events.
func perAttackEvents(model *AttackModel) (joint, error) {
	normalWound := model.WoundPass - model.WoundCrit
	critToMain := model.WoundCrit
	toMortal := 0.0
	if model.Devastating {
		critToMain = 0
		toMortal = model.WoundCrit
	}
	toMain := (normalWound + critToMain) * model.Unsaved
	woundRoll := joint{{1 - toMain - toMortal, toMortal}, {toMain, 0}}
	autoWound := joint{{1 - model.Unsaved}, {model.Unsaved}}
	normalHit, critHit := model.HitPass-model.HitCrit, model.HitCrit
	if model.Torrent {
		normalHit, critHit = 1, 0
	}
	result := addJoint(joint{{1 - normalHit - critHit}}, woundRoll, normalHit)
	if critHit > 0 {
		first := woundRoll
		if model.Lethal {
			first = autoWound
		}
		extras, err := optionalQuantity(model.SustainedStat)
		if err != nil {
			return nil, err
		}
		for _, extra := range extras {
			count, err := integral(extra.Value, "Sustained Hits")
			if err != nil {
				return nil, err
			}
			result = addJoint(result, convolveJoint(first, powerJoint(woundRoll, count)), critHit*extra.Probability)
		}
	}
	return result, nil
}

// attackCounts is the distribution of the unit's total attacks, indexed by
// count: each model rolls its own Attacks.
func attackCounts(model *AttackModel) ([]float64, error) {
	rapid, err := optionalQuantity(model.RapidFireStat)
	if err != nil {
		return nil, err
	}
	attacks, err := quantityDistribution(model.AttacksStat)
	if err != nil {
		return nil, err
	}
	var one []float64
	for _, a := range attacks {
		for _, r := range rapid {
			total, err := integral(a.Value+r.Value+model.AttacksBonus, "Attacks")
			if err != nil {
				return nil, err
			}
			total = max(0, total)
			for len(one) <= total {
				one = append(one, 0)
			}
			one[total] += a.Probability * r.Probability
		}
	}
	firing, err := integral(model.ModelsFiring, "models firing")
	if err != nil {
		return nil, err
	}
	all := []float64{1}
	for i := 0; i < firing; i++ {
		next := make([]float64, len(all)+len(one)-1)
		for sum, p := range all {
			for count, q := range one {
				next[sum+count] += p * q
			}
		}
		all = next
	}
	return all, nil
}

func binomial(trials, successes int, p float64) float64 {
	coefficient := 1.0
	for i := 0; i < successes; i++ {
		coefficient = coefficient * float64(trials-i) / float64(i+1)
	}
	return coefficient * math.Pow(p, float64(successes)) * math.Pow(1-p, float64(trials-successes))
}

// woundsLost is the distribution of wounds one event removes before the damaged
// model's remaining wounds cap it: each wound is lost with probability lost.
func woundsLost(model *AttackModel, lost float64) ([]float64, error) {
	var out []float64
	for _, outcome := range model.Damage {
		damage, err := integral(outcome.Value, "Damage")
		if err != nil {
			return nil, err
		}
		for len(out) <= damage {
			out = append(out, 0)
		}
		for removed := 0; removed <= damage; removed++ {
			out[removed] += outcome.Probability * binomial(damage, removed, lost)
		}
	}
	return out, nil
}

// Allocate is the exact allocation of an attacking unit's damage into the
// target's models, for the same input crunch takes.
func Allocate(input map[string]any, ds *Dataset) (AllocationOutput, error) {
	_, _, model, err := crunchModel(input, ds)
	if err != nil {
		return AllocationOutput{}, err
	}
	return AllocateModel(model)
}

// AllocateModel allocates the attacks one AttackModel describes.
func AllocateModel(model *AttackModel) (AllocationOutput, error) {
	models, err := integral(model.ModelCount, "target models")
	if err != nil {
		return AllocationOutput{}, err
	}
	wounds, err := integral(model.Wounds, "target Wounds")
	if err != nil {
		return AllocationOutput{}, err
	}
	if models == 0 || wounds == 0 {
		return AllocationOutput{0, 0, []float64{1}}, nil
	}
	dead := models * wounds
	// Alive state (m, w) is (m - 1) * wounds + (w - 1); `dead` absorbs.
	step := func(state, removed []float64) []float64 {
		out := make([]float64, dead+1)
		out[dead] = state[dead]
		for id := 0; id < dead; id++ {
			p := state[id]
			if p == 0 {
				continue
			}
			alive := id/wounds + 1
			left := id%wounds + 1
			for amount, q := range removed {
				if q == 0 {
					continue
				}
				next := id
				switch {
				case amount == 0:
				case amount < left:
					next = id - amount
				case alive == 1:
					next = dead
				default:
					next = (alive-2)*wounds + (wounds - 1)
				}
				out[next] += p * q
			}
		}
		return out
	}

	per, err := perAttackEvents(model)
	if err != nil {
		return AllocationOutput{}, err
	}
	counts, err := attackCounts(model)
	if err != nil {
		return AllocationOutput{}, err
	}
	events := joint{{0}}
	acc := joint{{1}}
	most := len(counts) - 1
	for attacks := 0; attacks <= most; attacks++ {
		if weight := counts[attacks]; weight > 0 {
			events = addJoint(events, acc, weight)
		}
		if attacks < most {
			acc = convolveJoint(acc, per)
		}
	}

	normal, err := woundsLost(model, model.WoundLost)
	if err != nil {
		return AllocationOutput{}, err
	}
	mortal, err := woundsLost(model, model.MortalWoundLost)
	if err != nil {
		return AllocationOutput{}, err
	}
	state := make([]float64, dead+1)
	state[(models-1)*wounds+(wounds-1)] = 1
	final := make([]float64, dead+1)
	for normalEvents, row := range events {
		if normalEvents > 0 {
			state = step(state, normal)
		}
		anyPositive := false
		for _, p := range row {
			if p > 0 {
				anyPositive = true
				break
			}
		}
		if !anyPositive {
			continue
		}
		after := state
		for mortalEvents, p := range row {
			if mortalEvents > 0 {
				after = step(after, mortal)
			}
			if p > 0 {
				for id, q := range after {
					final[id] += p * q
				}
			}
		}
	}

	destroyed := make([]float64, models+1)
	damageDealt := 0.0
	for id, p := range final {
		alive, remaining := 0, 0
		if id != dead {
			alive = id/wounds + 1
			remaining = (alive-1)*wounds + id%wounds + 1
		}
		destroyed[models-alive] += p
		damageDealt += p * float64(dead-remaining)
	}
	modelsDestroyed := 0.0
	for count, p := range destroyed {
		modelsDestroyed += p * float64(count)
	}
	return AllocationOutput{damageDealt, modelsDestroyed, destroyed}, nil
}
