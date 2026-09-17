package wh40kdc

import "testing"

// World Eaters Chaos Terminators are priced by army ordinal: 165 for the 1st-2nd
// copy, 175 for the 3rd+ (330/340 at 10 models). The id is shared with Emperor's
// Children, so resolve the WE copy. Mirror of the TS/Rust/Python pricing tests.
func weChaosTerminators(t *testing.T) map[string]any {
	t.Helper()
	ds := EmbeddedDataset()
	ct, ok := ds.Units.GetInFaction("chaos-terminators", "world-eaters")
	if !ok {
		t.Fatal("WE chaos-terminators not in dataset")
	}
	return ct.Raw
}

func TestBaseUnitPointsOrdinalBands(t *testing.T) {
	ct := weChaosTerminators(t)
	cases := []struct {
		models, ordinal, want int
	}{
		{5, 1, 165}, {5, 2, 165}, {10, 1, 330},
		{5, 3, 175}, {10, 3, 340}, {5, 7, 175},
		{7, 1, 330}, // inside the 6-10 range tier (not the 5-model tier)
	}
	for _, c := range cases {
		if got := baseUnitPoints(ct, c.models, c.ordinal); got != c.want {
			t.Errorf("baseUnitPoints(%d models, ordinal %d) = %d, want %d", c.models, c.ordinal, got, c.want)
		}
	}
}

func TestBaseUnitPointsUnbandedIgnoresOrdinal(t *testing.T) {
	ds := EmbeddedDataset()
	bz, ok := ds.Units.Get("khorne-berzerkers")
	if !ok {
		t.Fatal("khorne-berzerkers not in dataset")
	}
	if a, b := baseUnitPoints(bz.Raw, 10, 1), baseUnitPoints(bz.Raw, 10, 99); a != b {
		t.Errorf("unbanded unit should ignore ordinal: %d != %d", a, b)
	}
}

func TestPointsTierMissing(t *testing.T) {
	ct := weChaosTerminators(t)
	if pointsTierMissing(ct, 5, 1) || pointsTierMissing(ct, 5, 3) {
		t.Error("5 models should be covered at ordinals 1 and 3")
	}
	if !pointsTierMissing(ct, 4, 1) {
		t.Error("4 models is below the smallest tier")
	}
}

// Venatari Custodians: 3 @150 for the first two copies (160 thereafter), or 4-6
// @300 (310 thereafter).
func TestRangePricedTierVenatari(t *testing.T) {
	ds := EmbeddedDataset()
	ven, ok := ds.Units.GetInFaction("venatari-custodians", "adeptus-custodes")
	if !ok {
		t.Fatal("venatari-custodians not in dataset")
	}
	for _, c := range []struct{ models, want int }{{3, 150}, {4, 300}, {5, 300}, {6, 300}} {
		if got := baseUnitPoints(ven.Raw, c.models, 1); got != c.want {
			t.Errorf("baseUnitPoints(%d models) = %d, want %d", c.models, got, c.want)
		}
	}
	if !pointsTierMissing(ven.Raw, 2, 1) || !pointsTierMissing(ven.Raw, 7, 1) {
		t.Error("2 and 7 models fall outside every tier range")
	}
	if pointsTierMissing(ven.Raw, 4, 1) || pointsTierMissing(ven.Raw, 6, 1) {
		t.Error("4 and 6 models are covered by the 4-6 range tier")
	}
}

func TestBaseLoadoutLegalDefault(t *testing.T) {
	ds := EmbeddedDataset()
	bz, ok := ds.Units.Get("khorne-berzerkers")
	if !ok {
		t.Fatal("khorne-berzerkers not in dataset")
	}
	opts := bz.WargearOptions()
	lo := baseLoadout(bz.Raw, 10, opts, nil)
	if lo["bolt-pistol-khorne-berzerkers"] != 10 || lo["chainblade"] != 10 || len(lo) != 2 {
		t.Fatalf("base loadout should be the no-swap set, got %v", lo)
	}
	if v := validateLoadout(bz.Raw, 10, opts, lo, nil); len(v) != 0 {
		t.Fatalf("base loadout should validate clean, got %v", v)
	}
}
