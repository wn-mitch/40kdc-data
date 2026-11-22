package wh40kdc

import (
	"regexp"
	"strings"
)

// Humanize an Ability-DSL / scoring condition into plain English. Shared by
// the effect describer (which frames conditions as lead-ins, conditionLeadIn)
// and the scoring-card translator. ASCII-only with a fixed clause + parameter
// order, pinned byte-for-byte across the ports by the conformance corpus.
// Mirror of tools/src/translate/condition.ts.

func dekebab(s string) string { return strings.ReplaceAll(s, "-", " ") }

// eventRelationPhrase renders exact causal links; sharing the actor is not enough.
func eventRelationPhrase(filter map[string]any) string {
	phrase := ""
	if filter["caused_by"] != nil {
		phrase += " as a result of that event"
	}
	if filter["causes"] != nil {
		phrase += " triggering this ability"
	}
	return phrase
}

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

var (
	articleNumRe = regexp.MustCompile(`^(?:8|11|18)\b`)
	articleOneRe = regexp.MustCompile(`(?i)^one\b`)
)

// withArticle renders a phonetic indefinite article ("a unit", "an ASPECT WARRIORS unit",
// "an Advance", "an ability").
func withArticle(phrase string) string {
	s := strings.TrimLeft(phrase, " \t\n\r\f\v")
	if s == "" {
		return "a"
	}
	if articleOneRe.MatchString(s) {
		return "a " + s
	}
	lower := strings.ToLower(s)
	vowel := false
	switch lower[0] {
	case 'a', 'e', 'i', 'o':
		vowel = true
	case 'u':
		vowel = !strings.HasPrefix(lower, "uni") && !strings.HasPrefix(lower, "use") && !strings.HasPrefix(lower, "ut")
	default:
		vowel = articleNumRe.MatchString(s)
	}
	if vowel {
		return "an " + s
	}
	return "a " + s
}

// withinClause renders " within 6\" of this unit", or " in contact with a cult ambush marker" when range is 0".
func withinClause(within map[string]any, ofOverride *string) string {
	r, _ := asMap(within["range"])
	zero := false
	if r != nil {
		if v, ok := r["inches"].(float64); ok && v == 0 {
			zero = true
		}
	}
	of := ""
	if ofOverride != nil {
		of = *ofOverride
	} else if within["of"] != nil {
		of = placeRefPhrase(within["of"])
	}
	if zero && of != "" {
		return " in contact with " + of
	}
	wholly := ""
	if within["wholly"] == true {
		wholly = "wholly "
	}
	tail := ""
	if of != "" {
		tail = " of " + of
	}
	return " " + wholly + "within " + rangePhrase(within["range"]) + tail
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

// eventObjectModel and eventSubjectModel are the describer's spellings of `event-object` and
// `event-subject` when every trigger's object (or subject) is a model ("that model", "the triggering
// model" rather than "that unit", "the triggering unit"). modelEventRefs writes them into the effect
// before rendering.
const (
	eventObjectModel  = "event-object-model"
	eventSubjectModel = "event-subject-model"
)

// isEventObject reports whether ref is the trigger's event object, a unit or a model.
func isEventObject(ref any) bool {
	return ref == "event-object" || ref == eventObjectModel
}

// isEventSubject reports whether ref is the trigger's event subject, a unit or a model.
func isEventSubject(ref any) bool {
	return ref == "event-subject" || ref == eventSubjectModel
}

// liveTriggers is the triggers of a spec (one trigger or a list) that name an event.
func liveTriggers(triggers []map[string]any) []map[string]any {
	var out []map[string]any
	for _, t := range triggers {
		if t["event"] != nil {
			out = append(out, t)
		}
	}
	return out
}

// allModels reports whether every trigger names a model as its role (its subject or object): a
// model-level filter, or one model of this unit (model-in-this-unit).
func allModels(triggers []map[string]any, role string) bool {
	live := liveTriggers(triggers)
	if len(live) == 0 {
		return false
	}
	for _, t := range live {
		if t[role] == "model-in-this-unit" {
			continue
		}
		if mapOr(t[role])["level"] != "model" {
			return false
		}
	}
	return true
}

// namesRole reports whether any trigger of a spec with an event names a role.
func namesRole(trigger any, role string) bool {
	for _, t := range liveTriggers(normalizeTriggers(trigger)) {
		if t[role] != nil {
			return true
		}
	}
	return false
}

// modelEventRefs returns v with its `event-object` refs spelled eventObjectModel when every
// trigger's object is a model, and its `event-subject` refs spelled eventSubjectModel when every
// trigger's subject is. Inside an `ability-part` whose own trigger names an object (a subject), that
// ref names the part's event instead, so it is left for the part to rewrite when it renders.
func modelEventRefs(v any, triggers []map[string]any) any {
	var rewrite func(v any, object, subject bool) any
	rewrite = func(v any, object, subject bool) any {
		switch x := v.(type) {
		case string:
			if object && x == "event-object" {
				return eventObjectModel
			}
			if subject && x == "event-subject" {
				return eventSubjectModel
			}
		case []any:
			out := make([]any, len(x))
			for i, item := range x {
				out[i] = rewrite(item, object, subject)
			}
			return out
		case map[string]any:
			part := x["type"] == "ability-part"
			out := make(map[string]any, len(x))
			for k, item := range x {
				if part && k == "effect" {
					out[k] = rewrite(item, object && !namesRole(x["trigger"], "object"), subject && !namesRole(x["trigger"], "subject"))
				} else {
					out[k] = rewrite(item, object, subject)
				}
			}
			return out
		}
		return v
	}
	object := allModels(triggers, "object")
	subject := allModels(triggers, "subject")
	if !object && !subject {
		return v
	}
	return rewrite(v, object, subject)
}

var rolePhrases = map[string]string{
	"this-unit":          "this unit",
	"this-model":         "this model",
	"model-in-this-unit": "a model in this unit",
	"attacker":           "the attacking unit",
	"defender":           "the target unit",
	"event-subject":      "the triggering unit",
	eventSubjectModel:    "the triggering model",
	"event-object":       "that unit",
	eventObjectModel:     "that model",
	"stratagem-target":   "the Stratagem's target",
	"selected-unit":      "the selected unit",
	"recipient":          "this unit",
	"bearer-transport":   "the Transport this unit is embarked within",
	"ability-unit":       "this unit",
}

// idLabelList maps a JSON array of ability ids through idLabel.
func idLabelList(v any) []string {
	l := cstrList(v)
	for i, x := range l {
		l[i] = idLabel(x)
	}
	return l
}

// unitFilterPhrase renders a unit filter as a noun phrase: "a friendly ADEPTUS
// MECHANICUS BATTLELINE unit".
// keywordAlternatives is a filter's any_of_filters as keyword spellings when each alternative is
// only its keywords and the filter requires none of its own, so "an A or B C unit" says it.
func keywordAlternatives(f map[string]any) ([]string, bool) {
	alts, ok := asList(f["any_of_filters"])
	if !ok || isList(f["all_of"]) {
		return nil, false
	}
	out := []string{}
	for _, a := range alts {
		m, ok := asMap(a)
		if !ok || m == nil {
			return nil, false
		}
		all, ok := asList(m["all_of"])
		if !ok || len(all) == 0 || len(m) != 1 {
			return nil, false
		}
		out = append(out, strings.Join(cstrList(m["all_of"]), " "))
	}
	return out, true
}

// alternativeFilters is each alternative of any_of_filters as a filter of the outer filter's level.
func alternativeFilters(f map[string]any) []map[string]any {
	alts, _ := asList(f["any_of_filters"])
	out := []map[string]any{}
	for _, a := range alts {
		m, _ := asMap(a)
		copied := map[string]any{}
		for k, v := range m {
			copied[k] = v
		}
		if level, ok := f["level"]; ok && level != nil {
			copied["level"] = level
		}
		out = append(out, copied)
	}
	return out
}

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
	unitIdNames := ""
	if isList(f["unit_ids"]) {
		raw := cstrList(f["unit_ids"])
		titled := make([]string, len(raw))
		for i, id := range raw {
			titled[i] = titleCase(id)
		}
		unitIdNames = orList(titled)
	}
	inlineUnitIds := ""
	if unitIdNames != "" && all == "" && !isList(f["any_of_filters"]) {
		inlineUnitIds = unitIdNames + " "
	}
	noun := "unit"
	if f["level"] == "model" {
		if role := cstr(f["attachment_role"]); role != "" && role != "?" {
			noun = titleCase(role) + " model"
		} else {
			noun = "model"
		}
	}
	// "a friendly LEGIO CYBERNETICA or ADEPTUS MECHANICUS VEHICLE unit": keyword-only alternatives.
	compact, isCompact := keywordAlternatives(f)
	s := owner + all + inlineUnitIds + noun
	if isCompact {
		s = owner + orList(compact) + " " + noun
	}
	s = withArticle(s)
	// Any other alternatives: "a unit that is a PSYKER unit or a unit that is Battle-shocked".
	if isList(f["any_of_filters"]) && !isCompact {
		alts := []string{}
		for _, a := range alternativeFilters(f) {
			alts = append(alts, unitFilterPhrase(a))
		}
		s += " that is " + orList(alts)
	}
	if isList(f["any_of"]) {
		s += " with the " + orList(cstrList(f["any_of"])) + " keyword"
	}
	if isList(f["none_of"]) {
		s += " (excluding " + orList(cstrList(f["none_of"])) + " " + noun + "s)"
	}
	if isList(f["not_all_of"]) {
		s += " (excluding " + strings.Join(cstrList(f["not_all_of"]), " ") + " " + noun + "s)"
	}
	if isList(f["shares_any_of"]) {
		s += " that shares the " + orList(cstrList(f["shares_any_of"])) + " keyword with it"
	}
	if isList(f["has_ability"]) {
		ability := "the " + andList(idLabelList(f["has_ability"])) + " ability"
		if models, ok := f["has_ability_models"].(map[string]any); ok {
			s += " in which every model (excluding " + orList(cstrList(models["none_of"])) + " models) has " + ability
		} else {
			s += " with " + ability
		}
	}
	if isList(f["lacks_ability"]) {
		s += " without the " + orList(idLabelList(f["lacks_ability"])) + " ability"
	}
	if isList(f["model_names"]) {
		s += " named " + orList(cstrList(f["model_names"]))
	}
	if unitIdNames != "" && inlineUnitIds == "" {
		s += " (" + unitIdNames + ")"
	}
	if f["embarked_in"] != nil {
		s += " embarked within " + unitRefPhrase(f["embarked_in"], "this unit")
	}
	if f["member_of"] != nil {
		s += " in " + unitRefPhrase(f["member_of"], "this unit")
	}
	if f["engaged_with"] != nil {
		s += " within Engagement Range of " + unitRefPhrase(f["engaged_with"], "this unit")
	}
	if f["not_engaged_with"] != nil {
		ref := unitRefPhrase(f["not_engaged_with"], "this unit")
		if m, ok := asMap(f["not_engaged_with"]); ok && m != nil && m["selection_var"] == nil && m["event_var"] == nil && m["stratagem_target"] == nil {
			ref = "any " + strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(ref, "a "), "an "))
		}
		s += " not within Engagement Range of " + ref
	}
	if f["designated"] != nil {
		s += " that is " + designationPhrase(cstr(f["designated"]), false)
		if f["designated_by"] != nil {
			s += " by " + unitRefPhrase(f["designated_by"], "this unit")
		}
	}
	if f["not_designated"] != nil {
		s += " that is not " + designationPhrase(cstr(f["not_designated"]), false)
	}
	if f["state"] != nil {
		s += " that is " + statePhrase(cstr(f["state"]), false)
	}
	if isList(f["not_states"]) {
		negs := []string{}
		for _, x := range cstrList(f["not_states"]) {
			negs = append(negs, statePhrase(x, true))
		}
		s += " that is " + andList(negs)
	}
	if visible, ok := asMap(f["visible"]); ok && visible != nil {
		s += " that is visible to " + unitRefPhrase(visible["to"], "this unit")
	} else if f["visible"] == true {
		s += " that is visible to it"
	}
	if within, ok := asMap(f["within"]); ok && within != nil {
		s += withinClause(within, nil)
	}
	if f["excluding"] != nil {
		if f["excluding"] == "this-unit" {
			s += " other than this unit"
		} else {
			s += " other than " + unitRefPhrase(f["excluding"], "this unit")
		}
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
			return "the chosen " + strings.ReplaceAll(sv, "_", " ")
		}
		if st, ok := r["stratagem_target"].(string); ok {
			return "the " + dekebab(strings.TrimPrefix(st, "the-")) + " target"
		}
		return unitFilterPhrase(r)
	case []any:
		return unitFilterPhrase(map[string]any{})
	}
	return fallback
}

// placeRefPhrase preserves objective and marker origins instead of flattening
// them to a unit reference.
func placeRefPhrase(ref any) string {
	if ref == "battlefield-edge" {
		return "a battlefield edge"
	}
	if ref == "battlefield-centre" {
		return "the centre of the battlefield"
	}
	if r, ok := asMap(ref); ok && r != nil {
		if objective, ok := asMap(r["objective"]); ok && objective != nil {
			if objective["selection_var"] != nil {
				return "that objective marker"
			}
			phrase := objectivePhrase(objective, false, "objective marker")
			return article(phrase) + " " + phrase
		}
		if marker := r["marker"]; marker != nil {
			phrase := ejstr(marker)
			// A marker id that already ends in "marker" ("cult-ambush-marker") must not read "marker marker".
			return article(phrase) + " " + dekebab(strings.TrimSuffix(phrase, "-marker")) + " marker"
		}
	}
	return unitRefPhrase(ref, "this unit")
}

// subjectOf renders the subject of a predicate.
func subjectOf(p map[string]any, fallback string) string {
	return unitRefPhrase(p["subject"], fallback)
}

func ruleRefPhrase(value any) string {
	if ref, ok := asMap(value); ok && ref != nil {
		if ref["definition_id"] != nil {
			return idLabel(ref["definition_id"]) + " ability of " + idLabel(ref["ability_id"])
		}
		return idLabel(ref["option_id"]) + " option of " + idLabel(ref["ability_id"])
	}
	return idLabel(value)
}

var auraRanges = map[string]string{"nurgles-gift-death-guard": "Contagion Range", "synapse-tyranids": "Synapse Range"}

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
		// A rolled distance ("within D6\"").
		if x["dice"] != nil {
			return cstr(x["dice"]) + "\""
		}
		if x["aura_of"] != nil {
			if p, ok := auraRanges[cstr(x["aura_of"])]; ok {
				return p
			}
			return "the " + idLabel(x["aura_of"]) + " range"
		}
		if tiers, ok := asList(x["per_battle_round"]); ok && len(tiers) > 0 {
			rounds := make([]string, len(tiers))
			for i, tier := range tiers {
				rounds[i] = rangePhrase(tier)
			}
			indices := make([]string, len(tiers))
			for i := range tiers {
				indices[i] = numStr(float64(i + 1))
			}
			return strings.Join(rounds, ", ") + " in battle rounds " + strings.Join(indices, ", ") + " respectively (using the final range in later battle rounds)"
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
		s += " in " + territoryPhrase(cstr(f["territory"]))
	}
	if f["outside_territory"] != nil {
		s += " not in " + territoryPhrase(cstr(f["outside_territory"]))
	}
	if f["role"] == "non-home" {
		s += " (excluding home)"
	}
	within, hasWithin := asMap(f["within"])
	hasWithin = hasWithin && within != nil
	// Your control, within this unit's own range of it: the unit itself is controlling it.
	unitControls := f["controlled_by"] == "friendly" && hasWithin && within["range"] == "objective-control" && within["of"] == "this-unit"
	switch {
	case unitControls:
		s += " your unit controls"
	case f["controlled_by"] == "friendly":
		s += " you control"
	case f["controlled_by"] == "enemy":
		s += " your opponent controls"
	}
	if f["designated"] != nil {
		s += " tagged " + dekebab(cstr(f["designated"]))
	}
	if hasWithin && !unitControls {
		s += " within " + rangePhrase(within["range"]) + " of " + placeRefPhrase(within["of"])
	}
	// "visible to one or more models in your unit".
	if f["visible_to"] != nil {
		who := "one or more models in the unit"
		if f["visible_to"] != "this-unit" {
			who = unitRefPhrase(f["visible_to"], "the unit")
		}
		s += " visible to " + who
	}
	// "that your unit was controlling when it was destroyed": the unit's control when the rule was triggered.
	if f["controlled_by_unit"] != nil {
		when := "when the rule was triggered"
		if f["controlled_at"] == "previous-phase-end" {
			when = "at the end of the previous phase"
		}
		s += " that " + unitRefPhrase(f["controlled_by_unit"], "this unit") + " was controlling " + when
	}
	if clear, ok := asMap(f["clear_of"]); ok && clear != nil {
		phrase := leadingArticleRe.ReplaceAllString(unitFilterPhrase(clear), "")
		if loc := unitWordRe.FindStringIndex(phrase); loc != nil {
			phrase = phrase[:loc[0]] + "units" + phrase[loc[1]:]
		}
		s += ", with no " + phrase + " within range of it"
	}
	// "that has a friendly unit with this ability within range of it".
	if held, ok := asMap(f["occupied_by"]); ok && held != nil {
		phrase := leadingArticleRe.ReplaceAllString(unitFilterPhrase(held), "")
		if loc := unitWordRe.FindStringIndex(phrase); loc != nil {
			phrase = phrase[:loc[0]] + "units" + phrase[loc[1]:]
		}
		s += ", with one or more " + phrase + " within range of it"
	}
	return s
}

var unitWordRe = regexp.MustCompile(`\bunit\b`)

var statePhrases = map[string]string{
	"engaged":               "engaged",
	"battle-shocked":        "Battle-shocked",
	"embarked":              "embarked",
	"in-strategic-reserves": "in Strategic Reserves",
	"in-cult-ambush":        "in Cult Ambush",
	"on-battlefield":        "on the battlefield",
	"hidden":                "hidden",
	"fights-first":          "a Fights First unit",
	"benefit-of-cover":      "receiving the Benefit of Cover",
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

// designationPhrase prints a registered id's rules term, keeps legacy
// upper-case tags as printed and spells out internal ones.
func designationPhrase(tag string, plural bool) string {
	if label, ok := designationTerm(tag, plural); ok {
		return label
	}
	if tag == strings.ToUpper(tag) {
		return tag
	}
	return "designated as " + titleCase(tag)
}

var windowPhrases = map[string]string{
	"phase":         "this phase",
	"turn":          "this turn",
	"round":         "this battle round",
	"battle-round":  "this battle round",
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
	"charge": "Charge", "pile-in": "Pile-in", "consolidation": "Consolidation", "ingress": "Ingress",
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
		// not(not(X)) reads as X, never "not (... is not ...)".
		if len(ops) == 1 {
			if inner, ok := conditionOperands(ops[0], "not"); ok && len(inner) == 1 {
				return describeCondition(inner[0])
			}
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
		for _, op := range flat(c) {
			if orOps, ok := conditionOperands(op, "or"); ok {
				var orParts []string
				allOr := true
				for _, o := range orOps {
					part, ok := candidateClause(o)
					if !ok {
						allOr = false
						break
					}
					orParts = append(orParts, part)
				}
				if allOr {
					parts = append(parts, "that ("+joinRelative(orParts, "or")+")")
					continue
				}
				return "if " + describeCondition(c)
			}
			clause, ok := candidateClause(op)
			if !ok {
				return "if " + describeCondition(c)
			}
			parts = append(parts, clause)
		}
		return joinRelative(parts, "and")
	}
	if ops, ok := conditionOperands(c, "or"); ok {
		var parts []string
		all := true
		for _, n := range ops {
			part, ok := candidateClause(n)
			if !ok {
				all = false
				break
			}
			parts = append(parts, part)
		}
		if all {
			return joinRelative(parts, "or")
		}
	}
	if part, ok := candidateClause(c); ok {
		return part
	}
	return "if " + describeCondition(c)
}

var withoutKeywordRe = regexp.MustCompile(`^without the ([A-Z0-9 -]+) keyword$`)

// joinRelative joins relative clauses cleanly, collapsing repeated "that is " / "without the X keyword" runs.
func joinRelative(parts []string, conj string) string {
	if len(parts) <= 1 {
		if len(parts) == 1 {
			return parts[0]
		}
		return ""
	}
	var merged []string
	if conj == "and" {
		for i := 0; i < len(parts); {
			if kw := withoutKeywordRe.FindStringSubmatch(parts[i]); kw != nil {
				kws := []string{kw[1]}
				j := i + 1
				for j < len(parts) {
					next := withoutKeywordRe.FindStringSubmatch(parts[j])
					if next == nil {
						break
					}
					kws = append(kws, next[1])
					j++
				}
				if len(kws) > 1 {
					merged = append(merged, "without the "+orList(kws)+" keyword")
				} else {
					merged = append(merged, parts[i])
				}
				i = j
				continue
			}
			merged = append(merged, parts[i])
			i++
		}
	} else {
		merged = append(merged, parts...)
	}
	allThatIs := true
	for _, p := range merged {
		if !strings.HasPrefix(p, "that is ") {
			allThatIs = false
			break
		}
	}
	if allThatIs {
		rest := make([]string, len(merged))
		for i, p := range merged {
			rest[i] = strings.TrimPrefix(p, "that is ")
		}
		if conj == "and" {
			return "that is " + andList(rest)
		}
		return "that is " + orList(rest)
	}
	deduped := make([]string, len(merged))
	for idx, p := range merged {
		if idx > 0 && strings.HasPrefix(p, "that is ") && strings.HasPrefix(merged[idx-1], "that is ") {
			deduped[idx] = strings.TrimPrefix(p, "that is ")
		} else if idx > 0 && strings.HasPrefix(p, "that ") && strings.HasPrefix(merged[idx-1], "that ") {
			deduped[idx] = strings.TrimPrefix(p, "that ")
		} else {
			deduped[idx] = p
		}
	}
	return strings.Join(deduped, " "+conj+" ")
}

var candidateSubjects = []string{"this unit", "the unit", "the selected unit", "the selected model"}

// candidateClause renders a condition on the candidate as a relative clause
// ("that was hit...", "without the MONSTER keyword"), else ok=false.
func candidateClause(c map[string]any) (string, bool) {
	// Never strip prefixes off compound `and`/`or` nodes — that would lose logical grouping.
	if c["operator"] == "and" || c["operator"] == "or" {
		return "", false
	}
	phrase := describeCondition(c)
	for _, subj := range candidateSubjects {
		for _, pair := range [][2]string{
			{subj + " is not the same unit as ", "other than "},
			{subj + " does not have ", "without "},
			{subj + " has not ", "that has not "},
			{subj + " has ", "with "},
			{"not " + subj + " is ", "that is not "},
			{subj + " ", "that "},
		} {
			if rest, ok := strings.CutPrefix(phrase, pair[0]); ok {
				return pair[1] + rest, true
			}
		}
	}
	return "", false
}

// territoryPhrase: "your opponent's deployment zone"; a deployment zone is named by whose it is, other territories by their words.
func territoryPhrase(territory string) string {
	switch territory {
	case "your-deployment-zone":
		return "your deployment zone"
	case "enemy-deployment-zone":
		return "your opponent's deployment zone"
	case "no-mans-land":
		return "no man's land"
	}
	return dekebab(territory)
}
