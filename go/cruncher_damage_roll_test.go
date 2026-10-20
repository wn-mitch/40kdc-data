package wh40kdc

import (
	"math"
	"testing"
)

// Mirrors tools/test/cruncher-damage-roll.test.ts.

func mustDamageRoll(t *testing.T, in damageRollInput) damageRollResult {
	t.Helper()
	out, err := damageRoll(in)
	if err != nil {
		t.Fatalf("damageRoll(%v): %v", in.stat, err)
	}
	return out
}

func assertClose(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-12 {
		t.Errorf("%s: got %v, want %v", label, got, want)
	}
}

func TestDamageRollKeepsPrintedMeanWhenNothingClamps(t *testing.T) {
	assertClose(t, "D6+1", mustDamageRoll(t, damageRollInput{stat: "D6+1"}).expected, 4.5)
	assertClose(t, "2D3", mustDamageRoll(t, damageRollInput{stat: "2D3"}).expected, 4)
	if got := mustDamageRoll(t, damageRollInput{stat: 3.0}).expected; got != 3 {
		t.Errorf("fixed 3: got %v", got)
	}
}

func TestDamageRollFloorsEachRollAtZero(t *testing.T) {
	// D3-2 rolls 0, 0, 1; the mean-then-floor shortcut gives 0.
	assertClose(t, "D3 -2", mustDamageRoll(t, damageRollInput{stat: "D3", modifier: -2}).expected, 1.0/3)
}

func TestDamageRollAppliesReductionPerRollWithMinimumOne(t *testing.T) {
	assertClose(t, "D6 -3", mustDamageRoll(t, damageRollInput{stat: "D6", reduction: 3}).expected, 1.5)
	// A fixed 0 still rises to 1 under active reduction.
	if got := mustDamageRoll(t, damageRollInput{stat: 1.0, modifier: -1, reduction: 1}).expected; got != 1 {
		t.Errorf("fixed 0 under reduction: got %v", got)
	}
}

func TestDamageRollRerollsOnlyBelowFreshMean(t *testing.T) {
	rolled := mustDamageRoll(t, damageRollInput{stat: "D6", reroll: "all-failures"})
	assertClose(t, "D6 reroll all", rolled.expected, 4.25)
	if !rolled.rerollUsed {
		t.Error("rerollUsed: want true")
	}
	total := 0.0
	for _, o := range rolled.distribution {
		total += o.probability
	}
	assertClose(t, "distribution mass", total, 1)
}

func TestDamageRollOnesRerollActsOnSingleDieOnly(t *testing.T) {
	assertClose(t, "D6 reroll ones", mustDamageRoll(t, damageRollInput{stat: "D6", reroll: "ones"}).expected, 3.5+2.5/6)
	// A 2D6 total can never be 1.
	pair := mustDamageRoll(t, damageRollInput{stat: "2D6", reroll: "ones"})
	assertClose(t, "2D6 reroll ones", pair.expected, 7)
	if pair.rerollUsed {
		t.Error("2D6 ones: rerollUsed want false")
	}
}

func TestDamageRollNeverRerollsFixedOrClampedRolls(t *testing.T) {
	fixed := mustDamageRoll(t, damageRollInput{stat: 2.0, reroll: "all-failures"})
	if fixed.expected != 2 || fixed.rerollUsed {
		t.Errorf("fixed 2: got expected %v rerollUsed %v", fixed.expected, fixed.rerollUsed)
	}
	// D3 under reduction 3 is always 1: rerolling cannot help.
	clamped := mustDamageRoll(t, damageRollInput{stat: "D3", reduction: 3, reroll: "all-failures"})
	if clamped.expected != 1 || clamped.rerollUsed {
		t.Errorf("D3 -3: got expected %v rerollUsed %v", clamped.expected, clamped.rerollUsed)
	}
}

func TestDamageRollRejectsUnparseableStats(t *testing.T) {
	for _, stat := range []any{"", "  ", "D", "x3", nil, map[string]any{}} {
		if _, err := damageRoll(damageRollInput{stat: stat}); err == nil {
			t.Errorf("stat %#v: want error", stat)
		}
	}
}
