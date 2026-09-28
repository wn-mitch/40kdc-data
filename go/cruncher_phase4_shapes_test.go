package wh40kdc

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

// Cruncher pins for the phase-4 shapes, mirroring the cruncher block of
// tools/test/translate-phase4-shapes.test.ts: whether each shape may become a
// buff, and the reason it may not.

var bokSource = map[string]any{"kind": "ability", "abilityId": "blessings-of-khorne", "abilityKind": "army"}

func fightCtx(extra map[string]any) map[string]any {
	ctx := map[string]any{"phase": "fight", "attackerStationary": false}
	for k, v := range extra {
		ctx[k] = v
	}
	return ctx
}

func reasons(out *effectTranslation) string {
	var rs []string
	for _, u := range out.unsupported {
		rs = append(rs, u.(map[string]any)["reason"].(string))
	}
	return strings.Join(rs, "\n")
}

func contributions(t *testing.T, buffs []any) string {
	t.Helper()
	var cs []any
	for _, b := range buffs {
		cs = append(cs, b.(map[string]any)["contribution"])
	}
	raw, _ := json.Marshal(cs)
	return string(raw)
}

func TestPhase4AbilityUnitIsBuffed(t *testing.T) {
	out := effectToBuffs(j(t, `{"type":"re-roll","target":"ability-unit","modifier":{"roll":"hit","subset":"ones"}}`),
		map[string]any{"kind": "ability", "abilityId": "x", "abilityKind": "unit"}, map[string]any{"phase": "shooting"}, "attacker")
	if got := contributions(t, out.applied); got != `[{"roll":"hit","subset":"ones","type":"reroll"}]` {
		t.Fatalf("applied = %s", got)
	}
}

func TestPhase4RollKeepsDicePoolLevers(t *testing.T) {
	warp := `{"type":"weapon-ability-grant","target":{"owner":"friendly"},"modifier":{"abilities":["Lethal Hits"],"weapon_type":"melee"}}`
	blood := `{"type":"roll-modifier","target":{"owner":"friendly"},"modifier":{"roll":"wound","operation":"add","value":1,"weapon_type":"melee"}}`
	pool := j(t, `{"type":"dice-pool-allocation","pool":{"count":8,"die":"D6"},"max_activations":2,"options":[
		{"name":"Warp Blades","requirement":{"type":"pair","min_value":4},"effect":`+warp+`},
		{"name":"Wrathful Devotion","requirement":{"type":"pair","min_value":5},"effect":`+blood+`}]}`)
	wrap := func(name, req, eff string) string {
		return `{"type":"ability-part","name":"` + name + `","effect":{"type":"dice-gated","from":{"roll_var":"bok"},"requirement":` + req + `,"on_success":` + eff + `}}`
	}
	roll := j(t, `{"type":"roll","dice":"8D6","extra_dice_pool":"blessings-of-khorne-pool","roll_var":"bok","effect":{"type":"choice","min_choices":0,"max_choices":2,"options":[`+
		wrap("Warp Blades", `{"type":"pair","min_value":4}`, warp)+`,`+wrap("Wrathful Devotion", `{"type":"pair","min_value":5}`, blood)+`]}}`)
	before := effectToBuffs(pool, bokSource, fightCtx(nil), "attacker")
	after := effectToBuffs(roll, bokSource, fightCtx(nil), "attacker")
	if len(after.activatable) != 2 || len(after.applied) != 0 {
		t.Fatalf("after: %d levers, %d applied", len(after.activatable), len(after.applied))
	}
	b, _ := json.Marshal(before.activatable)
	a, _ := json.Marshal(after.activatable)
	if string(a) != string(b) {
		t.Fatalf("levers differ:\n roll %s\n pool %s", a, b)
	}
}

func TestPhase4UnsizedValuesAreNotApplied(t *testing.T) {
	cases := []struct{ effect, reason string }{
		{`{"type":"roll","dice":"D3","roll_var":"r","effect":{"type":"stat-modifier","target":"this-unit","modifier":{"stat":"A","operation":"add","value":{"roll_var":"r"}}}}`, `value is set by a bound roll`},
		{`{"type":"stat-modifier","target":"this-unit","modifier":{"stat":"A","operation":"add","value":{"incursion":1,"strike-force":2,"onslaught":3}}}`, `value is set by the battle size`},
		{`{"type":"stat-modifier","target":"this-unit","modifier":{"stat":"A","operation":"add","value":{"count_of":"battle-round"}}}`, `value is set by the number of battle-round`},
		{`{"type":"stat-modifier","target":"this-unit","modifier":{"stat":"A","operation":"add","value":2},"scaling":{"per":1,"of":"models-embarked-in-bearer","max_value":22}}`, `scales with models-embarked-in-bearer`},
		{`{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1,"weapon_ref":{"weapon_var":"blade"}}}`, `weapon_ref`},
	}
	for _, c := range cases {
		out := effectToBuffs(j(t, c.effect), bokSource, fightCtx(nil), "attacker")
		if len(out.applied) != 0 || !regexp.MustCompile(c.reason).MatchString(reasons(out)) {
			t.Errorf("%s: applied %d, reasons %q", c.effect, len(out.applied), reasons(out))
		}
	}
}

func TestPhase4UsageListGatesLikeOneLimit(t *testing.T) {
	effect := j(t, `{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1}}`)
	list := usageGated("unit", []any{map[string]any{"frequency": "n-per-battle", "count": 1.0, "per": "model"}, map[string]any{"frequency": "once-per-battle-round", "per": "army"}}, effect)
	one := usageGated("unit", map[string]any{"frequency": "n-per-battle", "count": 1.0}, effect)
	if !jsonEqual(list, one) || jsonEqual(list, effect) {
		t.Fatalf("list %v, one %v", list, one)
	}
}

func TestPhase4MandatoryRerollKeepsBuff(t *testing.T) {
	out := effectToBuffs(j(t, `{"type":"re-roll","target":"this-unit","modifier":{"roll":"hit","subset":"ones","mandatory":true}}`), bokSource, fightCtx(nil), "attacker")
	if got := contributions(t, out.applied); got != `[{"roll":"hit","subset":"ones","type":"reroll"}]` {
		t.Fatalf("applied = %s", got)
	}
}

func TestPhase4ContextConditions(t *testing.T) {
	gated := func(cond string) map[string]any {
		return j(t, `{"type":"conditional","condition":`+cond+`,"effect":{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1}}}`)
	}
	cases := []struct {
		cond    string
		ctx     map[string]any
		applied int
		reason  string
	}{
		{`{"type":"army-faction","parameters":{"faction":"tau-empire"}}`, map[string]any{"armyFaction": "tau-empire"}, 1, ""},
		{`{"type":"army-faction","parameters":{"faction":"tau-empire"}}`, map[string]any{"armyFaction": "necrons"}, 0, ""},
		{`{"type":"army-faction","parameters":{"faction":"tau-empire"}}`, nil, 0, "army-faction"},
		{`{"type":"battle-size","parameters":{"size":"onslaught"}}`, map[string]any{"battleSize": "onslaught"}, 1, ""},
		{`{"type":"battle-size","parameters":{"size":"onslaught"}}`, map[string]any{"battleSize": "incursion"}, 0, ""},
		{`{"type":"guided","parameters":{}}`, map[string]any{"attackerGuided": true}, 1, ""},
		{`{"type":"guided","parameters":{}}`, map[string]any{"attackerGuided": false}, 0, ""},
		{`{"type":"guided","parameters":{}}`, nil, 0, "guided"},
	}
	for _, c := range cases {
		out := effectToBuffs(gated(c.cond), bokSource, fightCtx(c.ctx), "attacker")
		if len(out.applied) != c.applied || (c.reason != "" && !strings.Contains(reasons(out), c.reason)) {
			t.Errorf("%s %v: applied %d, reasons %q", c.cond, c.ctx, len(out.applied), reasons(out))
		}
	}
}

func TestPhase4ShapeDiagnostics(t *testing.T) {
	own := effectToBuffs(j(t, `{"type":"roll-modifier","target":"this-unit","modifier":{"roll":{"of_ability":"reanimation-protocols-necrons"},"operation":"add","value":1}}`), bokSource, fightCtx(nil), "attacker")
	if got := reasons(own); got != `roll-modifier on "reanimation-protocols-necrons roll" is outside the damage path` {
		t.Errorf("own roll reason = %q", got)
	}
	for _, typ := range []string{"characteristic-resolution", "borrow-weapons", "select-weapon"} {
		out := effectToBuffs(j(t, `{"type":"`+typ+`","target":"this-unit","modifier":{"stat":"T","rule":"highest","max_models":2,"bind_as":"b"}}`), bokSource, fightCtx(nil), "attacker")
		if len(out.applied) != 0 || !strings.HasPrefix(reasons(out), typ+":") {
			t.Errorf("%s: applied %d, reasons %q", typ, len(out.applied), reasons(out))
		}
	}
	obj := effectToBuffs(j(t, `{"type":"select-objective","selector":{"count":1,"bind_as":"o"},"effect":{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1}}}`), bokSource, fightCtx(nil), "attacker")
	if len(obj.applied) != 0 || !strings.HasPrefix(reasons(obj), "select-objective:") {
		t.Errorf("select-objective: applied %d, reasons %q", len(obj.applied), reasons(obj))
	}
}
