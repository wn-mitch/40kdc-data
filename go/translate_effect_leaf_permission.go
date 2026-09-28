package wh40kdc

import (
	"regexp"
	"strings"
)

// Single effects on the permission axis: what the target is eligible to do
// and whom it can target. Mirror of the permission half of
// tools/src/translate/effect-leaf.ts.

var permissionActivities = map[string]string{
	"shoot": "shoot", "declare-charge": "declare a charge", "fight": "fight", "start-action": "start an Action", "embark": "embark",
	"disembark": "disembark", "fall-back": "Fall Back", "advance": "Advance", "use-stratagem": "be targeted with Stratagems",
	"issue-order": "issue Orders", "attempt-ritual": "attempt Rituals", "use-enhancement": "use Enhancements", "move": "move", "observe": "act as an Observer",
}
var permissionAfter = map[string]string{
	"advance": "Advanced", "fall-back": "Fell Back", "disembark": "disembarked", "normal-move": "made a Normal move",
	"charge": "made a Charge move", "remain-stationary": "Remained Stationary", "set-up": "was set up",
}
var permissionDespite = map[string]string{
	"engaged": "within Engagement Range of enemy units", "battle-shocked": "Battle-shocked", "shot-this-phase": "has already shot this phase",
	"fought-this-phase": "has already fought this phase", "disembarked-this-turn": "disembarked this turn",
	"stratagem-used-this-phase": "has already been targeted with that Stratagem this phase", "performing-action": "performing an Action",
	"advanced": "Advanced this turn", "fell-back": "Fell Back this turn",
}
var permissionIsState = map[string]bool{"engaged": true, "battle-shocked": true, "performing-action": true}
var permissionAsIf = map[string]string{
	"shooting-phase": " as if it were your Shooting phase", "fight-phase": " as if it were the Fight phase", "snap-shooting": " using the Snap Shooting rules",
}

func lookupOr(table map[string]string, key string) string {
	if v, ok := table[key]; ok {
		return v
	}
	return key
}

func permissionLeaf(m map[string]any, subj string, ctx effCtx) string {
	it := "it"
	if strings.HasPrefix(subj, "all ") || unitsWordRe.MatchString(subj) {
		it = "they"
	}
	act := lookupOr(permissionActivities, ejstr(m["activity"]))
	if m["activity"] == "use-stratagem" && m["stratagem"] != nil {
		act = "be targeted with the " + titleCase(ejstr(m["stratagem"])) + " Stratagem"
	}
	into := ""
	if m["into"] != nil {
		prep := "into"
		if m["activity"] == "shoot" {
			prep = "at"
		} else if m["activity"] == "declare-charge" {
			prep = "against"
		}
		into = " " + prep + " " + noneOf(effectSubject(m["into"], ctx))
	}
	reach := ""
	if m["reach"] != nil {
		reach = " from up to " + ejstr(m["reach"]) + "\" away"
	}
	var s string
	if m["allow"] == false {
		s = noneOf(subj) + " cannot " + act + into
	} else {
		s = subj + " " + ev(subj, "is") + " eligible to " + act + into + reach
	}
	if after, ok := asList(m["after"]); ok {
		parts := make([]string, len(after))
		for i, a := range after {
			parts[i] = lookupOr(permissionAfter, ejstr(a))
		}
		s += " in a turn in which " + it + " " + orList(parts)
	}
	if despite, ok := asList(m["despite"]); ok {
		clauses := make([]string, len(despite))
		for i, d := range despite {
			ds := ejstr(d)
			phrase := lookupOr(permissionDespite, ds)
			if permissionIsState[ds] {
				pre := "it is "
				if it == "they" {
					pre = "they are "
				}
				clauses[i] = pre + phrase
			} else if it == "they" {
				// "they has already shot" -> "they have already shot".
				clauses[i] = it + " " + replaceFirst(leadingHasRe, phrase, "have ")
			} else {
				clauses[i] = it + " " + phrase
			}
		}
		s += " even if " + orList(clauses)
	}
	if m["as_if"] != nil {
		if p, ok := permissionAsIf[ejstr(m["as_if"])]; ok {
			s += p
		} else {
			s += " as if " + ejstr(m["as_if"])
		}
	}
	if m["next"] == true {
		s += ", and must be the next unit selected to " + act
	}
	if m["counts_as_move"] != nil {
		does, counts := "does", "counts"
		if it == "they" {
			does, counts = "do", "count"
		}
		s += "; if " + it + " " + does + ", " + it + " " + counts + " as having made " + movedPhrase(m["counts_as_move"]) + " this turn"
	}
	if m["consumes_shared_use"] == false {
		s += "; this use does not count toward that Stratagem's once-per-phase limit for other units"
	}
	return s
}

var targetKinds = map[string]string{
	"attack": " with attacks", "shoot": " with ranged attacks", "fight": " with melee attacks", "charge": " with a charge",
	"stratagem": " with Stratagems", "ability": " with abilities",
}

func targetingLeaf(m map[string]any, subj string, ctx effCtx) string {
	who := "units"
	if m["by"] != nil {
		who = effectSubject(m["by"], ctx)
	} else if m["target"] != nil {
		who = subj
	}
	who = leadingAllRe.ReplaceAllString(who, "")
	_, byObject := asMap(m["by"])
	attacking := who
	if byObject || who == "units" || isPlural(who) {
		attacking = "the attacking unit"
		if modelsWordRe.MatchString(who) {
			attacking = "the attacking model"
		}
	}
	whom := subj
	if m["target"] == "every-eligible" {
		whom = "every eligible target"
	} else if m["target"] != nil {
		whom = effectSubject(m["target"], ctx)
	}
	verb := "can target"
	switch m["may"] {
	case "cannot-target":
		verb = "cannot target"
	case "must-target":
		verb = "must target"
	}
	kind := targetKinds[ejstr(m["kind"])]
	if m["kind"] == "stratagem" && m["stratagem"] != nil {
		kind = " with the " + titleCase(ejstr(m["stratagem"])) + " Stratagem"
	} else if hasWeapon(m) {
		kind = " with " + weaponNoun(m)
	}
	rng := ""
	if m["range"] != nil {
		if m["may"] == "cannot-target" {
			rng = " unless " + attacking + " is within " + rangePhrase(m["range"])
		} else {
			rng = " within " + rangePhrase(m["range"])
		}
	}
	unless := ""
	if m["only_if_none"] != nil {
		other := leadingAllRe.ReplaceAllString(effectSubject(m["only_if_none"], ctx), "")
		unless = ", unless there is no other eligible " + replaceFirst(unitsWordRe, other, " unit")
	}
	if m["may"] == "redirect" {
		return redirectPhrase(m, who, whom, ctx)
	}
	except := ""
	if m["except"] == "core-stratagems" {
		except = " (Core Stratagems can still target it)"
	}
	return who + " " + verb + " " + whom + kind + rng + unless + except
}

var leadingAVowelRe = regexp.MustCompile(`(?i)^a ([aeiou])`)

// redirectPhrase renders a targeting redirect: "Attacks made by the triggering
// unit that target a friendly X unit must target the unit instead".
func redirectPhrase(m map[string]any, who, whom string, ctx effCtx) string {
	to := effectSubject(m["to"], ctx)
	what := "attacks"
	switch m["kind"] {
	case "stratagem":
		what = "Stratagems"
	case "shoot":
		what = "ranged attacks"
	case "fight":
		what = "melee attacks"
	}
	// One unit is targeted at a time: "that target a friendly ANATHEMA PSYKANA unit".
	one := whom
	if strings.HasPrefix(whom, "all ") || isPlural(whom) {
		single := replaceFirst(modelsWordFirstRe, replaceFirst(unitsWordFirstRe, strings.TrimPrefix(whom, "all "), " unit"), " model")
		one = leadingAVowelRe.ReplaceAllString("a "+single, "an $1")
	}
	by := ""
	if m["by"] != nil {
		by = " made by " + who
	}
	eligible := ""
	if m["if_eligible"] == true {
		eligible = ", if " + to + " is an eligible target"
	}
	return what + by + " that target " + one + " must target " + to + " instead" + eligible
}
