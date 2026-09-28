package wh40kdc

import (
	"regexp"
	"strings"
)

// Conditions as sentence lead-ins ("while ...", "if ...", "against ...").
// Part of the condition describer; mirror of tools/src/translate/condition.ts.

// -- Lead-ins -----------------------------------------------------------------

// negatedTargetKeywords renders "against a unit that is not a X or Y": the
// attack's target lacks every listed keyword.
func negatedTargetKeywords(keywords []string) string {
	return "against a unit that is not a " + strings.Join(keywords, " or ")
}

func keywordNames(p map[string]any) string {
	if isList(p["any_of"]) {
		return orList(cstrList(p["any_of"]))
	}
	return andList(cstrList(p["all_of"]))
}

var (
	leadingIfRe          = regexp.MustCompile(`^if `)
	battleRoundOnwardRe  = regexp.MustCompile(`^during the (\w+) battle round onward$`)
	belowStartingRe      = regexp.MustCompile(` is below starting strength$`)
	leadingForRe         = regexp.MustCompile(`^for `)
	negatedLeadInWordsRe = regexp.MustCompile(`^(if|while|when|during|in|against) `)
)

// conditionLeadIn renders a condition as a natural lead-in clause
// (lowercase-initial; the caller capitalizes at the sentence boundary). Falls
// back to `if <condition>` for shapes without a dedicated framing.
func conditionLeadIn(c map[string]any) string {
	if c == nil {
		c = map[string]any{}
	}
	if ops, ok := conditionOperands(c, "and"); ok {
		return joinLeadIns(ops)
	}
	if ops, ok := conditionOperands(c, "or"); ok {
		parts := make([]string, len(ops))
		for i, o := range ops {
			parts[i] = conditionLeadIn(o)
		}
		return strings.Join(parts, " or ")
	}
	if ops, ok := conditionOperands(c, "not"); ok {
		if len(ops) == 1 && !jsTruthy(ops[0]["operator"]) {
			return negatedLeadIn(ops[0])
		}
		parts := make([]string, len(ops))
		for i, o := range ops {
			parts[i] = leadingIfRe.ReplaceAllString(conditionLeadIn(o), "")
		}
		return "unless " + strings.Join(parts, " or ")
	}
	p := paramsOf(c)
	switch c["type"] {
	case "phase-is":
		if cstr(p["phase"]) == "command" {
			return "during the Command phase"
		}
		return "during the " + titleCase(cstr(p["phase"])) + " phase"
	case "player-turn-is", "battle-round":
		return battleRoundOnwardRe.ReplaceAllString(describePredicate(c, false), "from the $1 battle round onward")
	case "rule-active":
		return "while the " + titleCase(cstr(p["rule"])) + " is active"
	case "has-keyword":
		if p["chosen_by"] != nil {
			return "if " + describePredicate(c, false)
		}
		if p["subject"] == "defender" {
			return "against " + keywordNames(p) + " targets"
		}
		if p["subject"] == nil {
			plural := ""
			if isList(p["any_of"]) || len(cstrList(p["all_of"])) > 1 {
				plural = "s"
			}
			return "if the unit has the " + keywordNames(p) + " keyword" + plural
		}
		return "if " + describePredicate(c, false)
	case "attachment":
		if p["role"] == "leading" && (p["subject"] == "this-model" || p["subject"] == nil) {
			w := mapOr(p["with"])
			kw := ""
			if isList(w["all_of"]) {
				kw = strings.Join(cstrList(w["all_of"]), " ") + " "
			}
			return "while this model is leading a " + kw + "unit"
		}
		return "while " + describePredicate(c, false)
	case "happened":
		f := mapOr(p["filter"])
		types := cstrList(f["move_types"])
		if p["event"] == "move-ended" && p["window"] == "turn" && len(types) == 1 && p["subject"] == nil {
			switch types[0] {
			case "charge":
				return "if the unit charged this turn"
			case "advance":
				return "if the unit Advanced this turn"
			case "remain-stationary":
				return "if the unit Remained Stationary this turn"
			}
		}
		if p["event"] == "disembarked" && p["subject"] == nil {
			return trimEnd("if the unit disembarked from a Transport " + windowPhrase(p["window"]))
		}
		if (p["event"] == "destroyed" || p["event"] == "model-destroyed") && p["object"] == "event-object" && p["window"] == "event" {
			return "when " + describeHappened(p, false)
		}
		return "if " + describeHappened(p, false)
	case "resource":
		if p["below_max"] == true {
			return "if " + describePredicate(c, false)
		}
		return "while " + describePredicate(c, false)
	case "strength":
		return "while " + belowStartingRe.ReplaceAllString(describePredicate(c, false), " is below its starting strength")
	case "designated":
		if p["subject"] == "defender" && cstr(p["tag"]) == strings.ToUpper(cstr(p["tag"])) {
			return "against " + cstr(p["tag"]) + " targets"
		}
		return "while " + describePredicate(c, false)
	case "unit-state", "wounds", "owned-by":
		return "while " + describePredicate(c, false)
	case "attack-is":
		if p["all_target_same_unit"] == true {
			return "when " + describePredicate(c, false)
		}
		return leadingForRe.ReplaceAllString(describePredicate(c, false), "while making ")
	case "attack-compare":
		return "when " + describePredicate(c, false)
	case "model-count", "loadout":
		return "if " + describePredicate(c, false)
	case "within", "in-region":
		return "while " + describePredicate(c, false)
	}
	return "if " + describePredicate(c, false)
}

func negatedLeadIn(c map[string]any) string {
	p := paramsOf(c)
	switch {
	case c["type"] == "same-unit":
		return "if " + describePredicate(c, true)
	case c["type"] == "has-keyword" && p["chosen_by"] == nil && p["subject"] == "defender":
		if isList(p["any_of"]) {
			return negatedTargetKeywords(cstrList(p["any_of"]))
		}
		return negatedTargetKeywords(cstrList(p["all_of"]))
	case c["type"] == "has-keyword" && p["chosen_by"] == nil && (p["subject"] == nil || p["subject"] == "recipient"):
		return "unless the unit has the " + keywordNames(p) + " keyword"
	case c["type"] == "unit-state" || c["type"] == "designated" || c["type"] == "owned-by":
		return "while " + describePredicate(c, true)
	}
	// Otherwise the positive lead-in, turned: "unless an enemy unit is within 12\"".
	lead := conditionLeadIn(c)
	if m := negatedLeadInWordsRe.FindStringSubmatch(lead); m != nil {
		if m[1] != "during" && m[1] != "in" && m[1] != "against" {
			lead = lead[len(m[0]):]
		}
	}
	return "unless " + lead
}

// notKeyword returns the keyword of `not(has-keyword <subject> X)` with a single keyword.
func notKeyword(op map[string]any, subject string) (string, bool) {
	ops, ok := conditionOperands(op, "not")
	if !ok || len(ops) != 1 {
		return "", false
	}
	inner := ops[0]
	p := paramsOf(inner)
	all, isL := asList(p["all_of"])
	if inner["type"] != "has-keyword" || p["subject"] != subject || !isL || len(all) != 1 {
		return "", false
	}
	return cstr(all[0]), true
}

// ownKeyword returns a bare single-keyword `has-keyword` on the ability's own unit.
func ownKeyword(op map[string]any) (string, bool) {
	p := paramsOf(op)
	all, isL := asList(p["all_of"])
	if op["type"] != "has-keyword" || p["subject"] != nil || !isL || len(all) != 1 {
		return "", false
	}
	return cstr(all[0]), true
}

// joinLeadIns joins the operands of an `and` lead-in. Runs of keyword
// exclusions collapse into one clause: on the attack's target, "against a unit
// that is not a X or Y"; on the unit an aura or effect is applied to,
// "(excluding X or Y units)". Either attaches to the preceding clause with a
// space; a run of the unit's own keywords reads "if the unit is a X Y unit";
// all other operands join with ", ".
func joinLeadIns(operands []map[string]any) string {
	var parts []string
	run := func(i int, pick func(map[string]any) (string, bool)) ([]string, int) {
		var kws []string
		for i < len(operands) {
			kw, ok := pick(operands[i])
			if !ok {
				break
			}
			kws = append(kws, kw)
			i++
		}
		return kws, i
	}
	notDefender := func(o map[string]any) (string, bool) { return notKeyword(o, "defender") }
	notRecipient := func(o map[string]any) (string, bool) { return notKeyword(o, "recipient") }
	for i := 0; i < len(operands); {
		op := operands[i]
		if _, ok := notDefender(op); ok {
			kws, next := run(i, notDefender)
			parts = append(parts, negatedTargetKeywords(kws))
			i = next
			continue
		}
		if _, ok := notRecipient(op); ok {
			kws, next := run(i, notRecipient)
			capped := make([]string, len(kws))
			for j, k := range kws {
				capped[j] = capWord(k)
			}
			parts = append(parts, "(excluding "+strings.Join(capped, " or ")+" units)")
			i = next
			continue
		}
		if _, ok := ownKeyword(op); ok {
			kws, next := run(i, ownKeyword)
			if len(kws) >= 2 {
				parts = append(parts, "if the unit is "+article(kws[0])+" "+strings.Join(kws, " ")+" unit")
			} else {
				parts = append(parts, "if the unit has the "+kws[0]+" keyword")
			}
			i = next
			continue
		}
		parts = append(parts, conditionLeadIn(op))
		i++
	}
	acc := ""
	for _, part := range parts {
		switch {
		case acc == "":
			acc = part
		case againstTargetsRe.MatchString(part) && strings.HasSuffix(acc, " targets") && againstClauseRe.MatchString(acc):
			// A second keyword gate on the same target narrows it: "against ORKS targets that are also VEHICLE".
			acc += " that are also " + againstTargetsRe.FindStringSubmatch(part)[1]
		case strings.HasPrefix(part, "against ") || strings.HasPrefix(part, "(excluding "):
			acc += " " + part
		default:
			acc += ", " + part
		}
	}
	return acc
}

var againstTargetsRe = regexp.MustCompile(`^against (.+) targets$`)
var againstClauseRe = regexp.MustCompile(`(^|, )against `)
