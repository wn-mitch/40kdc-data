package wh40kdc

import "strings"

// History predicates (`happened`): what a unit did earlier in the window.
// Part of the condition describer; mirror of tools/src/translate/condition.ts.

var happenedMoveVerbs = map[string]string{
	"charge": "charge", "advance": "advance", "fall-back": "fall back",
	"remain-stationary": "remain stationary", "ingress": "make an ingress move",
}

// pastVerbs is the past tense of the verbs history predicates use.
var pastVerbs = map[string]string{
	"charge": "charged", "advance": "advanced", "fall back": "fell back", "remain stationary": "remained stationary",
	"make an ingress move": "made an ingress move", "move": "moved", "disembark": "disembarked",
}

func pastOf(verb string) string {
	if p, ok := pastVerbs[verb]; ok {
		return p
	}
	if rest, ok := strings.CutPrefix(verb, "make "); ok {
		return "made " + rest
	}
	return verb
}

func describeHappenedCore(p map[string]any, negated bool) string {
	neg := ""
	if negated {
		neg = "not "
	}
	f := mapOr(p["filter"])
	event := cstr(p["event"])
	who := subjectOf(p, "the unit")
	count := mapOr(p["count"])
	amount := controlCountPhrase(p["count"])
	didNot := func(verb string) string {
		if negated {
			return "did not " + verb
		}
		return pastOf(verb)
	}
	switch event {
	case "move-ended":
		types := cstrList(f["move_types"])
		var done string
		if v, ok := happenedMoveVerbs[firstOr(types)]; len(types) == 1 && ok {
			done = didNot(v)
		} else if len(types) > 0 {
			done = didNot("make a " + moveKinds(f["move_types"]) + " move")
		} else {
			done = didNot("move")
		}
		return withWindow(who+" "+done, p["window"])
	case "selected":
		to := cstr(f["to"])
		has := "has"
		if negated {
			has = "has not"
		}
		if to == "fight" {
			return withWindow(who+" "+has+" fought", p["window"])
		}
		verb := dekebab(to)
		if to == "attack" {
			verb = "shoot or fight"
		}
		return withWindow(who+" "+has+" been selected to "+verb, p["window"])
	case "set-up":
		was := "was"
		if negated {
			was = "was not"
		}
		setUpFrom := map[string]string{"deep-strike": " using Deep Strike", "strategic-reserves": " from Strategic Reserves", "cult-ambush": " from Cult Ambush", "transport": " from a Transport"}
		return withWindow(who+" "+was+" set up"+setUpFrom[cstr(f["from"])], p["window"])
	case "targets-selected":
		has := "has"
		if negated {
			has = "has not"
		}
		// A named Stratagem's targeting (compile-opponent-stratagem.ts): the unit targeted, by name.
		if cstr(f["kind"]) == "stratagem" && f["id"] != nil {
			target := "the unit"
			if p["object"] != nil {
				target = unitRefPhrase(p["object"], "the unit")
			}
			return withWindow(target+" "+has+" been targeted with the "+idLabel(f["id"])+" Stratagem", p["window"])
		}
		// Only ranged (or melee, psychic) attacks: "as a target of its ranged attacks".
		atk := ""
		if truthy(f["attack_type"]) {
			atk = cstr(f["attack_type"])
		}
		what := "targets"
		if atk != "" {
			what += " for its " + atk + " attacks"
		}
		if p["object"] != nil {
			what = unitRefPhrase(p["object"], "the unit") + " as a target"
			if atk != "" {
				what += " of its " + atk + " attacks"
			}
		}
		return withWindow(who+" "+has+" selected "+what, p["window"])
	case "disembarked":
		from := "a Transport"
		if f["transport"] == "this-unit" || f["transport"] == "this-model" {
			from = "this Transport"
		} else if f["transport"] != nil {
			from = unitRefPhrase(f["transport"], "the unit")
		}
		return withWindow(who+" "+didNot("disembark")+" from "+from, p["window"])
	case "after-roll":
		obj := unitRefPhrase(p["object"], "the unit")
		target := obj
		if obj == "the target unit" {
			target = "the target"
		}
		atk := ""
		if jsTruthy(f["attack_type"]) {
			atk = cstr(f["attack_type"]) + " "
		}
		weapon := ""
		if f["weapons"] != nil {
			scope := mapOr(f["weapons"])
			keys := 0
			for key := range scope {
				if key != "name" && key != "keyword" {
					keys++
				}
			}
			if keys == 0 && scope["name"] != nil && scope["keyword"] != nil {
				weapon = " by " + ejstr(scope["name"]) + " (with " + bracketKeyword(scope["keyword"]) + ")"
			} else if keys == 0 && scope["name"] != nil {
				weapon = " by " + ejstr(scope["name"])
			} else {
				weapon = " made with " + weaponNoun(map[string]any{"weapons": scope})
			}
		}
		by := ""
		if byMap, ok := asMap(f["by"]); ok && byMap != nil {
			if _, has := byMap["event_var"]; has {
				by = " from the triggering unit"
			} else {
				by = " from " + unitRefPhrase(f["by"], "the unit")
			}
		} else if f["by"] != nil {
			by = " from " + unitRefPhrase(f["by"], "the unit")
		}
		when := " " + windowPhrase(p["window"])
		if p["window"] == "event" {
			when = " during its just-finished shooting sequence"
		}
		if f["roll"] == "hit" && f["result"] == "success" {
			var hits string
			switch {
			case (count["min"] != nil && cstr(count["min"]) != "1") || count["max"] != nil:
				hits = amount + " " + atk + "attacks"
			case atk == "":
				hits = "an attack"
			default:
				hits = "a " + atk + "attack"
			}
			// Who made the attacks, when it is not the unit being checked ("hit by an attack made by this unit").
			attacker := ""
			if p["subject"] != nil && p["subject"] != "this-unit" {
				attacker = " made by " + unitRefPhrase(p["subject"], "the unit")
			}
			return neg + target + " was hit by " + hits + attacker + weapon + by + when
		}
		// Whose roll it was, when the subject names one: "the unit made a battle-shock roll and failed it".
		if p["subject"] != nil {
			outcome := ""
			if f["result"] == "failure" {
				outcome = " and failed it"
			} else if f["result"] == "success" {
				outcome = " and passed it"
			}
			return trimEnd(neg + who + " made a " + rollWord(f["roll"]) + " roll" + outcome + " " + windowPhrase(p["window"]))
		}
		result := "was made "
		if jsTruthy(f["result"]) {
			result = "was a " + cstr(f["result"]) + " "
		}
		return trimEnd(neg + "a " + rollWord(f["roll"]) + " roll " + result + windowPhrase(p["window"]))
	case "damage-allocated":
		obj := unitRefPhrase(p["object"], "the unit")
		atk := ""
		if jsTruthy(f["attack_type"]) {
			atk = cstr(f["attack_type"]) + " "
		}
		tail := " " + windowPhrase(p["window"])
		if p["window"] == "event" {
			tail = " from the triggering attacks"
		}
		return neg + obj + " lost one or more wounds from " + atk + "attacks" + tail
	case "destroyed", "model-destroyed":
		noun := "unit"
		if event == "model-destroyed" {
			noun = "model"
		}
		if p["object"] == "event-object" && p["window"] == "event" {
			if jsTruthy(f["attack_type"]) {
				s := neg + "destroyed by a " + cstr(f["attack_type"]) + " attack"
				if jsTruthy(f["weapons"]) {
					s += " made with " + weaponNoun(map[string]any{"weapons": f["weapons"]})
				}
				return s
			}
			return neg + "destroyed by any attack"
		}
		// "this model": the destroyed model is this one, not any model of the unit.
		if p["object"] == "this-model" {
			if negated {
				return withWindow("this model was not destroyed", p["window"])
			}
			return withWindow("this model was destroyed", p["window"])
		}
		obj := map[string]any{}
		if m, ok := asMap(p["object"]); ok && m != nil {
			obj = m
		}
		kws := ""
		if isList(obj["all_of"]) {
			kws = strings.Join(cstrList(obj["all_of"]), " ") + " "
		}
		owner := ""
		if obj["owner"] != nil {
			owner = cstr(obj["owner"]) + " "
		}
		extended := false
		for key := range obj {
			switch key {
			case "all_of", "owner", "level", "designated":
			default:
				extended = true
			}
		}
		objects := owner + kws + noun + "s"
		if extended {
			copy := cloneMap(obj)
			copy["level"] = "unit"
			if event == "model-destroyed" {
				copy["level"] = "model"
			}
			objects = strings.TrimPrefix(strings.TrimPrefix(unitFilterPhrase(copy), "a "), "an ")
			objects = strings.Replace(objects, "unit", "units", 1)
			if event == "model-destroyed" {
				objects = strings.Replace(objects, "model", "models", 1)
			}
		}
		if f["by"] != nil {
			// A destruction by one attack type says it: "with its just-resolved melee attacks", "with melee attacks this phase".
			atk := ""
			if jsTruthy(f["attack_type"]) {
				atk = cstr(f["attack_type"]) + " "
			}
			when := windowPhrase(p["window"])
			if p["window"] == "event" {
				when = "with its just-resolved " + atk + "attacks"
			} else if atk != "" {
				when = "with " + atk + "attacks " + windowPhrase(p["window"])
			}
			return trimEnd(neg + unitRefPhrase(f["by"], "the unit") + " has destroyed " + amount + " " + objects + " " + when)
		}
		tagged := ""
		if !extended && obj["designated"] != nil {
			tagged = " " + designationPhrase(cstr(obj["designated"]), false)
		}
		return neg + withWindow(amount+" "+objects+tagged+" destroyed", p["window"])
	case "used":
		// The use being resolved now: "the unit is performing the Swift as the Wind Agile Manoeuvre".
		if p["window"] == "event" && f["ability_keyword"] == nil && f["same_rule_as"] == nil {
			kind := "ability"
			if f["kind"] != nil {
				kind = cstr(f["kind"])
			}
			rule := namedUsePhrase(f)
			if rule == "" {
				var ok bool
				if rule, ok = inProgressPhrases[kind]; !ok {
					rule = "a " + dekebab(kind)
				}
			}
			verb := "performing"
			if kind == "ability" || kind == "stratagem" {
				verb = "using"
			}
			not := ""
			if negated {
				not = "not "
			}
			return who + " is " + not + verb + " " + rule
		}
		if f["kind"] == "action" {
			s := neg + amount + " actions completed"
			if f["id"] != nil {
				s += " (" + dekebab(cstr(f["id"])) + ")"
			}
			if o, ok := asMap(p["object"]); ok && o != nil {
				switch {
				case jsTruthy(o["objective"]):
					s += " on " + objectivePhrase(mapOr(o["objective"]), false, "objective")
				case jsTruthy(o["terrain_area"]):
					s += " on terrain"
					ta := mapOr(o["terrain_area"])
					if jsTruthy(ta["territory"]) {
						s += " in " + dekebab(cstr(ta["territory"]))
					}
				case o["owner"] == "enemy":
					s += " on an enemy unit"
				}
			}
			return withWindow(s, p["window"])
		}
		if which := usedAbilityPhrase(f); which != "" {
			return neg + withWindow(who+" used "+which, p["window"])
		}
		what := "a "
		if f["id"] != nil {
			what = "the " + idLabel(f["id"]) + " "
		}
		kind := f["kind"]
		if kind == nil {
			kind = "ability"
		}
		return neg + withWindow(who+" used "+what+dekebab(cstr(kind)), p["window"])
	case "objective-gained":
		return trimEnd(neg + "you newly control " + amount + " objectives " + windowPhrase(p["window"]))
	case "designation-changed":
		return neg + withWindow(amount+" "+unitRefPhrase(p["object"], "units")+" became "+designationPhrase(cstr(f["tag"]), false), p["window"])
	}
	return neg + withWindow(dekebab(event)+" happened", p["window"])
}

func describeHappened(p map[string]any, negated bool) string {
	phrase := describeHappenedCore(p, negated)
	filter := mapOr(p["filter"])
	event := cstr(p["event"])
	if (event == "destroyed" || event == "model-destroyed") && filter["weapons"] != nil &&
		!(p["object"] == "event-object" && p["window"] == "event") {
		phrase += " made with " + weaponNoun(map[string]any{"weapons": filter["weapons"]})
	}
	if p["count"] != nil && (event == "destroyed" || event == "model-destroyed") &&
		(p["object"] == "this-model" || (p["object"] == "event-object" && p["window"] == "event")) {
		phrase += " (" + controlCountPhrase(p["count"]) + " times)"
	}
	phrase += eventRelationPhrase(filter)
	if proximity, ok := asMap(p["proximity"]); ok && proximity != nil {
		phrase += " within " + rangePhrase(proximity["range"]) + " of " + placeRefPhrase(proximity["of"])
	}
	if p["count"] != nil && event != "after-roll" && event != "destroyed" && event != "model-destroyed" &&
		event != "objective-gained" && event != "designation-changed" &&
		!(event == "used" && filter["kind"] == "action") {
		phrase += " (" + controlCountPhrase(p["count"]) + " times)"
	}
	return phrase
}

func firstOr(items []string) string {
	if len(items) == 0 {
		return ""
	}
	return items[0]
}

func destroyedCount(side map[string]any) string {
	o := mapOr(side["object"])
	return trimEnd(cstr(o["owner"]) + " units " + windowPhrase(side["window"]))
}
