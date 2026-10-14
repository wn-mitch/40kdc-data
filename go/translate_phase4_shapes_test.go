package wh40kdc

import (
	"encoding/json"
	"strings"
	"testing"
)

// Describer pins for the phase-4 shapes. Each expected string is the exact TS
// render pinned by tools/test/translate-phase4-shapes.test.ts; a drift in any
// port's wording breaks byte parity with the reference describer.

func j(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("bad fixture %s: %v", s, err)
	}
	return m
}

// renderAbility renders an effect as a permanent ability; extra merges in
// record-level fields (usage, scope).
func renderAbility(t *testing.T, effect string, extra string) string {
	t.Helper()
	a := map[string]any{"effect": j(t, effect), "scope": map[string]any{"duration": "permanent"}}
	if extra != "" {
		for k, v := range j(t, extra) {
			a[k] = v
		}
	}
	return describeAbility(a)
}

func TestPhase4ShapeRenders(t *testing.T) {
	cases := []struct{ name, effect, extra, want string }{
		{"wholly aura filter", `{"type":"feel-no-pain","target":{"owner":"friendly","all_of":["GREY KNIGHTS"],"within":{"range":{"inches":6},"wholly":true}},"modifier":{"threshold":6,"against":"mortal"}}`, "",
			`Friendly GREY KNIGHTS units wholly within 6" have the Feel No Pain 6+ ability against mortal wounds.`},
		{"wholly selection", `{"type":"select-units","selector":{"owner":"friendly","count":1,"keywords":["YNNARI","INFANTRY"],"within_inches":6,"wholly":true},"effect":{"type":"move","target":"selected-unit","modifier":{"move_type":"embark"}}}`, "",
			`Select one friendly YNNARI INFANTRY unit wholly within 6": that unit can embark.`},
		{"engagement relations", `{"type":"targeting","target":"this-model","modifier":{"by":"this-model","may":"target","target":{"owner":"enemy","within":{"range":"engagement","of":"this-model"},"not_engaged_with":{"owner":"friendly","excluding":"this-unit"}}}}`, "",
			"This model can target enemy units within Engagement Range of this model that are not within Engagement Range of any other friendly unit."},
		{"embarked passengers", `{"type":"move","target":{"owner":"friendly","embarked_in":"this-unit"},"modifier":{"move_type":"disembark","mode":"assault"}}`, "",
			"Friendly units embarked within the unit can disembark using the Assault Disembarkation rules."},
		{"bearer transport", `{"type":"ability-grant","target":"bearer-transport","modifier":{"ability":"scouts","value":9}}`, "",
			`The Transport this unit is embarked within gains the Scouts 9" ability.`},
		{"battlefield centre", `{"type":"conditional","condition":{"type":"within","parameters":{"subject":"this-model","of":"battlefield-centre","range":{"inches":6}}},"effect":{"type":"feel-no-pain","target":"this-model","modifier":{"threshold":4}}}`, "",
			`While this model is within 6" of the centre of the battlefield, this model has the Feel No Pain 4+ ability.`},
		{"placement limits", `{"type":"set-up","target":"this-unit","modifier":{"to":"battlefield","from":"strategic-reserves","via":"deep-strike","in_region":{"region":{"rule_region":{"region_id":"flow-of-magic"}},"wholly":true},"away_from":[{"of":{"owner":"enemy"},"range":{"inches":6}}]}}`, "",
			`The unit can be set up on the battlefield from Strategic Reserves using the Deep Strike rules wholly within Flow of Magic and more than 6" away from all enemy models.`},
		{"away from designated", `{"type":"set-up","target":"this-unit","modifier":{"to":"battlefield","from":"strategic-reserves","away_from":[{"of":{"owner":"enemy","designated":"afflicted"},"range":{"inches":6}},{"of":{"owner":"enemy","not_designated":"afflicted"},"range":{"inches":8}}]}}`, "",
			`The unit can be set up on the battlefield from Strategic Reserves more than 6" away from enemy units that are Afflicted and 8" away from enemy units that are not Afflicted.`},
		{"return detached", `{"type":"return-models","target":"this-model","modifier":{"count":1,"wounds_remaining":"D3","placement":["closest-to-destruction","unengaged"],"detach":true,"starting_strength":1}}`, "",
			"This model is set up again as close as possible to where it was destroyed and not within Engagement Range of any enemy units with D3 wounds remaining, as a separate unit with a Starting Strength of 1 (it is no longer part of its attached unit)."},
		{"ability-unit attacker", `{"type":"select-units","selector":{"owner":"enemy","count":1,"eligibility":{"type":"happened","parameters":{"event":"after-roll","subject":"ability-unit","object":"this-unit","filter":{"roll":"hit","result":"success"},"window":"phase"}}},"effect":{"type":"test","target":"selected-unit","modifier":{"test":"battle-shock"}}}`, "",
			"Select one enemy unit that was hit by an attack made by this unit this phase: that unit must take a Battle-shock test."},
		{"candidate names no attacker", `{"type":"select-units","selector":{"owner":"enemy","count":1,"eligibility":{"type":"happened","parameters":{"event":"after-roll","subject":"this-unit","object":"this-unit","filter":{"roll":"hit","result":"success"},"window":"phase"}}},"effect":{"type":"test","target":"selected-unit","modifier":{"test":"battle-shock"}}}`, "",
			"Select one enemy unit that was hit by an attack this phase: that unit must take a Battle-shock test."},
		{"permission counts as move", `{"type":"permission","target":"stratagem-target","modifier":{"activity":"disembark","allow":true,"after":["advance"],"counts_as_move":"normal"}}`, "",
			"That unit is eligible to disembark in a turn in which it Advanced; if it does, it counts as having made a Normal move this turn."},
		{"move engagement", `{"type":"move","target":"selected-unit","modifier":{"move_type":"disembark","ends_within":{"range":{"inches":6},"of":"this-unit","wholly":true},"allow_engagement":true}}`, "",
			`The selected unit can disembark, ending that move wholly within 6" of the unit; it can end that move within Engagement Range of enemy units.`},
		{"mandatory reserves", `{"type":"set-up","target":"this-model","modifier":{"to":"strategic-reserves","mandatory":true}}`, "", "This model must be placed into Strategic Reserves."},
		{"next movement phase", `{"type":"set-up","target":"this-unit","modifier":{"to":"battlefield","from":"strategic-reserves","arrives":"next-movement-phase","allow_first_round":true}}`, "",
			"The unit can be set up on the battlefield from Strategic Reserves in the Reinforcements step of your next Movement phase (even in the first battle round)."},
		{"typed passthrough", `{"type":"move-modifier","target":"this-unit","modifier":{"applies_to_moves":["charge"],"passthrough":[{"kind":"models","excluding":["MONSTER","VEHICLE"]},{"kind":"terrain","height":"up-to-4"}]}}`, "",
			`The unit can move over models (excluding MONSTER and VEHICLE models) and terrain features 4" or lower as though they were not there, during its Charge moves.`},
		{"shared roll", `{"type":"roll","dice":"D3","roll_var":"absorbed","effect":{"type":"sequence","steps":[{"type":"mortal-wounds","target":"selected-unit","modifier":{"count":{"roll_var":"absorbed"}}},{"type":"heal","target":"this-model","modifier":{"amount":{"roll_var":"absorbed"}}}]}}`, "",
			"Roll D3, then:\n  -> The selected unit suffers a number of mortal wounds equal to the result of that roll.\n  -> This model regains up to a number of lost wounds equal to the result of that roll."},
		{"psychic gate", `{"type":"dice-gated","dice":"2D6","kind":"psychic","threshold":5,"on_success":{"type":"mortal-wounds","target":"selected-unit","modifier":{"count":"D3"}}}`, "",
			"Roll 2D6 (a Psychic test): on a 5+, the selected unit suffers D3 mortal wounds."},
		{"ability roll", `{"type":"roll-modifier","target":"this-unit","modifier":{"roll":{"of_ability":"reanimation-protocols-necrons"},"operation":"add","value":1}}`, "", "The unit gets +1 to Reanimation Protocols rolls."},
		{"unmodified result", `{"type":"roll-result","target":"this-unit","modifier":{"roll":"hit","result":6,"unmodified":true}}`, "", "The unit's Hit rolls count as an unmodified 6."},
		{"fails on", `{"type":"roll-result","target":"this-unit","modifier":{"roll":"hit","fails_on":3,"weapon_type":"ranged","incoming":true}}`, "",
			"Each time a ranged attack targets the unit, an unmodified Hit roll of 1-3 for that attack always fails."},
		{"fails on own", `{"type":"roll-result","target":"this-unit","modifier":{"roll":"hit","fails_on":1}}`, "", "The unit's Hit rolls always fail on an unmodified 1."},
		{"mandatory re-roll", `{"type":"re-roll","target":"event-subject","modifier":{"roll":"hit","subset":"ones","mandatory":true}}`, "", "You must re-roll a Hit roll of 1 for attacks made by the triggering unit."},
		{"spend requirement", `{"type":"resource-spend","target":"this-unit","modifier":{"pool":"blessings-of-khorne-pool","amount":3,"requirement":{"type":"triple","min_value":6}}}`, "", "Spend 3 Blessings of Khorne dice forming a triple of 6+."},
		{"spend face", `{"type":"resource-spend","target":"this-unit","modifier":{"pool":"fate-dice-pool","amount":1,"face":4}}`, "", "Spend 1 Fate die showing a 4."},
		{"battle-size gain", `{"type":"resource-gain","target":"this-model","modifier":{"pool":"battle-focus-pool","amount":{"incursion":2,"strike-force":4,"onslaught":6},"label":"Battle Focus token"}}`, "",
			"You gain 2/4/6 Battle Focus tokens (Incursion/Strike Force/Onslaught)."},
		{"battle-size select", `{"type":"select-units","selector":{"owner":"enemy","max_count":{"incursion":1,"strike-force":2,"onslaught":3}},"effect":{"type":"designate","target":"selected-unit","modifier":{"subject":"selected-unit","tag":"afflicted"}}}`, "",
			"Select up to 1/2/3 enemy units (Incursion/Strike Force/Onslaught): that unit is Afflicted."},
		{"battle-size condition", `{"type":"conditional","condition":{"type":"battle-size","parameters":{"size":"incursion"}},"effect":{"type":"add-unit","target":"this-unit","modifier":{"datasheet":"poxwalkers","count":1,"starting_strength":10,"placement":"strategic-reserves"}}}`, "",
			"If the battle size is Incursion, add a Poxwalkers unit with a Starting Strength of 10 to your army in Strategic Reserves."},
		{"counted select", `{"type":"select-units","selector":{"owner":"friendly","keywords":["ORKS"],"max_count":{"count_of":"battle-round"}},"effect":{"type":"no-effect"}}`, "",
			"Select any number of friendly ORKS units (at most the battle round number): nothing happens."},
		{"counted return", `{"type":"return-models","target":"selected-unit","modifier":{"count":{"count_of":"models-in-bearer-unit","keyword":"SPYDER"}}}`, "",
			"Return a number of destroyed models equal to the number of SPYDER models in this unit to the selected unit, each with its full wounds remaining."},
		{"oc scaling", `{"type":"stat-modifier","target":"this-model","modifier":{"stat":"OC","operation":"add","value":1},"scaling":{"per":1,"of":"embarked-models-oc"}}`, "",
			"Add 1 to this model's Objective Control characteristic for every point of Objective Control of the models embarked within this model."},
		{"end round", `{"type":"ability-modifier","target":"this-unit","modifier":{"ability":"killing-blow-tau-empire","aspect":"end-round","operation":"set","value":4}}`, "", "The last battle round of the unit's Killing Blow ability is 4."},
		{"cap per", `{"type":"ability-modifier","target":"this-model","modifier":{"ability":"overkill","aspect":"uses","operation":"set","value":2,"cap_per":{"count":1,"period":"battle-round"}}}`, "",
			"The number of uses of this model's Overkill ability is 2, but it can be used at most once per battle round."},
		{"not same", `{"type":"ability-modifier","target":"stratagem-target","modifier":{"ability":{"event":"used"},"aspect":"uses","operation":"add","value":1,"not_same":"phase"}}`, "",
			"Increase the number of uses of that ability by 1, but not in the same phase as the use that triggered this."},
		{"activate by roll", `{"type":"ability-activate","target":"this-unit","modifier":{"ability":"blessings-of-khorne","select":{"by":"roll"}}}`, "",
			"Make a new Blessings of Khorne roll and activate one result it allows for the unit, in addition to any already active."},
		{"activate override", `{"type":"ability-activate","target":"this-unit","modifier":{"ability":"reanimation-protocols-necrons","override":{"amount":"D6"}}}`, "",
			"The unit resolves the Reanimation Protocols ability now, using D6 in place of its usual amount."},
		{"usage list", `{"type":"mortal-wounds","target":"event-subject","modifier":{"count":"D3+3"}}`, `{"usage":[{"frequency":"n-per-battle","count":1,"per":"model"},{"frequency":"once-per-battle-round","per":"army"}]}`,
			"Once per battle per model and once per battle round per army, the triggering unit suffers D3+3 mortal wounds."},
		{"engaged shooting", `{"type":"rule-state","target":"this-model","modifier":{"direction":"suppressed","rule_kind":"core-rule","rule":"engaged-shooting-hit-penalty"}}`, "",
			"This model does not suffer the -1 to Hit for shooting while within Engagement Range."},
		{"keeps orders", `{"type":"rule-state","target":"this-unit","modifier":{"direction":"suppressed","rule_kind":"core-rule","rule":"orders-end-on-battle-shock"}}`, "", "The unit keeps its Orders when it becomes Battle-shocked."},
		{"shooting expiry", `{"type":"stat-modifier","target":"selected-unit","modifier":{"stat":"Ld","operation":"subtract","value":1}}`, `{"scope":{"duration":"until-next-shooting-phase"}}`,
			"Until the start of your next Shooting phase, subtract 1 from the selected unit's Leadership characteristic."},
		{"designate expiry", `{"type":"designate","target":"this-unit","modifier":{"subject":"selected-unit","tag":"assailed","clears_on":"until-end-of-opponent-next-turn"}}`, "",
			"The selected unit is marked as assailed until the end of your opponent's next turn."},
		{"test exemption", `{"type":"test-exemption","target":"this-unit","modifier":{"test":"battle-shock","window":"phase"}}`, "", "The unit does not need to take any further Battle-shock tests this phase."},
		{"composition per", `{"type":"army-rule","target":"this-unit","modifier":{"rule":"composition","with":{"all_of":["INQUISITORIAL AGENTS"]},"max":1,"per":{"all_of":["INQUISITOR"]},"exempt_from":["retinue-limit"]}}`, "",
			"Your army can include at most 1 INQUISITORIAL AGENTS unit for each INQUISITOR unit in your army; they do not count toward the Retinue limit."},
		{"points by battle size", `{"type":"army-rule","target":"this-unit","modifier":{"rule":"composition","with":{"any_of":["HARLEQUINS","ANHRATHE"]},"measure":"points","max":{"incursion":250,"strike-force":500,"onslaught":750}}}`, "",
			"Your army can include at most 250/500/750 (Incursion/Strike Force/Onslaught) points of units with the HARLEQUINS or ANHRATHE keyword."},
		{"detachment forbidden", `{"type":"army-rule","target":"this-unit","modifier":{"rule":"detachment-forbidden","detachment":"1st-company-task-force"}}`, "", "You cannot select the 1st Company Task Force Detachment."},
		{"attach as", `{"type":"army-rule","target":"this-unit","modifier":{"rule":"attachment","attach_as":{"all_of":["BATTLE SISTERS SQUAD"]}}}`, "",
			"A Leader that can be attached to BATTLE SISTERS SQUAD units can also be attached to the unit."},
		{"datasheet swap", `{"type":"datasheet-swap","target":"this-unit","modifier":{"datasheet":"blue-horrors"}}`, "", "The unit uses the Blue Horrors datasheet from now on, keeping its lost wounds and its position."},
		{"toughness majority", `{"type":"characteristic-resolution","target":"this-unit","modifier":{"stat":"T","rule":"majority","tie":"highest","applies_to":"wound-roll","incoming":true}}`, "",
			"Each time an attack targets the unit, use the Toughness characteristic of the majority of its models (if tied, the highest) to determine the Wound roll."},
		{"firing deck", `{"type":"borrow-weapons","target":"this-unit","modifier":{"from":{"embarked_in":"this-unit"},"max_models":2,"weapon_type":"ranged","exclude_weapon_keyword":["ONE SHOT"],"until":"attack-sequence"}}`, "",
			"The unit can use one ranged weapon (excluding [ONE SHOT] weapons) from each of up to 2 models embarked within the unit until that unit finishes resolving its attacks; those models cannot shoot."},
		{"select weapon", `{"type":"select-weapon","target":"this-model","modifier":{"count":1,"weapon_type":"melee","bind_as":"blade"}}`, "",
			"Select one melee weapon equipped by this model; the effects below refer to it as the selected weapon."},
		{"selected weapons", `{"type":"roll-modifier","target":"this-unit","modifier":{"roll":"hit","operation":"add","value":1,"weapon_type":"ranged","weapon_ref":{"selected_by":{"ability":"firing-deck"}}}}`, "",
			"The unit gets +1 to Hit rolls with the ranged weapons selected for Firing Deck."},
		{"redirect", `{"type":"targeting","target":"attacker","modifier":{"by":"event-subject","may":"redirect","target":{"owner":"friendly","all_of":["ANATHEMA PSYKANA"]},"to":"this-unit","if_eligible":true,"kind":"attack"}}`, "",
			"Attacks made by the triggering unit that target a friendly ANATHEMA PSYKANA unit must target the unit instead, if the unit is an eligible target."},
		{"core stratagems", `{"type":"targeting","target":"this-model","modifier":{"by":{"owner":"friendly"},"may":"cannot-target","target":"this-model","kind":"stratagem","except":"core-stratagems"}}`, "",
			"Friendly units cannot target this model with Stratagems (Core Stratagems can still target it)."},
		{"stratagem targets", `{"type":"counts-as","target":{"stratagem_target":"war-dogs"},"modifier":{"within":"aura","of":{"stratagem_target":"abhorrent"}}}`, "",
			"The war dogs target counts as being within its aura range of the abhorrent target."},
		{"select objective", `{"type":"select-objective","selector":{"count":1,"range":"objective-control","origin":"bearer-unit","controlled_by":"your-army","bind_as":"m"},"effect":{"type":"designate","target":"this-unit","modifier":{"subject":{"objective":{"selection_var":"m"}},"tag":"mutated","clears_on":"control-lost"}}}`, "",
			"Select one objective marker you control that the bearer's unit is within range of: that objective marker is marked as mutated until you no longer control it."},
		{"aura cap", `{"type":"aura","target":"enemy-within-aura","modifier":{"range":3,"range_cap":12,"emitter_filter":{"required_keywords":["DEATH GUARD"]},"effect":{"type":"designate","target":"recipient","modifier":{"subject":"recipient","tag":"afflicted"}}}}`, "",
			`While an enemy unit is within 3" (to a maximum of 12", extensions included) of this model with DEATH GUARD, that unit is Afflicted.`},
		{"the- stratagem target", `{"type":"counts-as","target":{"stratagem_target":"the-lure"},"modifier":{"within":"aura","of":"this-unit"}}`, "",
			"The lure target counts as being within its aura range of the unit."},
		{"singular weapon gains", `{"type":"weapon-ability-grant","target":"this-model","modifier":{"abilities":["lethal-hits"],"weapon_ref":{"weapon_var":"b"}}}`, "",
			"The selected weapon equipped by this model gains [LETHAL HITS]."},
		{"plural core rule", `{"type":"rule-state","target":{"owner":"friendly"},"modifier":{"direction":"granted","rule_kind":"core-rule","rule":"orders-end-on-battle-shock"}}`, "",
			"All friendly units lose their Orders when it becomes Battle-shocked."},
		{"spotted by", `{"type":"designate","target":"this-unit","modifier":{"subject":"selected-unit","tag":"spotted","by":"this-unit","clears_on":"phase"}}`, "", "The selected unit is Spotted by the unit until the end of the phase."},
	}
	for _, c := range cases {
		if got := renderAbility(t, c.effect, c.extra); got != c.want {
			t.Errorf("%s:\n got  %q\n want %q", c.name, got, c.want)
		}
	}
}

func TestPhase4BlessingsOfKhorneRender(t *testing.T) {
	text := renderAbility(t, `{"type":"roll","dice":"8D6","extra_dice_pool":"blessings-of-khorne-pool","kind":"blessings-of-khorne","roll_var":"bok",
		"effect":{"type":"choice","min_choices":0,"max_choices":2,"options":[
		{"type":"ability-part","name":"Unbridled Bloodlust","effect":{"type":"dice-gated","from":{"roll_var":"bok"},"requirement":{"type":"pair","min_value":1},"on_success":{"type":"roll-modifier","target":{"owner":"friendly"},"modifier":{"roll":"charge","operation":"add","value":1}}}},
		{"type":"ability-part","name":"Total Carnage","effect":{"type":"dice-gated","from":{"roll_var":"bok"},"requirement":{"any_of":[{"type":"pair","min_value":6},{"type":"triple","min_value":3}]},"on_success":{"type":"no-effect"}}}]}}`, "")
	for _, want := range []string{
		"Roll 8D6, plus one D6 for each die in your Blessings of Khorne pool (a Blessings of Khorne roll), then:",
		"Use Unbridled Bloodlust: using a pair of 1+ from that roll's unused dice, all friendly units get +1 to Charge rolls.",
		"using a pair of 6+ or triple of 3+ from that roll's unused dice",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
}

func TestPhase4ConditionAndTriggerRenders(t *testing.T) {
	conditions := []struct{ c, want string }{
		{`{"type":"within","parameters":{"of":{"owner":"friendly","all_of":["INFANTRY"],"lacks_ability":["lone-operative"]},"range":{"inches":3}}}`,
			`the unit is within 3" of a friendly INFANTRY unit without the Lone Operative ability`},
		{`{"type":"moved-over","parameters":{"by":"this-model"}}`, "the unit was moved over by this model during that move"},
		{`{"type":"army-faction","parameters":{"faction":"necrons"}}`, "your Army Faction is NECRONS"},
		{`{"type":"guided","parameters":{}}`, "the unit is Guided"},
		{`{"type":"designated","parameters":{"subject":"defender","tag":"spotted","by":{"designated":"observer","all_of":["MARKERLIGHT"]}}}`,
			"the target unit is Spotted by a MARKERLIGHT unit that is an Observer"},
		{`{"type":"happened","parameters":{"event":"used","filter":{"kind":"ability","same_rule_as":{"event_var":"b"}},"window":"turn"}}`, "the unit used that same ability this turn"},
		{`{"operator":"not","operands":[{"type":"battle-size","parameters":{"size":"strike-force"}}]}`, "the battle size is not Strike Force"},
	}
	for _, c := range conditions {
		if got := describeCondition(j(t, c.c)); got != c.want {
			t.Errorf("condition %s:\n got  %q\n want %q", c.c, got, c.want)
		}
	}
	triggers := []struct{ tr, want string }{
		{`{"event":"used","subject":{"owner":"friendly"},"filter":{"kind":"ability","ability_keyword":"BONDSMAN"}}`, "each time a friendly unit uses a Bondsman ability"},
		{`{"event":"step-started","filter":{"step":"reinforcements"}}`, "at the start of the Reinforcements step"},
	}
	for _, c := range triggers {
		if got := describeReactiveTrigger(j(t, c.tr)); got != c.want {
			t.Errorf("trigger %s:\n got  %q\n want %q", c.tr, got, c.want)
		}
	}
}
