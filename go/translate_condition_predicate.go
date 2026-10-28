package wh40kdc

import (
	"regexp"
	"strconv"
	"strings"
)

// Condition predicates as phrases. Part of the condition describer; mirror of
// tools/src/translate/condition.ts.

func keywordList(p map[string]any) string {
	if p["chosen_by"] != nil {
		return "the keyword selected for " + titleCase(cstr(p["chosen_by"]))
	}
	if isList(p["any_of"]) {
		return keywordNoun(cstrList(p["any_of"]), true)
	}
	return keywordNoun(cstrList(p["all_of"]), false)
}

// keywordNoun names keywords as the rules do: "the X keyword", "the X and Y keywords", "the X or Y keyword".
func keywordNoun(words []string, anyOf bool) string {
	if anyOf || len(words) == 1 {
		return "the " + orList(words) + " keyword"
	}
	return "the " + andList(words) + " keywords"
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
	"strength": true, "model-count": true, "wounds": true, "loadout": true, "equipped-weapon-count": true, "attachment": true, "has-ability": true,
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

// describeMatches renders the canonical ordinary unit predicate. Negation is
// applied to the complete filter, not to each filter field independently.
func describeMatches(p map[string]any, negated bool) string {
	f := mapOr(p["filter"])
	who := subjectOf(p, "the unit")
	if p["subject"] == "defender" {
		who = "the target"
	}
	keys := 0
	for key := range f {
		if key != "level" {
			keys++
		}
	}
	no := ""
	if negated {
		no = "not "
	}
	if keys == 1 {
		if f["all_of"] != nil || f["any_of"] != nil {
			verb := "has"
			if negated {
				verb = "does not have"
			}
			all := ""
			if negated {
				if values, ok := asList(f["all_of"]); ok && len(values) > 1 {
					all = "all of "
				}
			}
			return who + " " + verb + " " + all + keywordList(f)
		}
		if values, ok := asList(f["none_of"]); ok {
			verb := "does not have"
			if negated {
				verb = "has"
			}
			return who + " " + verb + " " + keywordNoun(cstrList(values), true)
		}
		if values, ok := asList(f["not_all_of"]); ok {
			verb := "does not have"
			if negated {
				verb = "has"
			}
			return who + " " + verb + " all of " + keywordNoun(cstrList(values), false)
		}
		if f["owner"] != nil {
			owner := "a unit of either player"
			if f["owner"] == "enemy" {
				owner = "an enemy unit"
			} else if f["owner"] == "friendly" {
				owner = "friendly"
			}
			return subjectOf(p, "the unit") + " is " + no + owner
		}
		if f["state"] != nil {
			if f["state"] == "fights-first" {
				verb := "has"
				if negated {
					verb = "does not have"
				}
				return who + " " + verb + " Fights First"
			}
			return who + " is " + statePhrase(cstr(f["state"]), negated)
		}
		if values, ok := asList(f["not_states"]); ok {
			if len(values) == 1 {
				return who + " is " + statePhrase(cstr(values[0]), !negated)
			}
			parts := make([]string, len(values))
			for i, value := range values {
				parts[i] = who + " is " + statePhrase(cstr(value), true)
			}
			prefix, suffix := "", ""
			if negated {
				prefix, suffix = "not (", ")"
			}
			return prefix + andList(parts) + suffix
		}
		if values, ok := asList(f["has_ability"]); ok {
			verb := "has"
			if negated {
				verb = "does not have"
			}
			return who + " " + verb + " the " + andList(idLabelList(values)) + " ability"
		}
		if values, ok := asList(f["lacks_ability"]); ok {
			verb := "does not have"
			if negated {
				verb = "has"
			}
			return who + " " + verb + " the " + orList(idLabelList(values)) + " ability"
		}
		if f["designated"] != nil || f["not_designated"] != nil {
			tag := f["designated"]
			if tag == nil {
				tag = f["not_designated"]
			}
			notTag := f["not_designated"] != nil
			if notTag != negated {
				no = "not "
			} else {
				no = ""
			}
			return who + " is " + no + designationPhrase(cstr(tag), false)
		}
		if visible, ok := asMap(f["visible"]); ok && visible != nil {
			to := unitRefPhrase(visible["to"], "the unit")
			if visible["to"] == "attacker" {
				to = "the attacking model"
			}
			return who + " is " + no + "visible to " + to
		}
		if within, ok := asMap(f["within"]); ok && within != nil {
			to := ""
			if within["range"] != "weapon" && within["range"] != "half-weapon" {
				to = " of " + placeRefPhrase(within["of"])
			}
			whole := ""
			if within["wholly"] == true {
				whole = "wholly "
			}
			return who + " is " + no + whole + "within " + rangePhrase(within["range"]) + to
		}
	}
	return who + " is " + no + unitFilterPhrase(f)
}

// controlCountPhrase renders a `{min, max}` count bound ("3+", "exactly 2",
// "at most 1"); an absent bound reads "1+". Mirror of countPhrase in
// tools/src/translate/condition-refs.ts.
func controlCountPhrase(value any) string {
	bounds, _ := asMap(value)
	if bounds == nil {
		return "1+"
	}
	min, max := bounds["min"], bounds["max"]
	if min != nil && max != nil {
		if cstr(min) == cstr(max) {
			return "exactly " + diceCase(min)
		}
		if _, minNumber := parseNumber(min); minNumber {
			if _, maxNumber := parseNumber(max); maxNumber {
				return cstr(min) + "-" + cstr(max)
			}
		}
		return "between " + diceCase(min) + " and " + diceCase(max)
	}
	if max != nil {
		return "at most " + diceCase(max)
	}
	if min != nil {
		if _, number := parseNumber(min); number {
			return cstr(min) + "+"
		}
		return "at least " + diceCase(min)
	}
	return "1+"
}

func controlComparisonPhrase(comparison string) string {
	switch comparison {
	case "gt":
		return "more than"
	case "gte":
		return "at least"
	case "eq":
		return "equal to"
	case "neq":
		return "not equal to"
	case "lt":
		return "less than"
	case "lte":
		return "at most"
	default:
		return dekebab(comparison)
	}
}

// describePredicate renders the predicate phrase, optionally negated ("the unit
// is not below starting strength").
func describePredicate(c map[string]any, negated bool) string {
	p := paramsOf(c)
	// Compound controls clauses need negation around the complete predicate;
	// negating each clause independently changes the meaning of an AND.
	if negated && c["type"] == "controls" {
		clauses := 0
		for _, key := range []string{"count", "compare", "proportion"} {
			if p[key] != nil {
				clauses++
			}
		}
		if clauses > 1 {
			return "not (" + describePredicate(c, false) + ")"
		}
	}
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
	case "matches":
		return describeMatches(p, negated)
	case "army-state":
		who := "your"
		if p["owner"] == "enemy" {
			who = "your opponent's"
		}
		return who + " army is " + neg + cstr(p["state"])
	case "oath-state":
		return "the " + idLabel(p["ability"]) + " oath is " + neg + cstr(p["state"])
	case "deployment-window":
		return neg + "during deployment"
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
		return "the " + ruleRefPhrase(p["rule"]) + " is " + neg + "active"
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
		return neg + subjectOf(p, "the unit") + " has the " + idLabel(p["ability"]) + " ability"
	case "attachment":
		w := mapOr(p["with"])
		hasNonKeyword := false
		for key := range w {
			if key != "all_of" {
				hasNonKeyword = true
				break
			}
		}
		if hasNonKeyword {
			who := subjectOf(p, "the unit")
			if p["subject"] == "this-model" || p["subject"] == nil {
				who = "the model"
			}
			if p["role"] == "leading" {
				return neg + who + " is leading " + unitFilterPhrase(w)
			}
			if p["role"] == "led" {
				w2 := cloneMap(w)
				w2["level"] = "model"
				return neg + subjectOf(p, "this unit") + " is being led by " + unitFilterPhrase(w2)
			}
			return neg + subjectOf(p, "the unit") + " is attached to " + unitFilterPhrase(w)
		}
		kw := ""
		if isList(w["all_of"]) {
			kw = strings.Join(cstrList(w["all_of"]), " ") + " "
		}
		who := subjectOf(p, "the unit")
		if p["subject"] == "this-model" || p["subject"] == nil {
			who = "the model"
		}
		switch p["role"] {
		case "leading":
			return neg + who + " is leading a " + kw + "unit"
		case "led":
			return neg + subjectOf(p, "this unit") + " is being led by " + article(kw) + " " + kw + "model"
		}
		if kw != "" {
			return neg + subjectOf(p, "the unit") + " is attached to " + article(kw) + " " + kw + "unit"
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
		if _, rated := p["remaining_max"].(map[string]any); rated {
			parts = append(parts, "has X or fewer wounds remaining, X being its rating")
		} else if p["remaining_max"] != nil {
			_, s := jsNumberStr(p["remaining_max"])
			parts = append(parts, "has "+s+" or fewer wounds remaining")
		}
		if p["damaged"] == true {
			parts = append(parts, "is Damaged")
		}
		return neg + who + " " + andList(parts)
	case "named-weapon", "unit-wargear":
		return namedEquipmentPhrase(cstr(c["type"]), p, negated)
	case "equipped-weapon-count":
		bounds := mapOr(p["count"])
		scope := weaponNoun(map[string]any{"weapons": p["weapons"]})
		if jsNumber(bounds["min"]) == 1 && jsNumber(bounds["max"]) == 1 {
			scope = strings.Replace(scope, "weapons", "weapon", 1)
		}
		return subjectOf(p, "the model") + " is " + neg + "equipped with " + controlCountPhrase(bounds) + " " + scope
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
		if p["to"] == "embark-within" {
			// The candidate being checked (this-unit) reads "that Transport".
			transport := "that Transport"
			if p["transport"] != "this-unit" {
				transport = unitRefPhrase(p["transport"], "that Transport")
			}
			return subjectOf(p, "the unit") + " is " + neg + "able to embark within " + transport
		}
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
		ge := p["comparison"] == "gte"
		if right["pool"] != nil && ge {
			return neg + "you destroyed at least as many " + destroyedCount(left) + " as your " + dekebab(cstr(right["pool"]))
		}
		if right["value"] != nil {
			return neg + "you destroyed " + controlComparisonPhrase(cstr(p["comparison"])) + " " + cstr(right["value"]) + " " + destroyedCount(left)
		}
		if p["comparison"] == "gt" || ge {
			more, than := "more", "than"
			if ge {
				more, than = "at least as many", "as"
			}
			return neg + "you destroyed " + more + " " + destroyedCount(left) + " " + than + " " + destroyedCount(right)
		}
		rightPhrase := "the number of " + destroyedCount(right) + " you destroyed"
		if right["pool"] != nil {
			rightPhrase = "your " + dekebab(cstr(right["pool"]))
		}
		return neg + "the number of " + destroyedCount(left) + " you destroyed is " + controlComparisonPhrase(cstr(p["comparison"])) + " " + rightPhrase
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
		to := ""
		if p["to"] != nil && p["to"] != "attacker" {
			ref := "the target"
			if p["to"] != "defender" {
				ref = unitRefPhrase(p["to"], "the unit")
			}
			to = " to " + ref
		}
		return neg + who + " is the closest " + among + to + within
	case "controls":
		who := "you control"
		holder := "you hold"
		if p["by"] == "enemy" {
			who = "your opponent controls"
			holder = "your opponent holds"
		}
		objective := objectivePhrase(mapOr(p["objective"]), true, "objective")
		var clauses []string
		if p["count"] != nil || (p["compare"] == nil && p["proportion"] == nil) {
			clauses = append(clauses, who+" "+controlCountPhrase(p["count"])+" "+objective)
		}
		if compare, ok := asMap(p["compare"]); ok && compare != nil {
			other := "the opponent"
			if compare["owner"] == "friendly" {
				other = "you"
			}
			if compare["comparison"] == "gt" {
				clauses = append(clauses, holder+" more "+objective+" than "+other)
			} else {
				left := "the number of " + objective + " " + who
				right := "the number " + map[bool]string{true: "you control", false: "the opponent controls"}[compare["owner"] == "friendly"]
				clauses = append(clauses, left+" is "+controlComparisonPhrase(cstr(compare["comparison"]))+" "+right)
			}
		}
		if proportion, ok := asMap(p["proportion"]); ok && proportion != nil {
			fraction := cstr(proportion["fraction"])
			if fraction == "0.5" {
				fraction = "half"
			} else if n, ok := parseNumber(proportion["fraction"]); ok {
				fraction = numStr(n*100) + "%"
			}
			clauses = append(clauses, who+" "+controlComparisonPhrase(cstr(proportion["comparison"]))+" "+fraction+" of the "+objective)
		}
		return neg + strings.Join(clauses, " and ")
	case "attack-is":
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
		if p["all_target_same_unit"] == true {
			weapon := ""
			if p["weapons"] != nil {
				weapon = " made with " + weaponNoun(map[string]any{"weapons": p["weapons"]})
			}
			if kind != "" {
				kind += " "
			}
			return neg + "all of the unit's " + kind + "attacks" + weapon + " target the same enemy unit"
		}
		if kind != "" {
			kind += " "
		}
		parts := []string{"for " + kind + "attacks"}
		if scope, ok := asMap(p["weapons"]); ok && scope != nil {
			onlyNameKeyword := true
			for key := range scope {
				if key != "keyword" && key != "name" {
					onlyNameKeyword = false
				}
			}
			if _, list := asList(scope["keyword"]); list {
				onlyNameKeyword = false
			}
			if onlyNameKeyword {
				if scope["keyword"] != nil {
					parts = append(parts, "made with "+bracketKeyword(scope["keyword"])+" weapons")
				}
				if scope["name"] != nil {
					parts = append(parts, "made with "+cstr(scope["name"]))
				}
			} else {
				parts = append(parts, "made with "+weaponNoun(map[string]any{"weapons": scope}))
			}
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
		return neg + side(mapOr(p["left"])) + " is " + controlComparisonPhrase(cstr(p["comparison"])) + " " + side(mapOr(p["right"]))
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
			return neg + controlCountPhrase(p["count"]) + " " + objectivePhrase(mapOr(s["objective"]), true, "objective") + " tagged " + dekebab(cstr(p["tag"]))
		}
		if p["count"] != nil {
			ref := unitRefPhrase(p["subject"], "the unit")
			ref = leadingArticleRe.ReplaceAllString(ref, "")
			ref = strings.Replace(ref, "unit", "units", 1)
			ref = strings.Replace(ref, "model", "models", 1)
			by := ""
			if p["by"] != nil {
				by = " by " + unitRefPhrase(p["by"], "the unit")
			}
			return neg + controlCountPhrase(p["count"]) + " " + ref + " " + designationPhrase(cstr(p["tag"]), false) + by
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
		return neg + "the unit has " + controlCountPhrase(p["count"]) + " " + dekebab(cstr(p["pool"]))
	// -- Mission-card predicates --
	case "operation-markers":
		side := ""
		if p["side"] != nil {
			side = cstr(p["side"]) + " "
		}
		count := mapOr(p["count"])
		minV, hasMin := num(count["min"])
		maxV, hasMax := num(count["max"])
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
			s = controlCountPhrase(p["count"]) + " " + side + "operation markers on the battlefield"
		}
		if within, ok := asMap(p["within"]); ok && within != nil {
			s += " within " + rangePhrase(within["range"]) + " of " + placeRefPhrase(within["of"])
		}
		if jsTruthy(p["friendly_unit_in_same_terrain_area"]) {
			s += " with a friendly unit in the same terrain area"
		}
		if jsTruthy(p["no_enemy_in_terrain_area"]) {
			s += " and no enemy units in that terrain area"
		}
		return neg + s
	case "engagement-fronts":
		return neg + "you are engaged on " + controlCountPhrase(p["count"]) + " fronts"
	case "destroyed-while-on-objective":
		obj := "an objective"
		if jsTruthy(p["objective_role"]) {
			obj = "a " + dekebab(cstr(p["objective_role"])) + " objective"
		}
		s := neg + controlCountPhrase(p["count"]) + " enemy units destroyed"
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
		return neg + controlCountPhrase(p["count"]) + " enemy units destroyed " + where + " " + terrain
	case "battle-size":
		return "the battle size is " + neg + titleCase(cstr(p["size"]))
	case "army-faction":
		return "your Army Faction is " + neg + strings.ToUpper(strings.ReplaceAll(cstr(p["faction"]), "-", " "))
	case "army-includes":
		return armyIncludesPhrase(p, neg != "")
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
	rng := p["range"]
	wholly := ""
	if p["wholly"] == true {
		wholly = "wholly "
	}
	every := p["models"] == "every"
	who := subjectOf(p, "the unit")
	if every {
		who = "every model in " + who
		if p["count"] != nil {
			who += " (" + controlCountPhrase(p["count"]) + " models)"
		}
	} else if p["count"] != nil {
		who = controlCountPhrase(p["count"]) + " models in " + who
	}
	plural := !every && p["count"] != nil
	target := ""
	if rng != "half-weapon" && rng != "weapon" {
		target = " of " + placeRefPhrase(p["of"])
	}
	is, at := "is", ""
	if plural {
		is = "are"
	}
	if p["at"] == "phase-start" {
		is, at = "was", " at the start of the phase"
		if plural {
			is = "were"
		}
	}
	return who + " " + is + " " + neg + wholly + "within " + rangePhrase(rng) + target + at
}

// conditionOperands returns (operands, true) when c carries an operator and an
// operands array (`c.operator === op && c.operands`).

var firstUnitOrModelRe = regexp.MustCompile(`\b(unit|model)\b`)

// armyIncludesPhrase renders "your army includes a CHARACTER unit", "your army
// includes 2 or more X units", "every model in your army has the IMPERIUM
// keyword". The army is yours, so the filter's owner is not repeated.
func armyIncludesPhrase(p map[string]any, negated bool) string {
	src, _ := p["filter"].(map[string]any)
	f := make(map[string]any, len(src))
	for k, v := range src {
		if k != "owner" {
			f[k] = v
		}
	}
	noun := "unit"
	if f["level"] == "model" {
		noun = "model"
	}
	if p["every"] == true {
		all := cstrList(f["all_of"])
		anyOf := cstrList(f["any_of"])
		words := andList(all)
		if len(anyOf) > 0 {
			words = orList(anyOf)
		}
		plural := ""
		if len(all) > 1 && len(anyOf) == 0 {
			plural = "s"
		}
		not := ""
		if negated {
			not = "not "
		}
		return not + "every " + noun + " in your army has the " + words + " keyword" + plural
	}
	one := unitFilterPhrase(f)
	what := one
	if min, ok := p["min"].(float64); ok && min > 1 {
		bare := one
		if strings.HasPrefix(one, "an ") {
			bare = strings.TrimPrefix(one, "an ")
		} else if strings.HasPrefix(one, "a ") {
			bare = strings.TrimPrefix(one, "a ")
		}
		loc := firstUnitOrModelRe.FindStringIndex(bare)
		if loc != nil {
			bare = bare[:loc[1]] + "s" + bare[loc[1]:]
		}
		what = strconv.Itoa(int(min)) + " or more " + bare
	}
	if negated {
		return "your army does not include " + what
	}
	return "your army includes " + what
}
