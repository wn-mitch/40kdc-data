package wh40kdc

import "strings"

// History predicates (`happened`): what a unit did earlier in the window.
// Part of the condition describer; mirror of tools/src/translate/condition.ts.

// countMin is `typeof p.count_min === "number" ? p.count_min : 1`.
func countMin(p map[string]any) float64 {
	if n, ok := num(p["count_min"]); ok {
		return n
	}
	return 1
}

// countMinOr1 is `p.count_min ?? 1` rendered through cstr.
func countMinOr1(p map[string]any) string {
	if p["count_min"] == nil {
		return "1"
	}
	return cstr(p["count_min"])
}

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

func describeHappened(p map[string]any, negated bool) string {
	neg := ""
	if negated {
		neg = "not "
	}
	f := mapOr(p["filter"])
	event := cstr(p["event"])
	who := subjectOf(p, "the unit")
	n := countMin(p)
	nStr := numStr(n)
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
	case "disembarked":
		return withWindow(who+" "+didNot("disembark")+" from a Transport", p["window"])
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
		keyword := ""
		if jsTruthy(f["weapon_keyword"]) {
			keyword = "[" + strings.ToUpper(dekebab(cstr(f["weapon_keyword"]))) + "]"
		}
		weapon := ""
		if jsTruthy(f["weapon_name"]) {
			weapon = " by " + cstr(f["weapon_name"])
			if keyword != "" {
				weapon += " (with " + keyword + ")"
			}
		} else if keyword != "" {
			weapon = " made with a " + keyword + " weapon"
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
			case n > 1:
				hits = nStr + "+ " + atk + "attacks"
			case atk == "":
				hits = "an attack"
			default:
				hits = "a " + atk + "attack"
			}
			return neg + target + " was hit by " + hits + weapon + by + when
		}
		result := "was made "
		if jsTruthy(f["result"]) {
			result = "was a " + cstr(f["result"]) + " "
		}
		return trimEnd(neg + "a " + cstr(f["roll"]) + " roll " + result + windowPhrase(p["window"]))
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
				if jsTruthy(f["weapon_name"]) {
					s += " made with " + cstr(f["weapon_name"])
				}
				return s
			}
			return neg + "destroyed by any attack"
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
		if f["by"] != nil {
			when := windowPhrase(p["window"])
			if p["window"] == "event" {
				when = "with its just-resolved attacks"
			}
			return trimEnd(neg + unitRefPhrase(f["by"], "the unit") + " has destroyed " + nStr + "+ " + owner + kws + noun + "s " + when)
		}
		tagged := ""
		if obj["designated"] != nil {
			tagged = " " + designationPhrase(cstr(obj["designated"]))
		}
		return neg + withWindow(nStr+"+ "+owner+kws+noun+"s"+tagged+" destroyed", p["window"])
	case "used":
		if f["kind"] == "action" {
			s := neg + nStr + "+ actions completed"
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
		what := "a "
		if f["id"] != nil {
			what = "the " + titleCase(cstr(f["id"])) + " "
		}
		kind := f["kind"]
		if kind == nil {
			kind = "ability"
		}
		return neg + withWindow(who+" used "+what+dekebab(cstr(kind)), p["window"])
	case "objective-gained":
		return trimEnd(neg + "you newly control " + nStr + "+ objectives " + windowPhrase(p["window"]))
	case "designation-changed":
		return neg + withWindow(nStr+"+ "+unitRefPhrase(p["object"], "units")+" became "+designationPhrase(cstr(f["tag"])), p["window"])
	}
	return neg + withWindow(dekebab(event)+" happened", p["window"])
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
