package wh40kdc

import "strings"

// Humanize an Ability-DSL / scoring condition into plain English. Shared by
// the effect describer (which frames conditions as lead-ins, conditionLeadIn)
// and the scoring-card translator. ASCII-only with a fixed clause + parameter
// order, pinned byte-for-byte across the ports by the conformance corpus.
// Mirror of tools/src/translate/condition.ts.

func dekebab(s string) string { return strings.ReplaceAll(s, "-", " ") }

// cstr is the condition module's `str`: null -> "?", else JS String(v).
func cstr(v any) string {
	if v == nil {
		return "?"
	}
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return numStr(x)
	case []any:
		// JS String([a, b]) joins with "," (null elements render empty).
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = cstr(e)
			}
		}
		return strings.Join(parts, ",")
	case map[string]any:
		return "[object Object]"
	}
	return numStr(v)
}

// jsTruthy mirrors JavaScript truthiness: null/false/""/0 are falsy; every
// object and array (even empty) is truthy.
func jsTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0 && x == x
	}
	return true
}

// paramsOf returns a condition's `parameters` (an empty map when absent).
func paramsOf(c map[string]any) map[string]any {
	if p, ok := getMap(c, "parameters"); ok && p != nil {
		return p
	}
	return map[string]any{}
}

// mapOr returns v as an object, or an empty map when v is not one (`v ?? {}`).
func mapOr(v any) map[string]any {
	if m, ok := asMap(v); ok && m != nil {
		return m
	}
	return map[string]any{}
}

// cstrList maps a JSON array through cstr ("" -> nil when v is not an array).
func cstrList(v any) []string {
	l, _ := asList(v)
	out := make([]string, len(l))
	for i, e := range l {
		out[i] = cstr(e)
	}
	return out
}

// startsVowel is JS /^[aeiou]/i.test(s).
func startsVowel(s string) bool {
	return s != "" && strings.ContainsRune("aeiouAEIOU", rune(s[0]))
}

func article(s string) string {
	if startsVowel(s) {
		return "an"
	}
	return "a"
}

// trimEnd is JS String.prototype.trimEnd for the ASCII whitespace the
// describers can produce.
func trimEnd(s string) string { return strings.TrimRight(s, " \t\n\r\f\v") }

// isList reports whether v is a JSON array (JS Array.isArray).
func isList(v any) bool {
	_, ok := v.([]any)
	return ok
}

var conditionOrdinals = []string{"zeroth", "first", "second", "third", "fourth", "fifth"}

func conditionOrd(n float64) string {
	if n >= 0 && n == float64(int(n)) && int(n) < len(conditionOrdinals) {
		return conditionOrdinals[int(n)]
	}
	return numStr(n) + "th"
}

// jsNumberStr renders JS `${Number(v)}`: a numeric value as its number, else NaN.
func jsNumberStr(v any) (float64, string) {
	if f, ok := parseNumber(v); ok {
		return f, numStr(f)
	}
	return 0, "NaN"
}

// -- Shared references --------------------------------------------------------

var rolePhrases = map[string]string{
	"this-unit":          "the unit",
	"this-model":         "this model",
	"model-in-this-unit": "a model in this unit",
	"attacker":           "the attacking unit",
	"defender":           "the target unit",
	"event-subject":      "the triggering unit",
	"event-object":       "that unit",
	"stratagem-target":   "the Stratagem's target",
	"selected-unit":      "the selected unit",
	"recipient":          "the unit",
}

// unitFilterPhrase renders a unit filter as a noun phrase: "a friendly ADEPTUS
// MECHANICUS BATTLELINE unit".
func unitFilterPhrase(f map[string]any) string {
	owner := ""
	switch f["owner"] {
	case "friendly":
		owner = "friendly "
	case "enemy":
		owner = "enemy "
	}
	all := ""
	if isList(f["all_of"]) {
		all = strings.Join(cstrList(f["all_of"]), " ") + " "
	}
	noun := "unit"
	if f["level"] == "model" {
		noun = "model"
	}
	s := owner + all + noun
	s = article(s) + " " + s
	if isList(f["any_of"]) {
		s += " with the " + orList(cstrList(f["any_of"])) + " keyword"
	}
	if isList(f["none_of"]) {
		s += " (excluding " + orList(cstrList(f["none_of"])) + " " + noun + "s)"
	}
	if f["designated"] != nil {
		s += " that is " + designationPhrase(cstr(f["designated"]))
	}
	if f["state"] != nil {
		s += " that is " + statePhrase(cstr(f["state"]), false)
	}
	if f["visible"] == true {
		s += " that is visible to it"
	}
	return s
}

// unitRefPhrase renders a unit-ref as a noun phrase; fallback names the default subject.
func unitRefPhrase(ref any, fallback string) string {
	switch r := ref.(type) {
	case nil:
		return fallback
	case string:
		if p, ok := rolePhrases[r]; ok {
			return p
		}
		return dekebab(r)
	case map[string]any:
		if _, ok := r["event_var"].(string); ok {
			return "that unit"
		}
		if sv, ok := r["selection_var"].(string); ok {
			return "the bound " + strings.ReplaceAll(sv, "_", " ")
		}
		return unitFilterPhrase(r)
	case []any:
		return unitFilterPhrase(map[string]any{})
	}
	return fallback
}

// subjectOf renders the subject of a predicate.
func subjectOf(p map[string]any, fallback string) string {
	return unitRefPhrase(p["subject"], fallback)
}

var auraRanges = map[string]string{"nurgle-s-gift-aura": "Contagion Range"}

var rangeSlugPhrases = map[string]string{
	"engagement":        "Engagement Range",
	"aura":              "its aura range",
	"weapon":            "the attacking weapon's range",
	"half-weapon":       "half the attacking weapon's range",
	"detection":         "detection range",
	"objective-control": "range",
}

// rangePhrase renders a range-ref as a distance phrase ("6\"", "Engagement Range").
func rangePhrase(r any) string {
	switch x := r.(type) {
	case nil:
		return "?\""
	case string:
		if p, ok := rangeSlugPhrases[x]; ok {
			return p
		}
		return dekebab(x)
	case map[string]any:
		if x["inches"] != nil {
			return cstr(x["inches"]) + "\""
		}
		if x["aura_of"] != nil {
			if p, ok := auraRanges[cstr(x["aura_of"])]; ok {
				return p
			}
			return "the " + titleCase(cstr(x["aura_of"])) + " range"
		}
	}
	return "?\""
}

func objectivePhrase(f map[string]any, plural bool, noun string) string {
	role := ""
	if f["role"] != "non-home" && f["role"] != nil {
		role = dekebab(cstr(f["role"])) + " "
	}
	s := role + noun
	if plural {
		s += "s"
	}
	switch f["home_of"] {
	case "enemy":
		s += " (opponent home)"
	case "friendly":
		s += " (your home)"
	}
	if f["name"] != nil {
		s += " (" + dekebab(cstr(f["name"])) + ")"
	}
	if f["territory"] != nil {
		s += " in " + dekebab(cstr(f["territory"]))
	}
	if f["role"] == "non-home" {
		s += " (excluding home)"
	}
	switch f["controlled_by"] {
	case "friendly":
		s += " you control"
	case "enemy":
		s += " your opponent controls"
	}
	if f["designated"] != nil {
		s += " tagged " + dekebab(cstr(f["designated"]))
	}
	return s
}

var statePhrases = map[string]string{
	"engaged":               "engaged",
	"battle-shocked":        "Battle-shocked",
	"embarked":              "embarked",
	"in-strategic-reserves": "in Strategic Reserves",
	"in-reserves":           "in Reserves",
	"on-battlefield":        "on the battlefield",
	"hidden":                "hidden",
	"fights-first":          "a Fights First unit",
	"benefit-of-cover":      "receiving the benefit of cover",
}

var negatedStates = map[string]string{"engaged": "unengaged"}

func statePhrase(state string, negated bool) string {
	positive, ok := statePhrases[state]
	if !ok {
		positive = dekebab(state)
	}
	if negated {
		if p, ok := negatedStates[state]; ok {
			return p
		}
		return "not " + positive
	}
	return positive
}

// designationPhrase keeps GW-printed tags as printed and spells out internal state names.
func designationPhrase(tag string) string {
	if tag == strings.ToUpper(tag) {
		return tag
	}
	return "tagged " + dekebab(tag)
}

var windowPhrases = map[string]string{
	"phase":         "this phase",
	"turn":          "this turn",
	"round":         "this battle round",
	"battle":        "this battle",
	"previous-turn": "in the previous turn",
	"event":         "",
}

func windowPhrase(w any) string {
	if p, ok := windowPhrases[cstr(w)]; ok {
		return p
	}
	return dekebab(cstr(w))
}

func withWindow(s string, w any) string {
	if wp := windowPhrase(w); wp != "" {
		return s + " " + wp
	}
	return s
}

var moveNames = map[string]string{
	"normal": "Normal", "advance": "Advance", "remain-stationary": "Remain Stationary", "fall-back": "Fall Back",
	"charge": "Charge", "pile-in": "Pile-in", "consolidation": "Consolidation", "ingress": "ingress",
	"surge": "Surge", "scout": "Scout", "disembark": "Disembark",
}

// moveKinds renders a move_types list as an "or" list of move names.
func moveKinds(types any) string {
	l, _ := asList(types)
	names := make([]string, len(l))
	for i, t := range l {
		if n, ok := moveNames[cstr(t)]; ok {
			names[i] = n
		} else {
			names[i] = dekebab(cstr(t))
		}
	}
	return orList(names)
}

func conditionOperands(c map[string]any, op string) ([]map[string]any, bool) {
	if c["operator"] != op {
		return nil, false
	}
	l, ok := asList(c["operands"])
	if !ok {
		return nil, false
	}
	out := make([]map[string]any, len(l))
	for i, e := range l {
		out[i] = mapOr(e)
	}
	return out, true
}

// describeCondition renders a condition as a predicate phrase ("the unit is
// below starting strength and during your turn").
func describeCondition(c map[string]any) string {
	if c == nil {
		c = map[string]any{}
	}
	if ops, ok := conditionOperands(c, "and"); ok {
		parts := make([]string, len(ops))
		for i, o := range ops {
			if o["operator"] == "or" {
				parts[i] = "(" + describeCondition(o) + ")"
			} else {
				parts[i] = describeCondition(o)
			}
		}
		return strings.Join(parts, " and ")
	}
	if ops, ok := conditionOperands(c, "or"); ok {
		parts := make([]string, len(ops))
		for i, o := range ops {
			if o["operator"] == "and" {
				parts[i] = "(" + describeCondition(o) + ")"
			} else {
				parts[i] = describeCondition(o)
			}
		}
		return strings.Join(parts, " or ")
	}
	if ops, ok := conditionOperands(c, "not"); ok {
		if len(ops) == 1 && !jsTruthy(ops[0]["operator"]) {
			return describePredicate(ops[0], true)
		}
		parts := make([]string, len(ops))
		for i, o := range ops {
			parts[i] = describeCondition(o)
		}
		return "not (" + strings.Join(parts, ", ") + ")"
	}
	return describePredicate(c, false)
}

// describeSelectionEligibility renders a condition as a predicate on an
// already-named candidate unit ("that is not Battle-shocked"), so selection
// eligibility reads distinct from an ability's own condition.
func describeSelectionEligibility(c map[string]any) string {
	inner := c
	negated := false
	if ops, ok := conditionOperands(c, "not"); ok && len(ops) == 1 {
		inner, negated = ops[0], true
	}
	ip := paramsOf(inner)
	if inner["type"] == "unit-state" && ip["state"] == "battle-shocked" && ip["subject"] == nil {
		if negated {
			return "that is not Battle-shocked"
		}
		return "that is Battle-shocked"
	}
	if _, ok := conditionOperands(c, "and"); ok {
		var flat func(n map[string]any) []map[string]any
		flat = func(n map[string]any) []map[string]any {
			if ops, ok := conditionOperands(n, "and"); ok {
				var out []map[string]any
				for _, o := range ops {
					out = append(out, flat(o)...)
				}
				return out
			}
			return []map[string]any{n}
		}
		var parts []string
		all := true
		for _, n := range flat(c) {
			part, ok := candidateClause(n)
			if !ok {
				all = false
				break
			}
			parts = append(parts, part)
		}
		if all {
			return strings.Join(parts, " and ")
		}
	}
	if part, ok := candidateClause(c); ok {
		return part
	}
	return "if " + describeCondition(c)
}

var candidatePrefixes = [][2]string{
	{"the unit does not have ", "without "},
	{"the unit has not ", "that has not "},
	{"the unit has ", "with "},
	{"not the unit is ", "that is not "},
	{"the unit ", "that "},
}

// candidateClause renders a condition on the candidate as a relative clause
// ("that was hit...", "without \"MONSTER\""), else ok=false.
func candidateClause(c map[string]any) (string, bool) {
	phrase := describeCondition(c)
	for _, pair := range candidatePrefixes {
		if rest, ok := strings.CutPrefix(phrase, pair[0]); ok {
			return pair[1] + rest, true
		}
	}
	return "", false
}
