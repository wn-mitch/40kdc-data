package wh40kdc

import (
	"encoding/json"
	"math"
	"testing"
)

// Mirrors tools/test/cruncher-allocation.test.ts, plus the allocation corpus.

// allocModel is an attack model that always hits, wounds and goes unsaved
// unless edit overrides it.
func allocModel(edit func(*AttackModel)) *AttackModel {
	m := &AttackModel{
		ModelsFiring: 1, AttacksStat: 1.0, HitPass: 1, WoundPass: 1, Unsaved: 1,
		Damage: []DamageOutcome{{1, 1}}, WoundLost: 1, MortalWoundLost: 1, Wounds: 1, ModelCount: 1,
	}
	if edit != nil {
		edit(m)
	}
	return m
}

func mustAllocate(t *testing.T, m *AttackModel) AllocationOutput {
	t.Helper()
	out, err := AllocateModel(m)
	if err != nil {
		t.Fatalf("AllocateModel: %v", err)
	}
	return out
}

func near(t *testing.T, what string, got, want, tol float64) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s = %v, want %v (±%g)", what, got, want, tol)
	}
}

func TestAllocateLosesOverkillAndCarriesDamagedModel(t *testing.T) {
	// Two D2 attacks into 3-wound models: 2, then 1 more kills one and 1 is lost.
	out := mustAllocate(t, allocModel(func(m *AttackModel) {
		m.AttacksStat, m.Damage, m.Wounds, m.ModelCount = 2.0, []DamageOutcome{{2, 1}}, 3, 2
	}))
	near(t, "damageDealt", out.DamageDealt, 3, 1e-12)
	near(t, "modelsDestroyed", out.ModelsDestroyed, 1, 1e-12)
	want := []float64{0, 1, 0}
	if len(out.ModelsDestroyedDistribution) != len(want) {
		t.Fatalf("distribution = %v, want %v", out.ModelsDestroyedDistribution, want)
	}
	for i, p := range want {
		if out.ModelsDestroyedDistribution[i] != p {
			t.Errorf("distribution = %v, want %v", out.ModelsDestroyedDistribution, want)
			break
		}
	}
}

func TestAllocateCapsAtUnitAndMatchesExpectedValueWhenNothingIsLost(t *testing.T) {
	open := allocModel(func(m *AttackModel) {
		m.AttacksStat, m.HitPass, m.HitCrit = "2D6", 2.0/3, 1.0/6
		m.WoundPass, m.WoundCrit, m.Unsaved, m.ModelCount = 0.5, 1.0/6, 2.0/3, 40
	})
	// E[attacks] * P(hit) * P(wound) * P(unsaved), with no model ever close to running out.
	near(t, "uncapped damageDealt", mustAllocate(t, open).DamageDealt, 7*(2.0/3)*0.5*(2.0/3), 1e-9)
	capped := *open
	capped.ModelCount = 1
	out := mustAllocate(t, &capped)
	if out.DamageDealt > 1 {
		t.Errorf("capped damageDealt = %v, want <= 1", out.DamageDealt)
	}
	mass := 0.0
	for _, p := range out.ModelsDestroyedDistribution {
		mass += p
	}
	near(t, "distribution mass", mass, 1, 1e-12)
}

func TestAllocateInflictsDevastatingWoundsAfterNormalDamage(t *testing.T) {
	// A normal wound always lands before a mortal one, so a 1-model unit dies to
	// the normal wound and the mortal wound is lost; mortal-only Feel No Pain
	// cannot change that. Only both attacks critting leaves the model to two
	// mortal wounds: 1 - 0.25 * (0.5 * 0.5).
	out := mustAllocate(t, allocModel(func(m *AttackModel) {
		m.AttacksStat, m.WoundCrit, m.Devastating, m.MortalWoundLost = 2.0, 0.5, true, 0.5
	}))
	near(t, "modelsDestroyed", out.ModelsDestroyed, 1-0.25*0.25, 1e-12)
}

func TestAllocateRejectsFractionalQuantities(t *testing.T) {
	for name, edit := range map[string]func(*AttackModel){
		"Damage":        func(m *AttackModel) { m.Damage = []DamageOutcome{{1.5, 1}} },
		"Attacks":       func(m *AttackModel) { m.AttacksBonus = 0.5 },
		"models firing": func(m *AttackModel) { m.ModelsFiring = 2.5 },
		"target Wounds": func(m *AttackModel) { m.Wounds = 2.5 },
	} {
		if _, err := AllocateModel(allocModel(edit)); err == nil {
			t.Errorf("%s: fractional value allocated without an error", name)
		}
	}
}

// mulberry32 is a seeded PRNG so the cross-check is deterministic.
func mulberry32(seed uint32) func() float64 {
	state := seed
	return func() float64 {
		state += 0x6d2b79f5
		z := state
		z = (z ^ (z >> 15)) * (z | 1)
		z ^= z + (z^(z>>7))*(z|61)
		return float64(z^(z>>14)) / 4294967296
	}
}

func drawOutcome(random func() float64, distribution []DamageOutcome) float64 {
	roll := random()
	for _, o := range distribution {
		if roll -= o.Probability; roll < 0 {
			return o.Value
		}
	}
	return distribution[len(distribution)-1].Value
}

// simulateAllocation independently simulates the same attack sequence: every
// attack rolls in turn, normal damage allocates as it lands, and Devastating
// Wounds mortal wounds wait until all normal damage is done.
func simulateAllocation(t *testing.T, a *AttackModel, trials int, seed uint32) (float64, float64) {
	t.Helper()
	random := mulberry32(seed)
	rapid, err := optionalQuantity(a.RapidFireStat)
	if err != nil {
		t.Fatal(err)
	}
	sustained, err := optionalQuantity(a.SustainedStat)
	if err != nil {
		t.Fatal(err)
	}
	attacksDist, err := quantityDistribution(a.AttacksStat)
	if err != nil {
		t.Fatal(err)
	}
	dealt, destroyed := 0, 0
	for trial := 0; trial < trials; trial++ {
		alive, left, removed, mortal := int(a.ModelCount), int(a.Wounds), 0, 0
		land := func(lost float64) {
			if alive == 0 {
				return
			}
			wounds := 0
			for point := int(drawOutcome(random, a.Damage)); point > 0; point-- {
				if random() < lost {
					wounds++
				}
			}
			taken := min(wounds, left)
			removed += taken
			left -= taken
			if left == 0 {
				alive--
				left = int(a.Wounds)
			}
		}
		woundRoll := func() {
			roll := random()
			normal := a.WoundPass - a.WoundCrit
			if roll < a.WoundCrit {
				if a.Devastating {
					mortal++
				} else if random() < a.Unsaved {
					land(a.WoundLost)
				}
			} else if roll < a.WoundCrit+normal && random() < a.Unsaved {
				land(a.WoundLost)
			}
		}
		for shooter := 0; shooter < int(a.ModelsFiring); shooter++ {
			attacks := max(0, int(drawOutcome(random, attacksDist)+drawOutcome(random, rapid)+a.AttacksBonus))
			for i := 0; i < attacks; i++ {
				roll := random()
				critHit := !a.Torrent && roll < a.HitCrit
				normalHit := a.Torrent || (!critHit && roll < a.HitPass)
				if normalHit {
					woundRoll()
				}
				if critHit {
					if a.Lethal {
						if random() < a.Unsaved {
							land(a.WoundLost)
						}
					} else {
						woundRoll()
					}
					for extra := int(drawOutcome(random, sustained)); extra > 0; extra-- {
						woundRoll()
					}
				}
			}
		}
		for ; mortal > 0; mortal-- {
			land(a.MortalWoundLost)
		}
		dealt += removed
		destroyed += int(a.ModelCount) - alive
	}
	return float64(dealt) / float64(trials), float64(destroyed) / float64(trials)
}

func TestAllocateAgreesWithSeededSimulation(t *testing.T) {
	d3, err := quantityDistribution("D3")
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*AttackModel){
		"multi-damage overkill across a squad": func(m *AttackModel) {
			m.ModelsFiring, m.AttacksStat, m.HitPass, m.HitCrit = 3, "D3", 2.0/3, 1.0/6
			m.WoundPass, m.WoundCrit, m.Unsaved, m.Damage, m.Wounds, m.ModelCount = 2.0/3, 1.0/6, 0.5, d3, 2, 5
		},
		"sustained and lethal hits with Feel No Pain": func(m *AttackModel) {
			m.ModelsFiring, m.AttacksStat, m.HitPass, m.HitCrit, m.SustainedStat, m.Lethal = 4, 2.0, 0.5, 1.0/6, "D3", true
			m.WoundPass, m.WoundCrit, m.Unsaved, m.Damage = 1.0/3, 1.0/6, 2.0/3, []DamageOutcome{{2, 1}}
			m.WoundLost, m.MortalWoundLost, m.Wounds, m.ModelCount = 2.0/3, 2.0/3, 3, 4
		},
		"devastating wounds with mortal-only Feel No Pain": func(m *AttackModel) {
			m.ModelsFiring, m.AttacksStat, m.RapidFireStat, m.HitPass, m.HitCrit = 2, 3.0, 1.0, 2.0/3, 1.0/6
			m.WoundPass, m.WoundCrit, m.Devastating, m.Unsaved = 0.5, 1.0/6, true, 1.0/3
			m.Damage = []DamageOutcome{{1, 0.5}, {3, 0.5}}
			m.WoundLost, m.MortalWoundLost, m.Wounds, m.ModelCount = 1, 0.5, 2, 6
		},
		"torrent into a single big model": func(m *AttackModel) {
			m.ModelsFiring, m.AttacksStat, m.AttacksBonus, m.Torrent = 2, "D6", 1, true
			m.WoundPass, m.WoundCrit, m.Unsaved, m.Damage, m.Wounds, m.ModelCount = 1.0/3, 1.0/6, 0.5, []DamageOutcome{{3, 1}}, 12, 1
		},
	}
	const trials = 40_000
	for name, edit := range cases {
		t.Run(name, func(t *testing.T) {
			attack := allocModel(edit)
			exact := mustAllocate(t, attack)
			dealt, destroyed := simulateAllocation(t, attack, trials, 0x5eed)
			// Each trial's damage is bounded by the unit's wounds, so 4 bounded
			// standard errors is a safe band.
			near(t, "damageDealt", dealt, exact.DamageDealt, attack.ModelCount*attack.Wounds*4/math.Sqrt(trials))
			near(t, "modelsDestroyed", destroyed, exact.ModelsDestroyed, attack.ModelCount*4/math.Sqrt(trials))
		})
	}
}

func TestAllocationCorpus(t *testing.T) {
	var cases []struct {
		Name         string           `json:"name"`
		CruncherCase string           `json:"cruncher_case"`
		Expected     AllocationOutput `json:"expected"`
	}
	if err := json.Unmarshal(loadCorpus(t, "allocation", "cases.json"), &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("allocation corpus is empty")
	}
	state := NewRunnerState()
	if r := state.Dispatch(map[string]any{"op": "init", "args": map[string]any{
		"spec_version": float64(SpecVersion), "locale": "C", "tz": "UTC", "seed": 0.0,
	}}); r["ok"] != true {
		t.Fatalf("init: %v", r)
	}
	for _, c := range cases {
		var input map[string]any
		if err := json.Unmarshal(loadCorpus(t, "cruncher", c.CruncherCase), &input); err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		args := map[string]any{}
		for _, key := range []string{"attacker", "modelsFiring", "target", "context", "buffs"} {
			if v, ok := input[key]; ok {
				args[key] = v
			}
		}
		resp := state.Dispatch(map[string]any{"op": "allocate", "args": args})
		if resp["ok"] != true {
			t.Errorf("%s: %v", c.Name, resp)
			continue
		}
		value := resp["value"].(map[string]any)
		near(t, c.Name+" damageDealt", value["damageDealt"].(float64), c.Expected.DamageDealt, 5e-4)
		near(t, c.Name+" modelsDestroyed", value["modelsDestroyed"].(float64), c.Expected.ModelsDestroyed, 5e-4)
		got := value["modelsDestroyedDistribution"].([]any)
		if len(got) != len(c.Expected.ModelsDestroyedDistribution) {
			t.Errorf("%s: distribution length %d, want %d", c.Name, len(got), len(c.Expected.ModelsDestroyedDistribution))
			continue
		}
		for i, want := range c.Expected.ModelsDestroyedDistribution {
			near(t, c.Name+" distribution", got[i].(float64), want, 5e-4)
		}
	}
}
