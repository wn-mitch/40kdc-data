package wh40kdc

import (
	"encoding/json"
	"strings"
	"testing"
)

// Pins for the unit ability_ids entry forms and the {rating: true} rated rule,
// mirroring tools/test/mfm-mirror-rating.test.ts.

const fnpRated = `{"type":"feel-no-pain","target":"this-unit","modifier":{"threshold":{"rating":true}}}`
const scoutsRated = `{"type":"ability-grant","target":"this-unit","modifier":{"ability":"scouts","value":{"rating":true}}}`
const demiseRated = `{"type":"mortal-wounds","target":{"owner":"enemy"},"modifier":{"count":{"rating":true}}}`

func TestWithRatingSubstitutesOnlyTheRatingRef(t *testing.T) {
	sub := func(effect string, rating any) string {
		raw, _ := json.Marshal(withRating(j(t, effect), rating, true))
		return string(raw)
	}
	if got := sub(fnpRated, 5.0); got != `{"modifier":{"threshold":5},"target":"this-unit","type":"feel-no-pain"}` {
		t.Errorf("fnp = %s", got)
	}
	if got := sub(demiseRated, "D3"); got != `{"modifier":{"count":"D3"},"target":{"owner":"enemy"},"type":"mortal-wounds"}` {
		t.Errorf("demise = %s", got)
	}
	// A rating key beside other keys is not the reference.
	if got := sub(`{"type":"x","modifier":{"rating":true,"other":1}}`, 4.0); got != `{"modifier":{"other":1,"rating":true},"type":"x"}` {
		t.Errorf("untouched = %s", got)
	}
	// Without a rating the effect is returned as is.
	fnp := j(t, fnpRated)
	if out := withRating(fnp, nil, false).(map[string]any); !jsonEqual(out, fnp) {
		t.Errorf("unrated = %v", out)
	}
}

func TestRatedRuleRenders(t *testing.T) {
	cases := []struct{ effect, want string }{
		{fnpRated, "Feel No Pain X+ ability, X being its rating"},
		{scoutsRated, `Scouts X" ability, X being its rating`},
		{demiseRated, "equal to its rating"},
	}
	for _, c := range cases {
		if got := renderAbility(t, c.effect, ""); !strings.Contains(got, c.want) {
			t.Errorf("%s: %q lacks %q", c.effect, got, c.want)
		}
	}
	rated := describeAbility(map[string]any{"effect": withRating(j(t, fnpRated), 5.0, true)})
	if !strings.Contains(rated, "Feel No Pain 5+ ability") || strings.Contains(rated, "X") {
		t.Errorf("rated fnp = %q", rated)
	}
	demise := describeAbility(map[string]any{"effect": withRating(j(t, demiseRated), "D3", true)})
	if !strings.Contains(demise, "D3 mortal wounds") {
		t.Errorf("rated demise = %q", demise)
	}
}

func TestRatedFeelNoPainReachesTheCruncher(t *testing.T) {
	source := map[string]any{"kind": "ability", "abilityId": "feel-no-pain", "abilityKind": "unit"}
	ctx := map[string]any{"phase": "shooting"}
	rated := effectToBuffs(withRating(j(t, fnpRated), 5.0, true), source, ctx, "target")
	if got := contributions(t, rated.applied); got != `[{"threshold":5,"type":"feel-no-pain"}]` {
		t.Errorf("rated = %s", got)
	}
	// Without a unit there is no threshold to apply: surfaced, not guessed.
	bare := effectToBuffs(j(t, fnpRated), source, ctx, "target")
	if len(bare.applied) != 0 || !strings.Contains(reasons(bare), "feel-no-pain: threshold not numeric") {
		t.Errorf("bare: applied %d, reasons %q", len(bare.applied), reasons(bare))
	}
	// End to end: a unit printing Feel No Pain 5+ defends with a 5+ from the one core record.
	ds := EmbeddedDataset()
	buffs := ds.defensiveBuffsFor(map[string]any{"unitId": "repentia-squad", "factionId": "adepta-sororitas"}, ctx)
	got := contribTypesFrom(buffs, "feel-no-pain")
	if len(got) != 1 || asInt(got[0]["threshold"]) != 5 {
		t.Errorf("repentia-squad feel-no-pain = %v, want one 5+", got)
	}
}

func TestUnitAbilityRefForms(t *testing.T) {
	unit := map[string]any{"ability_ids": []any{"a", map[string]any{"id": "feel-no-pain", "value": 5.0},
		map[string]any{"id": "serpent-shield-aeldari", "wargear": "serpent-shield"}, 7.0, nil}}
	if got := strings.Join(unitAbilityIDs(unit), ","); got != "a,feel-no-pain,serpent-shield-aeldari" {
		t.Errorf("ids = %s", got)
	}
	if got := strings.Join(printedWargearIDs(unit), ","); got != "serpent-shield" {
		t.Errorf("wargear = %s", got)
	}
	view := &UnitView{Raw: unit}
	if r, ok := view.RatingOf("feel-no-pain"); !ok || r != 5.0 {
		t.Errorf("RatingOf(feel-no-pain) = %v, %v", r, ok)
	}
	if _, ok := view.RatingOf("a"); ok {
		t.Error("a bare id carries no rating")
	}
}

func TestIDLabelStripsTheFactionSuffix(t *testing.T) {
	cases := map[string]string{
		"acts-of-faith-adepta-sororitas": "Acts of Faith",
		"lord-of-the-death-guard":        "Lord of the Death Guard",
		"deadly-demise":                  "Deadly Demise",
		"orks":                           "Orks",
	}
	for id, want := range cases {
		if got := idLabel(id); got != want {
			t.Errorf("idLabel(%q) = %q, want %q", id, got, want)
		}
	}
}
