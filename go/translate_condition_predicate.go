package wh40kdc

import (
	"regexp"
	"strings"
)

// Condition predicates as phrases. Part of the condition describer; mirror of
// tools/src/translate/condition.ts.

func quotedList(v any) []string {
	items := cstrList(v)
	for i, k := range items {
		items[i] = "\"" + k + "\""
	}
	return items
}

func keywordList(p map[string]any) string {
	if p["chosen_by"] != nil {
		return "the keyword selected for " + titleCase(cstr(p["chosen_by"]))
	}
	if isList(p["any_of"]) {
		return orList(quotedList(p["any_of"]))
	}
	return andList(quotedList(p["all_of"]))
}

var eligibleToPhrases = map[string]string{
	"shoot": "shoot", "declare-charge": "declare a charge", "fight": "fight", "start-action": "start an action",
}

func notWord(negated bool) string {
	if negated {
		return "not "
	}
	return ""
}

// verbNegated lists predicates whose phrase negates by turning its verb (see negatePhrase).
var verbNegated = map[string]bool{
	"strength": true, "model-count": true, "wounds": true, "loadout": true, "attachment": true, "has-ability": true,
	"controls": true, "resource": true, "attack-compare": true, "happened-compare": true, "operation-markers": true,
	"engagement-fronts": true, "destroyed-while-on-objective": true, "destroyed-in-tagged-terrain": true,
	"army-faction": true, "battle-size": true,
}

var negatePrefixes = [][2]string{
	{"you control ", "you do not control "}, {"you hold ", "you do not hold "}, {"you destroyed ", "you did not destroy "},
	{"you newly control ", "you do not newly control "}, {"you are ", "you are not "},
	{"your opponent controls ", "your opponent does not control "},
}

var (
	negateVerbRe    = regexp.MustCompile(`^(.*?) (is|was|contains|has) (.*)$`)
	negatePerfectRe = regexp.MustCompile(`^(\w+ed|lost|been|fought) `)
)

// negatePhrase turns a predicate phrase's verb: "X is Y" -> "X is not Y",
// "X has Y" -> "X does not have Y", "you control" -> "you do not control",
// "1+ ..." -> "no ..."; else a leading "not".
func negatePhrase(phrase string) string {
	for _, pair := range negatePrefixes {
		if rest, ok := strings.CutPrefix(phrase, pair[0]); ok {
			return pair[1] + rest
		}
	}
	if rest, ok := strings.CutPrefix(phrase, "1+ "); ok {
		return "no " + rest
	}
	if m := negateVerbRe.FindStringSubmatch(phrase); m != nil {
		who, verb, rest := m[1], m[2], m[3]
		switch verb {
		case "is", "was":
			return who + " " + verb + " not " + rest
		case "contains":
			return who + " does not contain " + rest
		}
		if negatePerfectRe.MatchString(rest) {
			return who + " has not " + rest
		}
		return who + " does not have " + rest
	}
	return "not " + phrase
}

// describePredicate renders the predicate phrase, optionally negated ("the unit
// is not below starting strength").
func describePredicate(c map[string]any, negated bool) string {
	p := paramsOf(c)
	if negated {
		if verbNegated[cstr(c["type"])] {
			return negatePhrase(describePredicate(c, false))
		}
		if c["type"] == "happened" {
			switch p["event"] {
			case "move-ended", "selected", "disembarked":
			default:
				return negatePhrase(describePredicate(c, false))
			}
		}
		if s, ok := asMap(p["subject"]); c["type"] == "designated" && ok && s != nil && jsTruthy(s["objective"]) {
			return negatePhrase(describePredicate(c, false))
		}
	}
	neg := notWord(negated)
	switch c["type"] {
	case "phase-is":
		if cstr(p["phase"]) == "command" {
			return neg + "during the Command phase"
		}
		return neg + "during the " + titleCase(cstr(p["phase"])) + " phase"
	case "player-turn-is":
		whose := "either player's"
		switch p["turn"] {
		case "your-turn":
			whose = "your"
		case "opponent-turn":
			whose = "the opponent's"
		}
		return neg + "in " + whose + " turn"
	case "battle-round":
		var where string
		minV, hasMin := 0.0, p["min"] != nil
		maxV, hasMax := 0.0, p["max"] != nil
		minS, maxS := "", ""
		if hasMin {
			minV, minS = jsNumberStr(p["min"])
		}
		if hasMax {
			maxV, maxS = jsNumberStr(p["max"])
		}
		switch {
		case hasMin && hasMax:
			if minS == maxS && minS != "NaN" && minV == maxV {
				where = "the " + ordOrNaN(minV, minS) + " battle round"
			} else {
				where = "battle rounds " + minS + "-" + maxS
			}
		case hasMin:
			where = "the " + ordOrNaN(minV, minS) + " battle round onward"
		case hasMax:
			where = "the first " + maxS + " battle rounds"
		default:
			where = "the battle round"
		}
		return neg + "during " + where
	case "rule-active":
		return "the " + titleCase(cstr(p["rule"])) + " is " + neg + "active"
	case "has-keyword":
		who := subjectOf(p, "the unit")
		if p["subject"] == "defender" {
			who = "the target"
		}
		verb := "has"
		if negated {
			verb = "does not have"
		}
		return who + " " + verb + " " + keywordList(p)
	case "owned-by":
		side := "friendly"
		if p["owner"] == "enemy" {
			side = "an enemy unit"
		}
		return subjectOf(p, "the unit") + " is " + neg + side
	case "same-unit":
		as := unitRefPhrase(p["as"], "the unit")
		if p["as"] == "this-unit" {
			as = "this unit"
		}
		return subjectOf(p, "the unit") + " is " + neg + "the same unit as " + as
	case "model-profile":
		return subjectOf(p, "the model") + " is " + neg + "the " + titleCase(cstr(p["profile"])) + " model"
	case "has-ability":
		return neg + subjectOf(p, "the unit") + " has the " + titleCase(cstr(p["ability"])) + " ability"
	case "attachment":
		w := mapOr(p["with"])
		kw := ""
		if isList(w["all_of"]) {
			kw = strings.Join(cstrList(w["all_of"]), " ") + " "
		}
		switch p["role"] {
		case "leading":
			who := subjectOf(p, "the unit")
			if p["subject"] == "this-model" || p["subject"] == nil {
				who = "the model"
			}
			return neg + who + " is leading a " + kw + "unit"
		case "led":
			return neg + subjectOf(p, "this unit") + " is being led by " + article(kw) + " " + kw + "model"
		}
		return neg + subjectOf(p, "the unit") + " is an attached unit"
	case "strength":
		below := "starting strength"
		if p["below"] == "half" {
			below = "half strength"
		}
		return neg + subjectOf(p, "the unit") + " is below " + below
	case "model-count":
		kw := ""
		if p["keyword"] != nil {
			kw = cstr(p["keyword"]) + " "
		}
		var rng string
		switch {
		case p["min"] != nil && p["max"] != nil:
			rng = cstr(p["min"]) + "-" + cstr(p["max"])
		case p["min"] != nil:
			rng = cstr(p["min"]) + "+"
		default:
			rng = "at most " + cstr(p["max"])
		}
		return neg + subjectOf(p, "the unit") + " contains " + rng + " " + kw + "models"
	case "wounds":
		who := subjectOf(p, "the unit")
		if p["subject"] == "this-model" || p["subject"] == nil {
			who = "the model"
		}
		var parts []string
		if p["lost"] == true {
			parts = append(parts, "has lost wounds")
		}
		if p["remaining_max"] != nil {
			_, s := jsNumberStr(p["remaining_max"])
			parts = append(parts, "has "+s+" or fewer wounds remaining")
		}
		if p["damaged"] == true {
			parts = append(parts, "is Damaged")
		}
		return neg + who + " " + andList(parts)
	case "loadout":
		kw := ""
		if jsTruthy(p["model_keyword"]) {
			kw = cstr(p["model_keyword"]) + " "
		}
		return neg + "all " + cstr(p["uniform"]) + " weapons equipped by each " + kw + "model in the unit are the same"
	case "unit-state":
		who := subjectOf(p, "the unit")
		withRef := ""
		if p["with"] != nil {
			withRef = " with " + unitRefPhrase(p["with"], "the unit")
		}
		if p["at"] == "phase-start" || p["at"] == "turn-start" {
			was := "was"
			if negated {
				was = "was not"
			}
			span := "turn"
			if p["at"] == "phase-start" {
				span = "phase"
			}
			return who + " " + was + " " + statePhrase(cstr(p["state"]), false) + withRef + " at the start of the " + span
		}
		if p["state"] == "fights-first" {
			return neg + who + " has Fights First"
		}
		return who + " is " + statePhrase(cstr(p["state"]), negated) + withRef
	case "eligible":
		if p["to"] == "be-selected" {
			source := mapOr(p["source_ability"])["ability_id"]
			return neg + "the candidate was eligible for the " + dekebab(cstr(source)) + " ability at the end of the opponent's previous turn"
		}
		to, ok := eligibleToPhrases[cstr(p["to"])]
		if !ok {
			to = dekebab(cstr(p["to"]))
		}
		return subjectOf(p, "the unit") + " is " + neg + "eligible to " + to
	case "happened":
		return describeHappened(p, negated)
	case "happened-compare":
		left := mapOr(p["left"])
		right := mapOr(p["right"])
		ge := p["comparison"] == "greater-or-equal"
		if right["pool"] != nil {
			return neg + "you destroyed at least as many " + destroyedCount(left) + " as your " + dekebab(cstr(right["pool"]))
		}
		if right["value"] != nil {
			least := "more than"
			if ge {
				least = "at least"
			}
			return neg + "you destroyed " + least + " " + cstr(right["value"]) + " " + destroyedCount(left)
		}
		if ge {
			return neg + "you destroyed at least as many " + destroyedCount(left) + " as " + destroyedCount(right)
		}
		return neg + "you destroyed more " + destroyedCount(left) + " than " + destroyedCount(right)
	case "within":
		return describeWithin(p, neg)
	case "in-region":
		r := mapOr(p["region"])
		wholly := ""
		if p["wholly"] == true {
			wholly = "wholly "
		}
		who := subjectOf(p, "the unit")
		if p["models"] == "every" {
			who = "every model in " + who
		}
		var where string
		switch {
		case jsTruthy(r["rule_region"]):
			where = titleCase(cstr(mapOr(r["rule_region"])["region_id"]))
		case jsTruthy(r["territory"]):
			where = dekebab(cstr(r["territory"]))
		default:
			area := mapOr(r["terrain_area"])
			where = "a terrain area"
			if area["footprint"] != nil {
				where = "the " + dekebab(cstr(area["footprint"])) + " terrain area"
			}
			if area["designated"] != nil {
				where += " tagged " + dekebab(cstr(area["designated"]))
			}
		}
		return who + " is " + neg + wholly + "within " + where
	case "closest":
		who := subjectOf(p, "the unit")
		if p["subject"] == "defender" {
			who = "the target"
		}
		within := ""
		if p["range"] != nil {
			within = " within " + rangePhrase(p["range"])
		}
		among := "unit"
		if p["among"] == "eligible-targets" {
			among = "eligible target"
		} else if isObject(p["among"]) {
			among = leadingArticleRe.ReplaceAllString(unitFilterPhrase(mapOr(p["among"])), "")
		}
		return neg + who + " is the closest " + among + within
	case "controls":
		if p["compare"] == "more-than-opponent" {
			return neg + "you hold more objectives than the opponent"
		}
		who := "you control"
		if p["by"] == "enemy" {
			who = "your opponent controls"
		}
		s := neg + who + " " + countMinOr1(p) + "+ " + objectivePhrase(mapOr(p["objective"]), true, "objective")
		if p["count_max"] != nil {
			s += " (at most " + cstr(p["count_max"]) + ")"
		}
		return s
	case "attack-is":
		atk := ""
		if jsTruthy(p["attack_type"]) {
			atk = cstr(p["attack_type"]) + " "
		}
		if p["all_target_same_unit"] == true {
			return neg + "all of the unit's " + atk + "attacks target the same enemy unit"
		}
		var kinds []string
		if jsTruthy(p["shooting_type"]) {
			kinds = append(kinds, dekebab(cstr(p["shooting_type"]))+" shooting")
		}
		if jsTruthy(p["fight_type"]) {
			kinds = append(kinds, dekebab(cstr(p["fight_type"]))+" fight")
		}
		if jsTruthy(p["attack_type"]) {
			kinds = append(kinds, cstr(p["attack_type"]))
		}
		kind := strings.Join(kinds, " ")
		if kind != "" {
			kind += " "
		}
		parts := []string{"for " + kind + "attacks"}
		if jsTruthy(p["weapon_keyword"]) {
			parts = append(parts, "made with ["+strings.ToUpper(cstr(p["weapon_keyword"]))+"] weapons")
		}
		if jsTruthy(p["weapon_name"]) {
			parts = append(parts, "made with "+cstr(p["weapon_name"]))
		}
		return neg + strings.Join(parts, " ")
	case "attack-compare":
		side := func(o map[string]any) string {
			if o["value"] != nil {
				return cstr(o["value"])
			}
			whose := "the attack's"
			if o["of"] == "defender" {
				whose = "the target's"
			}
			reduce := ""
			switch o["reduce"] {
			case "max":
				reduce = "highest "
			case "min":
				reduce = "lowest "
			}
			return whose + " " + reduce + cstr(o["stat"])
		}
		return neg + side(mapOr(p["left"])) + " is " + dekebab(cstr(p["comparison"])) + " " + side(mapOr(p["right"]))
	case "roll-result":
		result := "was a " + cstr(p["result"])
		if p["result"] == "success" {
			result = "succeeded"
		}
		return neg + "the triggering " + rollWord(p["roll"]) + " roll " + result
	case "visible":
		who := subjectOf(p, "the unit")
		if p["subject"] == "defender" {
			who = "the target"
		}
		to := "the attacking model"
		if p["to"] != nil && p["to"] != "attacker" {
			to = unitRefPhrase(p["to"], "the unit")
		}
		fully := ""
		if p["fully"] == true {
			fully = "fully "
		}
		if p["blocked_by"] != nil {
			blocker := unitRefPhrase(p["blocked_by"], "this unit")
			if blocker == "the unit" {
				blocker = "this unit"
			}
			not := "not "
			if negated {
				not = ""
			}
			return who + " is " + not + fully + "visible to " + to + " because of " + blocker
		}
		return who + " is " + neg + fully + "visible to " + to
	case "designated":
		if s, ok := asMap(p["subject"]); ok && s != nil && jsTruthy(s["objective"]) {
			out := neg + countMinOr1(p) + "+ " + objectivePhrase(mapOr(s["objective"]), true, "objective") + " tagged " + dekebab(cstr(p["tag"]))
			if p["count_max"] != nil {
				out += " (at most " + cstr(p["count_max"]) + ")"
			}
			return out
		}
		by := ""
		if p["by"] != nil {
			by = unitRefPhrase(p["by"], "this unit")
			if by == "the unit" {
				by = "this unit"
			}
			by = " by " + by
		}
		return subjectOf(p, "the unit") + " is " + neg + designationPhrase(cstr(p["tag"]), false) + by
	case "resource":
		if p["below_max"] == true {
			source := mapOr(p["source_ability"])["ability_id"]
			return neg + "the " + dekebab(cstr(source)) + " ability had unused selection capacity at the end of the opponent's previous turn"
		}
		amount := "at most " + cstr(p["at_most"])
		if p["at_least"] != nil {
			amount = cstr(p["at_least"]) + "+"
		}
		return neg + "the unit has " + amount + " " + dekebab(cstr(p["pool"]))
	// -- Mission-card predicates --
	case "operation-markers":
		side := ""
		if p["side"] != nil {
			side = cstr(p["side"]) + " "
		}
		minV, hasMin := num(p["count_min"])
		maxV, hasMax := num(p["count_max"])
		var s string
		switch {
		case hasMax && maxV == 0:
			s = "no " + side + "operation markers on the battlefield"
		case hasMin && hasMax && minV == maxV:
			plural := "s"
			if minV == 1 {
				plural = ""
			}
			s = "exactly " + numStr(minV) + " " + side + "operation marker" + plural + " on the battlefield"
		default:
			n := "1"
			if hasMin {
				n = numStr(minV)
			}
			s = n + "+ " + side + "operation markers on the battlefield"
		}
		if p["within_range_of"] != nil {
			s += " within range of " + dekebab(cstr(p["within_range_of"]))
		}
		if jsTruthy(p["friendly_unit_in_same_terrain_area"]) {
			s += " with a friendly unit in the same terrain area"
		}
		if jsTruthy(p["no_enemy_in_terrain_area"]) {
			s += " and no enemy units in that terrain area"
		}
		return neg + s
	case "engagement-fronts":
		return neg + "you are engaged on " + countMinOr1(p) + "+ fronts"
	case "destroyed-while-on-objective":
		obj := "an objective"
		if jsTruthy(p["objective_role"]) {
			obj = "a " + dekebab(cstr(p["objective_role"])) + " objective"
		}
		s := neg + countMinOr1(p) + "+ enemy units destroyed"
		if jsTruthy(p["destroyer_on_objective"]) {
			s += " by a unit on " + obj
		}
		if jsTruthy(p["victim_on_objective"]) {
			s += " while on " + obj
		}
		if jsTruthy(p["victim_started_turn_on_objective"]) {
			s += " that started the turn on " + obj
		}
		return s
	case "destroyed-in-tagged-terrain":
		where := "while in"
		if jsTruthy(p["at_start_of_turn"]) {
			where = "that started the turn in"
		}
		terrain := "a terrain area"
		if p["tag"] != nil {
			terrain = dekebab(cstr(p["tag"])) + " terrain"
		}
		return neg + countMinOr1(p) + "+ enemy units destroyed " + where + " " + terrain
	case "battle-size":
		return "the battle size is " + neg + titleCase(cstr(p["size"]))
	case "army-faction":
		return "your Army Faction is " + neg + strings.ToUpper(strings.ReplaceAll(cstr(p["faction"]), "-", " "))
	case "moved-over":
		window := windowPhrase(p["window"])
		if p["window"] == nil || p["window"] == "event" {
			window = "during that move"
		}
		was := "was"
		if negated {
			was = "was not"
		}
		return subjectOf(p, "the unit") + " " + was + " moved over by " + unitRefPhrase(p["by"], "this model") + " " + window
	case "guided":
		return subjectOf(p, "the unit") + " is " + neg + designationPhrase("guided", false)
	}
	t := "unknown"
	if c["type"] != nil {
		t = cstr(c["type"])
	}
	return neg + dekebab(t)
}

// ordOrNaN is `ord(Number(v))`: ORDINAL[n] ?? `${n}th` (NaN renders "NaNth").
func ordOrNaN(n float64, s string) string {
	if s == "NaN" {
		return "NaNth"
	}
	return conditionOrd(n)
}

var leadingArticleRe = regexp.MustCompile(`^an? `)

func describeWithin(p map[string]any, neg string) string {
	of := p["of"]
	rng := p["range"]
	wholly := ""
	if p["wholly"] == true {
		wholly = "wholly "
	}
	if rng == "half-weapon" || rng == "weapon" {
		who := subjectOf(p, "the unit")
		if p["subject"] == "defender" {
			who = "the target"
		}
		return who + " is " + neg + "within " + rangePhrase(rng)
	}
	ofMap, ofIsMap := asMap(of)
	if ofIsMap && jsTruthy(ofMap["objective"]) {
		if mapOr(ofMap["objective"])["selection_var"] != nil {
			return subjectOf(p, "the unit") + " is " + neg + wholly + "within range of that objective marker"
		}
		obj := objectivePhrase(mapOr(ofMap["objective"]), false, "objective marker")
		return subjectOf(p, "the unit") + " is " + neg + wholly + "within range of " + article(obj) + " " + obj
	}
	if ofIsMap && ofMap["owner"] == "enemy" && p["subject"] == nil {
		if neg != "" {
			return "no " + leadingArticleRe.ReplaceAllString(unitFilterPhrase(ofMap), "") + " is within " + rangePhrase(rng)
		}
		return unitFilterPhrase(ofMap) + " is within " + rangePhrase(rng)
	}
	var target string
	switch {
	case of == "battlefield-edge":
		target = "a battlefield edge"
	case of == "battlefield-centre":
		target = "the centre of the battlefield"
	case ofIsMap && jsTruthy(ofMap["marker"]):
		marker := cstr(ofMap["marker"])
		target = article(marker) + " " + dekebab(marker) + " marker"
	default:
		target = unitRefPhrase(of, "the unit")
	}
	who := subjectOf(p, "the unit")
	if p["models"] == "every" {
		who = "every model in " + who
	}
	is, at := "is", ""
	if p["at"] == "phase-start" {
		is, at = "was", " at the start of the phase"
	}
	return who + " " + is + " " + neg + wholly + "within " + rangePhrase(rng) + " of " + target + at
}

// conditionOperands returns (operands, true) when c carries an operator and an
// operands array (`c.operator === op && c.operands`).
