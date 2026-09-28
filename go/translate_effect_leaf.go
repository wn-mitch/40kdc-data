package wh40kdc

import (
	"math"
	"regexp"
	"strings"
)

// Single effects on the characteristic, roll, ability and permission axes, as
// one lowercase-initial clause with no period. The board axes (protection,
// models, moves, placement, tests, resources, designation, army) are in
// translate_effect_leaf_board.go. Mirror of tools/src/translate/effect-leaf.ts.

// leafTypes lists every single-effect type; anything else is a container.
var leafTypes = map[string]bool{}

func init() {
	for _, t := range []string{
		"stat-modifier", "ignore-modifiers", "roll-modifier", "re-roll", "roll-result", "end-attack-sequence", "ability-grant",
		"keyword-grant", "weapon-ability-grant", "weapon-grant", "ability-modifier", "ability-activate", "permission", "targeting",
		"counts-as", "rule-state", "mortal-wounds", "damage-reduction", "feel-no-pain", "invulnerable-save", "heal", "return-models",
		"destroy-models", "act-on-death", "split-unit", "add-unit", "destruction-rule", "move", "move-modifier", "set-up", "marker",
		"transport-capacity", "test", "state-change", "cp-gain", "cost-modifier", "resource-gain", "resource-spend", "resource-die",
		"objective-sticky", "designate", "army-rule", "test-exemption", "datasheet-swap", "characteristic-resolution", "borrow-weapons",
		"select-weapon",
	} {
		leafTypes[t] = true
	}
}

// incomingLead is "each time an attack targets the unit, " — the lead of an `incoming` change.
func incomingLead(m map[string]any, subj string) string {
	attack := "an attack"
	if m["weapon_type"] != nil {
		attack = "a " + ejstr(m["weapon_type"]) + " attack"
	}
	return "each time " + attack + " targets " + subj + ", "
}

// statChange renders a stat change as a verb phrase over `what`.
func statChange(m map[string]any, what string) string {
	op := ejstr(m["operation"])
	switch op {
	case "set":
		return "set " + what + " to " + diceCase(m["value"])
	case "halve":
		return "halve " + what
	case "multiply":
		return "multiply " + what + " by " + diceCase(m["value"])
	case "improve", "worsen":
		return op + " " + what + " by " + diceCase(m["value"])
	}
	verb := "add"
	if op == "subtract" {
		verb = "subtract"
	}
	val := m["value"]
	if n := jsNumber(val); !math.IsNaN(n) && n < 0 {
		if verb == "add" {
			verb = "subtract"
		} else {
			verb = "add"
		}
		val = math.Abs(n)
	}
	prep := "from"
	if verb == "add" {
		prep = "to"
	}
	return verb + " " + diceCase(val) + " " + prep + " " + what
}

func bounds(m map[string]any) string {
	s := ""
	if m["minimum"] != nil {
		s += " (to a minimum of " + ejstr(m["minimum"]) + ")"
	}
	if m["maximum"] != nil {
		s += " (to a maximum of " + ejstr(m["maximum"]) + ")"
	}
	return s
}

func statModifierLeaf(e, m map[string]any, subj string, ctx effCtx) string {
	// AP is printed negative; the DSL stores its magnitude.
	if v, ok := m["value"].(float64); ok && m["stat"] == "AP" && m["operation"] == "set" && v > 0 {
		c := make(map[string]any, len(m))
		for k, x := range m {
			c[k] = x
		}
		c["value"] = "-" + numStr(v)
		m = c
	}
	stat := statName(m["stat"]) + " characteristic"
	if m["incoming"] == true {
		return incomingLead(m, subj) + statChange(m, "the "+stat+" of that attack") + bounds(m)
	}
	if hasWeapon(m) {
		return statChange(m, "the "+stat+" of "+weaponNoun(m)+" equipped by "+weaponHolder(e["target"], ctx)) + bounds(m)
	}
	return statChange(m, ofOrPossessive(subj, stat)) + bounds(m)
}

func ignoreModifiersLeaf(m map[string]any, subj string) string {
	kind := ""
	switch m["only"] {
	case "worsening":
		kind = "negative "
	case "improving":
		kind = "positive "
	}
	var things string
	if m["what"] == "rolls" {
		things = "rolls"
		if rolls, ok := asList(m["rolls"]); ok {
			anyAll := false
			for _, r := range rolls {
				if r == "all" || r == "any" {
					anyAll = true
				}
			}
			if !anyAll {
				names := make([]string, len(rolls))
				for i, r := range rolls {
					names[i] = rollName(r)
				}
				things = andList(names) + " rolls"
			}
		}
	} else {
		things = "characteristics"
		if stats, ok := asList(m["stats"]); ok {
			names := make([]string, len(stats))
			for i, s := range stats {
				names[i] = statName(s)
			}
			things = andList(names) + " characteristics"
		}
	}
	if m["incoming"] == true {
		return incomingLead(m, subj) + "ignore any " + kind + "modifiers to that attack's " + things
	}
	return subj + " " + ev(subj, "ignores") + " any " + kind + "modifiers to " + pronoun(subj) + " " + things + weaponRollScope(m)
}

func rollModifierLeaf(m map[string]any, subj string) string {
	value := ""
	if m["value_from"] == "previous-roll" {
		value = "the result of that roll"
	}
	cap := ""
	if m["cap"] != nil {
		cap = " (to a maximum of " + esigned(m["operation"], m["cap"]) + ")"
	}
	rolls := rollName(m["roll"]) + " rolls"
	verb, prep := "add", "to"
	if m["operation"] == "subtract" {
		verb, prep = "subtract", "from"
	}
	if m["incoming"] == true {
		change := "apply " + esigned(m["operation"], m["value"]) + " to"
		if value != "" {
			change = verb + " " + value + " " + prep
		}
		return incomingLead(m, subj) + change + " the " + rollName(m["roll"]) + " roll" + cap
	}
	if value != "" {
		return verb + " " + value + " " + prep + " " + ofOrPossessive(subj, rolls) + weaponRollScope(m) + cap
	}
	return subj + " " + ev(subj, "gets") + " " + esigned(m["operation"], m["value"]) + " to " + rolls + weaponRollScope(m) + cap
}

func reRollLeaf(e, m map[string]any, subj string, ctx effCtx) string {
	rn := ejstr(m["roll"])
	noun := rollName(m["roll"]) + " roll"
	if rn == "any" {
		noun = "roll"
	}
	failed := ""
	if m["subset"] == "all-failures" {
		failed = "failed "
	}
	var which string
	if isObject(m["count"]) {
		// A counted allowance ("one for each model equipped with ...") reads as a number of rolls.
		fn := noun
		switch m["subset"] {
		case "all-failures":
			fn = "failed " + noun
		case "ones":
			fn = noun + " of 1"
		}
		which = "a number of " + fn + "s equal to " + diceCase(m["count"])
	} else if cnt, ok := m["count"].(float64); ok {
		qty, plural := "up to "+numStr(cnt), "s"
		if cnt == 1 {
			qty, plural = "one", ""
		}
		ones := ""
		if m["subset"] == "ones" {
			ones = " of 1"
		}
		which = qty + " " + failed + noun + plural + ones
	} else if m["subset"] == "ones" {
		article := "a"
		if rn == "any" {
			article = "any"
		}
		which = article + " " + noun + " of 1"
	} else if m["subset"] == "all-failures" {
		which = "a failed " + noun
	} else if rn == "any" {
		which = "any roll"
	} else {
		which = "the " + noun
	}
	pool := ""
	if m["pool"] != nil {
		pool = " by spending a die from your " + titleCase(ejstr(m["pool"]))
	}
	can := "can"
	if m["mandatory"] == true {
		can = "must"
	}
	if m["incoming"] == true {
		return incomingLead(m, subj) + "the attacking player " + can + " re-roll " + which + pool
	}
	// "you can re-roll ..." names whose roll it is unless that is the ability's own unit.
	t := e["target"]
	own := t == nil || t == "this-unit" || t == "attacker" || (t == "recipient" && !ctx.auraRecipient)
	model := t == "this-model" || (t == "selected-unit" && ctx.selectedModel)
	holder := subj
	if model {
		holder = weaponHolder(t, ctx)
	}
	owner := ""
	if !own {
		attacks := ""
		if rn == "hit" || rn == "wound" || rn == "damage" {
			attacks = "attacks made by "
		}
		owner = " for " + attacks + holder
	}
	return "you " + can + " re-roll " + which + owner + weaponRollScope(m) + pool
}

func rollResultLeaf(m map[string]any, subj string) string {
	roll := rollName(m["roll"])
	lead := ""
	if m["incoming"] == true {
		lead = incomingLead(m, subj)
	}
	if m["critical_on"] != nil {
		crit := "Critical Hit"
		if m["roll"] == "wound" {
			crit = "Critical Wound"
		}
		if m["critical_on"] == "success" {
			by := ""
			if lead == "" {
				by = " made by " + subj
			}
			return lead + "each successful " + roll + " roll" + by + weaponRollScope(m) + " is a " + crit
		}
		if lead != "" {
			return lead + "a " + crit + " on " + roll + " rolls of " + ejstr(m["critical_on"]) + "+" + weaponRollScope(m) + " for that attack"
		}
		return subj + " " + ev(subj, "scores") + " " + crit + "s on " + roll + " rolls of " + ejstr(m["critical_on"]) + "+" + weaponRollScope(m)
	}
	if m["fails_on"] != nil {
		n := jsNumber(m["fails_on"])
		rng := "1-" + numStr(n)
		if n == 1 {
			rng = "1"
		}
		if lead != "" {
			return lead + "an unmodified " + roll + " roll of " + rng + " for that attack always fails"
		}
		return ofOrPossessive(subj, roll+" rolls") + weaponRollScope(m) + " always fail on an unmodified " + rng
	}
	if m["succeeds_on"] != nil {
		if lead != "" {
			return lead + "the " + roll + " roll for that attack succeeds only on an unmodified " + ejstr(m["succeeds_on"]) + "+"
		}
		return ofOrPossessive(subj, roll+" rolls") + weaponRollScope(m) + " succeed only on an unmodified " + ejstr(m["succeeds_on"]) + "+"
	}
	r := ejstr(m["roll"])
	tests := r == "battle-shock" || r == "leadership" || r == "desperate-escape"
	if tests && lead == "" {
		if m["result"] == "pass" {
			return subj + " automatically " + ev(subj, "passes") + " " + roll + " tests"
		}
		if m["result"] == "fail" {
			return subj + " automatically " + ev(subj, "fails") + " " + roll + " tests"
		}
	}
	if lead != "" {
		whose := "the " + roll + " roll for that attack"
		switch m["result"] {
		case "pass":
			return lead + whose + " automatically succeeds"
		case "fail":
			return lead + whose + " automatically fails"
		}
		return lead + whose + " counts as " + unmodifiedWord(m) + ejstr(m["result"])
	}
	whose := ofOrPossessive(subj, roll+" rolls")
	switch m["result"] {
	case "pass":
		return whose + weaponRollScope(m) + " automatically succeed"
	case "fail":
		return whose + weaponRollScope(m) + " automatically fail"
	}
	return whose + weaponRollScope(m) + " count as " + unmodifiedWord(m) + ejstr(m["result"])
}

func unmodifiedWord(m map[string]any) string {
	if m["unmodified"] == true {
		return "an unmodified "
	}
	return ""
}

func abilityGrantLeaf(m map[string]any, subj string) string {
	// Cover is a state a unit has, not an ability it gains.
	if m["ability"] == "benefit-of-cover" {
		return subj + " " + ev(subj, "has") + " the Benefit of Cover"
	}
	inch := ""
	if m["ability"] == "scouts" || m["ability"] == "deep-strike" {
		inch = "\""
	}
	value := ""
	if m["value"] != nil {
		value = " " + ejstr(m["value"]) + inch
	}
	noun := "ability"
	if m["rules_bundle"] == true {
		noun = "rules"
	}
	return subj + " " + ev(subj, "gains") + " the " + abilityLabel(m["ability"]) + value + " " + noun
}

func keywordGrantLeaf(m map[string]any, subj string) string {
	kws := jstrList(m["keywords"])
	noun := "keywords"
	if len(kws) == 1 {
		noun = "keyword"
	}
	replaces := ""
	if r, ok := asList(m["replaces"]); ok {
		kw := "keywords"
		if len(r) == 1 {
			kw = "keyword"
		}
		replaces = ", replacing " + pronoun(subj) + " " + andList(jstrList(r)) + " " + kw
	}
	return subj + " " + ev(subj, "gains") + " the " + andList(kws) + " " + noun + replaces
}

func weaponAbilityGrantLeaf(e, m map[string]any, subj string, ctx effCtx) string {
	kws := "[?]"
	if l, ok := asList(m["abilities"]); ok {
		parts := make([]string, len(l))
		for i, k := range l {
			parts[i] = bracketKeyword(k)
		}
		kws = strings.Join(parts, " and ")
	}
	increment := ""
	if m["if_present"] == "increment" {
		increment = " (a weapon that already has that ability adds the ratings together)"
	}
	if m["incoming"] == true {
		return incomingLead(m, subj) + "the attacking weapon has " + kws + increment
	}
	if hasWeapon(m) {
		noun := weaponNoun(m)
		gain := "gains"
		if weaponsWordRe.MatchString(noun) {
			gain = "gain"
		}
		return noun + " equipped by " + weaponHolder(e["target"], ctx) + " " + gain + " " + kws + increment
	}
	return ofOrPossessive(subj, "weapons") + " gain " + kws + increment
}

var abilityAspects = map[string]string{
	"uses": "number of uses", "range": "range", "targets": "number of targets", "recipients": "recipients", "selections": "number of selections",
	"concurrent": "number that can apply at once", "duration": "duration", "start-round": "first battle round", "end-round": "last battle round",
	"threshold": "threshold", "options": "options",
}

var leadingAllRe = regexp.MustCompile(`^all `)
var leadingHasRe = regexp.MustCompile(`^has `)
var modelsWordRe = regexp.MustCompile(`\bmodels\b`)

// modifiedAbility names the ability an ability-modifier changes: a named one,
// the one a trigger used, or those reaching an audience.
func modifiedAbility(ref any, subj string, ctx effCtx) string {
	if r, ok := asMap(ref); ok && r != nil {
		if r["event"] == "used" {
			return "that ability"
		}
		if kw, ok := r["keyword"].(string); ok {
			return "each " + kw + " ability of " + subj
		}
		return "each ability of " + subj + " that affects " + leadingAllRe.ReplaceAllString(effectSubject(r["affecting"], ctx), "")
	}
	return ofOrPossessive(subj, abilityLabel(ref)+" ability")
}

func abilityModifierLeaf(m map[string]any, subj string, ctx effCtx) string {
	whose := modifiedAbility(m["ability"], subj, ctx)
	aspect, ok := abilityAspects[ejstr(m["aspect"])]
	if !ok {
		aspect = ejstr(m["aspect"])
	}
	value := ejstr(m["value"])
	if _, isNum := m["value"].(float64); isNum && m["aspect"] == "range" {
		value += "\""
	} else if vs, isStr := m["value"].(string); isStr {
		value = dekebab(vs)
	}
	cap := ""
	if m["cap"] != nil {
		cap = " (to a maximum of " + ejstr(m["cap"]) + ")"
	}
	recipients := ""
	if m["recipients"] != nil {
		recipients = effectSubject(m["recipients"], ctx)
	}
	option := ""
	if opt, ok := asMap(m["add_option"]); ok && opt != nil {
		option = "the option " + titleCase(ejstr(opt["name"])) + " (" + describeEffectInline(mapOr(opt["effect"]), ctx) + ")"
	}
	// An add with no value only widens the ability: it names the new recipients or option instead of a count.
	if m["value"] == nil && m["operation"] != "set" && m["operation"] != "lift-limit" && (recipients != "" || option != "") {
		var parts []string
		if recipients != "" {
			parts = append(parts, whose+" can also affect "+recipients)
		}
		if option != "" {
			parts = append(parts, whose+" gains "+option)
		}
		return strings.Join(parts, "; ") + cap
	}
	var s string
	switch m["operation"] {
	case "lift-limit":
		s = whose + " has no limit on its " + aspect
	case "set":
		verb := "is"
		if m["aspect"] == "options" || m["aspect"] == "recipients" {
			verb = "are"
		}
		s = "the " + aspect + " of " + whose + " " + verb + " " + value
	case "subtract":
		s = "decrease the " + aspect + " of " + whose + " by " + value
	default:
		s = "increase the " + aspect + " of " + whose + " by " + value
	}
	if recipients != "" {
		s += "; it can also affect " + recipients
	}
	if option != "" {
		s += "; add " + option
	}
	return s + cap + abilityLimits(m)
}

// abilityLimits renders the limits on a changed allowance: once per battle
// round, never in the same phase, outside the shared limit.
func abilityLimits(m map[string]any) string {
	var parts []string
	if per, ok := asMap(m["cap_per"]); ok && per != nil {
		times := ejstr(per["count"]) + " times"
		if jsNumber(per["count"]) == 1 {
			times = "once"
		}
		parts = append(parts, "but it can be used at most "+times+" per "+dekebab(ejstr(per["period"])))
	}
	if m["not_same"] != nil {
		parts = append(parts, "but not in the same "+ejstr(m["not_same"])+" as the use that triggered this")
	}
	if m["consumes_shared_use"] == false {
		parts = append(parts, "and this use does not count toward that ability's limit for other units")
	}
	if len(parts) == 0 {
		return ""
	}
	return ", " + strings.Join(parts, ", ")
}

func countsAsLeaf(m map[string]any, subj string, ctx effCtx) string {
	if m["in_region"] != nil {
		return subj + " " + ev(subj, "counts") + " as being within " + regionPhrase(mapOr(m["in_region"]))
	}
	of := "this model"
	if m["of"] != nil {
		of = effectSubject(m["of"], ctx)
	}
	return subj + " " + ev(subj, "counts") + " as being within " + rangePhrase(m["within"]) + " of " + of
}

var weaponsWordRe = regexp.MustCompile(`weapons\b`)
var itsWordRe = regexp.MustCompile(`\bits\b`)

var coreRules = map[string][2]string{
	"benefit-of-cover":      {"has the Benefit of Cover", "cannot benefit from Cover"},
	"charge":                {"can charge", "cannot charge"},
	"advance":               {"can Advance", "cannot Advance"},
	"fall-back":             {"can Fall Back", "cannot Fall Back"},
	"ordered-retreat":       {"is not affected by Desperate Escape tests", "must take Desperate Escape tests"},
	"fire-overwatch":        {"can fire Overwatch", "cannot fire Overwatch"},
	"desperate-escape":      {"must take Desperate Escape tests", "is not affected by Desperate Escape tests"},
	"attacking-ends-hidden": {"stops being hidden when it attacks", "does not stop being hidden when it attacks"},
	"engaged-shooting-hit-penalty": {"suffers the -1 to Hit for shooting while within Engagement Range",
		"does not suffer the -1 to Hit for shooting while within Engagement Range"},
	"charge-bonus":               {"receives the Charge bonus", "does not receive the Charge bonus"},
	"hidden":                     {"can become hidden", "cannot become hidden"},
	"orders-end-on-battle-shock": {"loses its Orders when it becomes Battle-shocked", "keeps its Orders when it becomes Battle-shocked"},
}

var coreRuleVerbRe = regexp.MustCompile(`^(has|is|stops|does|suffers|receives|loses|keeps) `)

func ruleStateLeaf(m map[string]any, subj string) string {
	granted := m["direction"] == "granted"
	rule := ejstr(m["rule"])
	if m["rule_kind"] == "faction-rule" {
		if granted {
			return subj + " " + ev(subj, "gains") + " " + titleCase(rule)
		}
		return subj + " cannot use " + titleCase(rule)
	}
	if rule == "overwatch-against-bearer" {
		can := "cannot"
		if granted {
			can = "can"
		}
		return "your opponent " + can + " target " + subj + " with Overwatch"
	}
	if core, ok := coreRules[rule]; ok && m["rule_kind"] == "core-rule" {
		phrase := core[1]
		if granted {
			phrase = core[0]
		}
		if strings.HasPrefix(phrase, "cannot ") {
			return noneOf(subj) + " " + phrase
		}
		phrase = coreRuleVerbRe.ReplaceAllStringFunc(phrase, func(w string) string { return ev(subj, strings.TrimSpace(w)) + " " })
		if isPlural(subj) {
			phrase = itsWordRe.ReplaceAllString(phrase, "their")
		}
		return subj + " " + phrase
	}
	noun := "ability"
	switch m["rule_kind"] {
	case "keyword":
		noun = "keyword"
	case "core-rule":
		noun = "rule"
	}
	if granted {
		return subj + " " + ev(subj, "gains") + " the " + titleCase(rule) + " " + noun
	}
	return subj + " " + ev(subj, "loses") + " the " + titleCase(rule) + " " + noun
}

// describeLeaf renders one single effect as a lowercase-initial clause.
func describeLeaf(e map[string]any, ctx effCtx) string {
	m := mod(e)
	subj := effectSubject(e["target"], ctx)
	switch e["type"] {
	case "stat-modifier":
		return statModifierLeaf(e, m, subj, ctx)
	case "ignore-modifiers":
		return ignoreModifiersLeaf(m, subj)
	case "roll-modifier":
		return rollModifierLeaf(m, subj)
	case "re-roll":
		return reRollLeaf(e, m, subj, ctx)
	case "roll-result":
		return rollResultLeaf(m, subj)
	case "end-attack-sequence":
		return "the attack sequence ends"
	case "ability-grant":
		return abilityGrantLeaf(m, subj)
	case "keyword-grant":
		return keywordGrantLeaf(m, subj)
	case "weapon-ability-grant":
		return weaponAbilityGrantLeaf(e, m, subj, ctx)
	case "weapon-grant":
		count := m["count"]
		if count == nil {
			count = 1.0
		}
		n := jsNumber(count)
		if math.IsNaN(n) || n == 0 {
			n = 1
		}
		plural := "s"
		if n == 1 {
			plural = ""
		}
		return subj + " " + ev(subj, "gains") + " " + numStr(n) + " " + weaponLabel(m["weapon_id"]) + " weapon" + plural
	case "ability-modifier":
		return abilityModifierLeaf(m, subj, ctx)
	case "ability-activate":
		return abilityActivateLeaf(m, subj)
	case "permission":
		return permissionLeaf(m, subj, ctx)
	case "targeting":
		return targetingLeaf(m, subj, ctx)
	case "counts-as":
		return countsAsLeaf(m, subj, ctx)
	case "rule-state":
		return ruleStateLeaf(m, subj)
	}
	if s, ok := describeShapeLeaf(e, m, subj, ctx); ok {
		return s
	}
	return describeBoardLeaf(e, m, subj, ctx)
}
