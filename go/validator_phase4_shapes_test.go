package wh40kdc

import "testing"

// Schema pins for the phase-4 shapes, mirroring tools/test/phase4-shapes-schema.test.ts:
// each shape accepts its documented form and rejects the misuse its if/then or
// oneOf exists to stop. Several rejections depend on oneOf failing when more
// than one branch matches.

const schemaBase = "https://40kdc.dev/schemas"

func TestPhase4SchemaPins(t *testing.T) {
	v := NewSchemaValidator()
	ids := map[string]string{
		"effect":    schemaBase + "/enrichment/ability-dsl/effect.schema.json",
		"condition": schemaBase + "/enrichment/ability-dsl/condition.schema.json",
		"ability":   schemaBase + "/enrichment/ability-dsl/ability.schema.json",
		"stratagem": schemaBase + "/core/stratagem.schema.json",
	}
	ability := func(effect, extra string) string {
		s := `{"ability_id":"shape-probe","name":"Shape probe","authored_by":"40kdc-community","game_version":{"edition":"11th","dataslate":"pre-launch-provisional"},"effect":` + effect + `,"scope":{"duration":"permanent"}`
		if extra != "" {
			s += "," + extra
		}
		return s + "}"
	}
	strat := func(targets string) string {
		return `{"id":"probe","name":"Probe","category":"detachment","cp_cost":1,"phases":["command"],"player_turn":"your-turn","timing":"once-per-phase","game_version":{"edition":"11th","dataslate":"pre-launch-provisional"},"target_restrictions":` + targets + `}`
	}
	leaf := func(typ, target, modifier string) string {
		return `{"type":"` + typ + `","target":` + target + `,"modifier":` + modifier + `}`
	}
	const tu = `"this-unit"`
	const BS = `{"incursion":1,"strike-force":2,"onslaught":3}`
	gate := func(g string) string { return `{"type":"dice-gated","on_success":{"type":"no-effect"},` + g + `}` }
	sel := func(s string) string {
		return `{"type":"select-units","selector":{"owner":"friendly","count":1` + s + `},"effect":{"type":"no-effect"}}`
	}
	amod := func(m string) string {
		return leaf("ability-modifier", tu, `{"ability":"overkill","operation":"set","value":2,`+m+`}`)
	}
	tgt := func(m string) string { return leaf("targeting", `"attacker"`, m) }
	so := func(s string) string {
		return `{"type":"select-objective","selector":{"bind_as":"o",` + s + `},"effect":` + leaf("designate", tu, `{"subject":{"objective":{"selection_var":"o"}},"tag":"mutated"}`) + `}`
	}
	designate := func(c string) string {
		return leaf("designate", tu, `{"subject":"selected-unit","tag":"spotted","by":"this-unit","clears_on":"`+c+`"}`)
	}
	scaled := func(s string) string {
		return `{"type":"test","target":"selected-unit","modifier":{"test":"battle-shock","modifier":-1},"scaling":` + s + `}`
	}
	limits := `[{"frequency":"n-per-battle","count":1,"per":"model"},{"frequency":"once-per-battle-round","per":"army"}]`
	rollStep := `{"type":"roll","dice":"D3","roll_var":"blessing","effect":{"type":"sequence","steps":[` +
		leaf("stat-modifier", tu, `{"stat":"A","operation":"add","value":{"roll_var":"blessing"}}`) + `,` +
		leaf("mortal-wounds", tu, `{"count":{"roll_var":"blessing","successes_on":4}}`) + `,` +
		`{"type":"dice-gated","from":{"roll_var":"blessing"},"requirement":{"type":"pair","min_value":3},"on_success":{"type":"no-effect"}}]}}`
	cases := []struct {
		schema, value string
		ok            bool
	}{
		{"effect", leaf("feel-no-pain", `{"owner":"friendly","within":{"range":{"inches":6},"wholly":true},"embarked_in":"this-unit","member_of":"this-unit","engaged_with":{"owner":"enemy"},"not_engaged_with":{"owner":"friendly","excluding":"this-unit"},"has_ability":["deep-strike"],"lacks_ability":["lone-operative"]}`, `{"threshold":6}`), true},
		{"effect", leaf("feel-no-pain", `{"owner":"enemy","designated":"spotted","designated_by":"this-unit"}`, `{"threshold":6}`), true},
		{"effect", leaf("feel-no-pain", `{"owner":"enemy","designated_by":"this-unit"}`, `{"threshold":6}`), false},
		{"effect", leaf("ability-grant", `"bearer-transport"`, `{"ability":"scouts","value":9}`), true},
		{"effect", leaf("counts-as", `{"stratagem_target":"war-dogs"}`, `{"within":"aura","of":{"stratagem_target":"abhorrent"}}`), true},
		{"effect", `{"type":"select-units","selector":{"owner":"enemy","count":1,"eligibility":{"type":"happened","parameters":{"event":"after-roll","subject":"ability-unit","object":"this-unit","window":"phase"}}},"effect":{"type":"no-effect"}}`, true},
		{"effect", leaf("feel-no-pain", `"ability-units"`, `{"threshold":6}`), false},
		{"condition", `{"type":"within","parameters":{"subject":"this-model","of":"battlefield-centre","range":{"inches":6}}}`, true},
		{"effect", leaf("set-up", tu, `{"to":"battlefield","near":[{"of":{"marker":"teleport-homer"},"range":{"inches":3}}],"away_from":[{"of":{"owner":"enemy"},"range":{"inches":9}}],"in_region":{"region":{"territory":"your-deployment-zone"},"wholly":true},"placement":["closest-to-original","on-terrain"]}`), true},
		{"effect", leaf("return-models", tu, `{"count":1,"placement":["closest-to-destruction","unengaged"]}`), true},
		{"effect", sel(`,"within_inches":6,"wholly":true`), true},
		{"effect", sel(`,"wholly":true`), false},
		{"effect", leaf("move", tu, `{"move_type":"disembark","mode":"assault","allow_engagement":true,"counts_as_move":"normal","passthrough":[{"kind":"models","excluding":["MONSTER","VEHICLE"]},{"kind":"terrain","height":"up-to-4"},"all-terrain"],"ends_within":{"range":"objective-control","of":{"objective":{}}}}`), true},
		{"effect", leaf("permission", tu, `{"activity":"disembark","allow":true,"after":["advance"],"counts_as_move":"normal"}`), true},
		{"effect", leaf("move-modifier", tu, `{"passthrough":["walls-and-stuff"]}`), false},
		{"effect", leaf("move-modifier", tu, `{"passthrough":[{"kind":"terrain","excluding":["TITANIC"]}]}`), false},
		{"effect", leaf("move-modifier", tu, `{"passthrough":[{"kind":"models","height":"over-4"}]}`), false},
		{"effect", leaf("set-up", tu, `{"to":"strategic-reserves","mandatory":true}`), true},
		{"effect", leaf("set-up", tu, `{"to":"battlefield","arrives":"next-movement-phase","allow_first_round":true}`), true},
		{"effect", leaf("set-up", tu, `{"to":"battlefield","allow_first_round":true}`), false},
		{"condition", `{"type":"moved-over","parameters":{"by":"this-model","window":"event"}}`, true},
		{"condition", `{"type":"moved-over","parameters":{"window":"event"}}`, false},
		{"effect", rollStep, true},
		{"effect", `{"type":"roll","dice":"D3","effect":{"type":"no-effect"}}`, false},
		{"effect", gate(`"dice":"2D6","kind":"psychic","threshold":5`), true},
		{"effect", gate(`"dice":"D6","from":{"roll_var":"x"},"threshold":4`), false},
		{"effect", gate(`"dice":"D6","requirement":{"type":"pair","min_value":2}`), false},
		{"effect", gate(`"from":{"roll_var":"x"},"threshold":4,"requirement":{"type":"pair","min_value":2}`), false},
		{"effect", gate(`"dice":"D6","threshold":4,"roll_var":"x"`), false},
		{"effect", leaf("roll-modifier", tu, `{"roll":{"of_ability":"reanimation-protocols-necrons"},"operation":"add","value":1}`), true},
		{"effect", leaf("roll-modifier", tu, `{"roll":"manoeuvre","operation":"add","value":1}`), true},
		{"effect", leaf("re-roll", tu, `{"roll":"channelling","result_scope":"any-result","count":1,"mandatory":true}`), true},
		{"effect", leaf("roll-result", tu, `{"roll":"hit","result":6,"unmodified":true}`), true},
		{"effect", leaf("roll-result", tu, `{"roll":"hit","result":"pass","unmodified":true}`), false},
		{"effect", leaf("roll-result", tu, `{"roll":"hit","fails_on":3,"incoming":true}`), true},
		{"effect", leaf("roll-result", tu, `{"roll":"hit","fails_on":6}`), false},
		{"effect", leaf("resource-spend", tu, `{"pool":"fate-dice-pool","amount":1,"face":4}`), true},
		{"effect", leaf("resource-spend", tu, `{"pool":"p","amount":3,"requirement":{"type":"triple","min_value":6}}`), true},
		{"effect", leaf("resource-spend", tu, `{"pool":"p","amount":3,"face":6,"requirement":{"type":"triple","min_value":6}}`), false},
		{"effect", leaf("resource-gain", tu, `{"pool":"battle-focus-pool","amount":`+BS+`}`), true},
		{"effect", leaf("resource-die", tu, `{"pool":"fate-dice-pool","operation":"add","value":"rolled","count":`+BS+`}`), true},
		{"effect", leaf("return-models", tu, `{"count":{"count_of":"models-in-bearer-unit","keyword":"SPYDER"}}`), true},
		{"effect", leaf("army-rule", tu, `{"rule":"composition","measure":"points","max":`+BS+`}`), true},
		{"effect", `{"type":"select-units","selector":{"owner":"enemy","max_count":` + BS + `},"effect":{"type":"no-effect"}}`, true},
		{"effect", leaf("resource-gain", tu, `{"pool":"p","amount":{"incursion":1,"strike-force":2}}`), false},
		{"effect", leaf("re-roll", tu, `{"roll":"wound","result_scope":"any-result","count":{"count_of":"models-equipped-with"}}`), false},
		{"effect", leaf("re-roll", tu, `{"roll":"wound","result_scope":"any-result","count":{"count_of":"models-in-bearer-unit","wargear":"caltrops"}}`), false},
		{"effect", scaled(`{"per":10,"of":"models-in-bearer-unit","field":"modifier"}`), true},
		{"effect", scaled(`{"per":1,"of":"models-equipped-with","wargear":"cluster-caltrops","field":"count"}`), true},
		{"effect", scaled(`{"per":1,"of":"models-equipped-with"}`), false},
		{"condition", `{"type":"battle-size","parameters":{"size":"onslaught"}}`, true},
		{"condition", `{"type":"army-faction","parameters":{"faction":"necrons"}}`, true},
		{"effect", amod(`"aspect":"uses","cap_per":{"count":1,"period":"battle-round"},"consumes_shared_use":false`), true},
		{"effect", amod(`"aspect":"range","cap_per":{"count":1,"period":"battle-round"}`), false},
		{"effect", amod(`"aspect":"end-round"`), true},
		{"effect", leaf("ability-activate", tu, `{"ability":"blessings-of-khorne","select":{"by":"roll"},"ignore_consumed":true}`), true},
		{"effect", leaf("ability-activate", tu, `{"ability":"blessings-of-khorne","select":{"by":"roll"},"option":"Total Carnage"}`), false},
		{"ability", ability(`{"type":"no-effect"}`, `"usage":`+limits), true},
		{"ability", ability(`{"type":"no-effect"}`, `"usage":[{"frequency":"n-per-battle","count":1,"per":"model"}]`), false},
		{"ability", `{"ability_id":"shape-probe","name":"Shape probe","authored_by":"40kdc-community","game_version":{"edition":"11th","dataslate":"pre-launch-provisional"},"effect":{"type":"no-effect"},"scope":{"duration":"until-next-shooting-phase"}}`, true},
		{"effect", designate("until-end-of-opponent-next-turn"), true},
		{"effect", designate("control-lost"), true},
		{"effect", designate("phase-end"), true},
		{"effect", designate("whenever"), false},
		{"condition", `{"type":"terrain-area-control","parameters":{"footprint_ref":"ruins","min_models":3}}`, false},
		{"stratagem", strat(`[{"name":"psyker","selects":"model"},{"name":"tzaangors","side":"your-army"}]`), true},
		{"stratagem", strat(`[{"name":"psyker"},{"side":"your-army"}]`), false},
		{"stratagem", strat(`{"side":"your-army"}`), true},
		{"effect", leaf("army-rule", tu, `{"rule":"detachment-forbidden","detachment":"1st-company-task-force"}`), true},
		{"effect", leaf("army-rule", tu, `{"rule":"detachment-forbidden"}`), false},
		{"effect", leaf("army-rule", tu, `{"rule":"detachment-tag-exclusive"}`), false},
		{"effect", leaf("army-rule", tu, `{"rule":"attachment","attach_as":{"all_of":["BATTLE SISTERS SQUAD"]}}`), true},
		{"effect", leaf("army-rule", tu, `{"rule":"composition","attach_as":{"all_of":["X"]}}`), false},
		{"effect", leaf("army-rule", tu, `{"rule":"unique","per":{"all_of":["INQUISITOR"]}}`), false},
		{"effect", tgt(`{"may":"redirect","target":{"owner":"friendly"},"to":"this-unit","if_eligible":true}`), true},
		{"effect", tgt(`{"may":"redirect","target":{"owner":"friendly"}}`), false},
		{"effect", tgt(`{"may":"must-target","target":"this-unit","to":"this-unit"}`), false},
		{"effect", tgt(`{"may":"cannot-target","target":"this-model","kind":"stratagem","except":"core-stratagems"}`), true},
		{"effect", tgt(`{"may":"target","target":"this-model","kind":"stratagem","except":"core-stratagems"}`), false},
		{"effect", leaf("datasheet-swap", tu, `{"datasheet":"blue-horrors"}`), true},
		{"effect", leaf("characteristic-resolution", tu, `{"stat":"T","rule":"majority","tie":"highest","applies_to":"wound-roll","incoming":true}`), true},
		{"effect", leaf("characteristic-resolution", tu, `{"stat":"T","rule":"majority"}`), false},
		{"effect", leaf("characteristic-resolution", tu, `{"stat":"T","rule":"highest","tie":"lowest"}`), false},
		{"effect", leaf("borrow-weapons", tu, `{"from":{"embarked_in":"this-unit"},"max_models":2,"weapon_type":"ranged","exclude_weapon_keyword":["ONE SHOT"],"until":"attack-sequence"}`), true},
		{"effect", leaf("select-weapon", `"this-model"`, `{"count":1,"weapon_type":"melee","bind_as":"blade"}`), true},
		{"effect", leaf("stat-modifier", tu, `{"stat":"A","operation":"add","value":1,"weapon_ref":{"weapon_var":"blade"}}`), true},
		{"effect", leaf("roll-modifier", tu, `{"roll":"hit","operation":"add","value":1,"weapon_ref":{"selected_by":{"ability":"firing-deck"}}}`), true},
		{"effect", leaf("stat-modifier", `"this-model"`, `{"stat":"psyker-level","operation":"set","value":2}`), true},
		{"effect", so(`"count":1,"range":"objective-control","origin":"bearer-unit","controlled_by":"your-army"`), true},
		{"effect", so(`"count":"each","filter":{"controlled_by":"friendly"}`), true},
		{"effect", so(`"count":1,"range":"objective-control","range_inches":6`), false},
		{"effect", `{"type":"aura","target":"enemy-within-aura","modifier":{"range":3,"range_cap":12,"effect":{"type":"no-effect"}}}`, true},
		{"condition", `{"type":"guided","parameters":{}}`, true},
		{"condition", `{"type":"designated","parameters":{"subject":"defender","tag":"spotted","by":{"designated":"observer","all_of":["MARKERLIGHT"]}}}`, true},
	}
	for _, c := range cases {
		id := ids[c.schema]
		if got := v.valid(v.schemas[id], j(t, c.value), id); got != c.ok {
			var vs []violation
			v.check(v.schemas[id], j(t, c.value), "", id, &vs)
			t.Errorf("%s %s: valid=%v, want %v (%v)", c.schema, c.value, got, c.ok, vs)
		}
	}
}

// TestOneOfRejectsSeveralMatches pins oneOf exclusivity: an instance matching
// two branches is invalid (AJV and jsonschema agree), so a nested oneOf inside
// not / if / anyOf evaluates the same in every port.
func TestOneOfRejectsSeveralMatches(t *testing.T) {
	v := NewSchemaValidator()
	schema := map[string]any{"oneOf": []any{map[string]any{"type": "number"}, map[string]any{"minimum": 0.0}}}
	if v.valid(schema, 5.0, "") {
		t.Fatal("5 matches both branches but was accepted")
	}
	if !v.valid(schema, -1.0, "") || !v.valid(schema, "x", "") {
		t.Fatal("a single-branch match was rejected")
	}
	// The oneOf error maps to no closed-enum code, as in TS (AJV's "oneOf" keyword is unmapped).
	if _, ok := keywordToCode["oneOf"]; ok {
		t.Fatal("oneOf must stay unmapped")
	}
}
