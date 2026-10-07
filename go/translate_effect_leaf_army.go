package wh40kdc

import (
	"math"
	"regexp"
	"strings"
)

// Single effects on the test, resource, designation and army-construction
// axes (tests, CP costs, resource pools, tags, army rules, transport
// capacity). One lowercase-initial clause, no period. Second half of the
// board-axis leaves; mirror of tools/src/translate/effect-leaf-board.ts.

func testLeaf(m map[string]any, subj string) string {
	c := m["count"]
	if c == nil {
		c = 1.0
	}
	n := jsNumber(c)
	tests := numStr(n) + " " + testName(m["test"]) + " tests"
	if n == 1 {
		tests = "a " + testName(m["test"]) + " test"
	}
	per := ""
	if m["per"] != nil {
		per = " for each " + dekebab(ejstr(m["per"]))
	}
	md := ""
	if m["modifier"] != nil {
		which := "those tests"
		if n == 1 && per == "" {
			which = "that test"
		}
		md = ", applying " + esigned("add", m["modifier"]) + " to " + which
	}
	return subj + " must take " + tests + per + md
}

func costModifierLeaf(m map[string]any, subj string) string {
	noun := "Stratagem"
	switch m["of"] {
	case "manoeuvre":
		noun = "manoeuvre"
	case "ability":
		noun = "ability"
	}
	if m["applies_to"] == "the-triggering-use" {
		switch m["operation"] {
		case "decrease":
			return "reduce the CP cost of that use of the " + noun + " by " + ejstr(m["amount"]) + "CP (to a minimum of 0CP)"
		case "increase":
			return "increase the CP cost of that use of the " + noun + " by " + ejstr(m["amount"]) + "CP"
		case "waive":
			return "that use of the " + noun + " costs no CP"
		}
		return "that use of the " + noun + " costs " + ejstr(m["amount"]) + "CP"
	}
	hasID := m["id"] != nil
	which := noun + "s"
	if noun == "ability" {
		which = "abilities"
	}
	if hasID {
		which = "the " + abilityLabel(m["id"]) + " " + noun
	}
	whose := ""
	switch m["applies_to"] {
	case "targeting-this-unit":
		verb := "target"
		if hasID {
			verb = "targets"
		}
		whose = " that " + verb + " " + subj
	case "used-by-this-unit":
		whose = " used by " + subj
	}
	verb := "cost"
	its := "their"
	if hasID {
		verb, its = "costs", "its"
	}
	switch m["operation"] {
	case "waive":
		return which + whose + " can be used without paying " + its + " CP cost"
	case "set":
		return which + whose + " " + verb + " " + ejstr(m["amount"]) + "CP"
	}
	if m["operation"] == "multiply" {
		times := ejstr(m["amount"]) + " times"
		switch m["amount"] {
		case 2.0:
			times = "twice"
		case 3.0:
			times = "three times"
		}
		return which + whose + " " + verb + " " + times + " " + its + " stated CP cost"
	}
	amount := m["amount"]
	if amount == nil {
		amount = 1.0
	}
	dir := "more"
	if m["operation"] == "decrease" {
		dir = "less"
	}
	return which + whose + " " + verb + " " + ejstr(amount) + "CP " + dir
}

func resourceDieLeaf(m map[string]any) string {
	pool := resourceNoun(m["pool"], nil, nil)
	if m["operation"] == "substitute" {
		rolls := []string{"dice"}
		if l, ok := asList(m["rolls"]); ok {
			rolls = make([]string, len(l))
			for i, r := range l {
				rolls[i] = rollName(r)
			}
		}
		return "discard a die from your " + pool + " and use its value in place of a " + strings.Join(rolls, " or ") + " roll"
	}
	shown := ejstr(m["value"])
	if m["value"] == "highest" {
		shown = "the highest result"
	}
	if m["count_per_pool"] != nil {
		per := resourceNoun(m["count_per_pool"], nil, nil)
		die := "one die showing " + shown
		if m["value"] == "rolled" {
			die = "one rolled D6"
		}
		lost := ""
		if m["consumes_pool"] == true {
			lost = ", after which all your " + per + " are lost"
		}
		return "add " + die + " to your " + pool + " for each " + per + " you have" + lost
	}
	if m["count"] != nil && !isLiteral(m["count"]) {
		if m["value"] == "rolled" {
			return "add " + amountOf(m["count"], "rolled D6", "rolled D6") + " to your " + pool
		}
		return "add " + amountOf(m["count"], "die", "dice") + " to your " + pool
	}
	cnt := "1"
	if m["count"] != nil {
		cnt = diceCase(m["count"])
	}
	if m["value"] == "rolled" {
		if cnt == "1" {
			return "add a rolled D6 to your " + pool
		}
		return "add " + cnt + " rolled D6 to your " + pool
	}
	dice := cnt + " dice"
	if cnt == "1" {
		dice = "a die"
	}
	return "add " + dice + " showing " + shown + " to your " + pool
}

func designateLeaf(m map[string]any, subj string, ctx effCtx) string {
	what := subj
	if s := m["subject"]; s != nil {
		if so, ok := asMap(s); ok && so != nil && so["objective"] != nil {
			what = "the " + objectivePhrase(mapOr(so["objective"]), false, "objective")
			if mapOr(so["objective"])["selection_var"] != nil {
				what = "that objective marker"
			}
		} else if ok && so != nil && so["terrain_area"] != nil {
			what = regionPhrase(map[string]any{"terrain_area": so["terrain_area"]})
		} else {
			what = effectSubject(s, ctx)
		}
	}
	tag := designationFor(ejstr(m["tag"]))
	until := ""
	switch m["clears_on"] {
	case "turn-rollover":
		until = " until the end of the turn"
	case "phase-end":
		until = " until the end of the phase"
	default:
		if trail := expiryTrail(m["clears_on"]); trail != "" && m["clears_on"] != "battle" {
			until = " " + trail
		}
	}
	if m["clear"] == true {
		return what + " " + ev(what, "is") + " no longer " + tag
	}
	by := ""
	if m["by"] != nil {
		by = " by " + effectSubject(m["by"], ctx)
	}
	return what + " " + ev(what, "is") + " " + tag + by + until
}

// armyGroupWhat renders a list-building group: its unit-filter, its datasheets
// ("Alpha Squad or Beta Squad units"), or both.
func armyGroupWhat(m map[string]any, withF string, hasWith bool) (string, bool) {
	sheetsList, ok := m["datasheets"].([]any)
	if !ok {
		return withF, hasWith
	}
	names := make([]string, 0, len(sheetsList))
	for _, d := range sheetsList {
		names = append(names, titleCase(ejstr(d)))
	}
	sheets := orList(names)
	if hasWith {
		return withF + " (" + sheets + " only)", true
	}
	return sheets + " units", true
}

var modelsSpaceWordRe = regexp.MustCompile(` models\b`)
var vowelStartRe = regexp.MustCompile(`(?i)^[aeiou]`)

// armySingular renders the singular of a plural group: "CHARACTER unit".
func armySingular(group string) string {
	return replaceFirst(modelsSpaceWordRe, replaceFirst(unitsWordRe, group, " unit"), " model")
}

func armyRuleLeaf(m map[string]any, subj string, ctx effCtx, target any) string {
	withF, hasWith := "", false
	if m["with"] != nil {
		withF, hasWith = leadingAllRe.ReplaceAllString(effectSubject(m["with"], ctx), ""), true
	}
	group, hasGroup := armyGroupWhat(m, withF, hasWith)
	switch m["rule"] {
	case "warlord-required":
		return subj + " must be your Warlord"
	case "warlord-forbidden":
		return subj + " cannot be your Warlord"
	case "unique":
		if hasGroup {
			return "your army can include only one " + armySingular(group)
		}
		return "your army can include only one of " + subj
	case "enhancement-forbidden":
		return subj + " cannot be given Enhancements"
	case "enhancement-source":
		return subj + " can only be given Enhancements from this Detachment"
	case "limit-exemption":
		return limitExemptionLeaf(m, subj, target)
	case "enhancement-slot":
		each := "such unit"
		if hasWith {
			each = replaceFirst(unitsWordRe, withF, " unit")
		}
		max := ""
		if m["max"] != nil {
			max = "up to " + ejstr(m["max"]) + " "
		}
		kind := ""
		if m["enhancement_kind"] != nil {
			kind = titleCase(ejstr(m["enhancement_kind"])) + " "
		}
		plural := "s"
		if m["max"] == 1.0 {
			plural = ""
		}
		return "each " + each + " can be given " + max + kind + "Enhancement" + plural
	case "faction-forbidden":
		return "you cannot select " + titleCase(ejstr(m["faction"])) + " as your Army Faction"
	case "single-chapter":
		return "your army can include units from only one Chapter"
	case "detachment-forbidden":
		return "you cannot select the " + titleCase(ejstr(m["detachment"])) + " Detachment"
	case "detachment-tag-exclusive":
		return "you cannot select this Detachment together with another " + titleCase(ejstr(m["tag"])) + " Detachment"
	case "attachment":
		if m["mandatory"] == true {
			return subj + " must be attached to a Leader, or it counts as destroyed"
		}
		if m["can_lead"] != nil {
			return subj + " can also be attached to " + leadingAllRe.ReplaceAllString(effectSubject(m["can_lead"], ctx), "")
		}
		if m["attach_as"] != nil {
			leader := "a Leader"
			if hasWith {
				one := armySingular(withF)
				article := "a"
				if vowelStartRe.MatchString(one) {
					article = "an"
				}
				leader = article + " " + one
			}
			return leader + " that can be attached to " + leadingAllRe.ReplaceAllString(effectSubject(m["attach_as"], ctx), "") + " can also be attached to " + subj
		}
		led := ""
		if m["led_by"] != nil {
			led = " led by a " + titleCase(ejstr(m["led_by"])) + " model"
		}
		return "at the start of the Declare Battle Formations step, " + subj + " can join one friendly unit" + led + ", becoming part of that Bodyguard unit"
	}
	// An allied faction a composition rule admits: "Chaos Daemons units" when no filter names them.
	allied := ""
	if m["faction"] != nil {
		allied = titleCase(ejstr(m["faction"]))
	}
	such := "such units"
	switch {
	case hasGroup && allied != "":
		such = group + " from the " + allied + " faction"
	case hasGroup:
		such = group
	case allied != "":
		such = allied + " units"
	}
	return compositionLimit(m, such, ctx)
}

// limitExemptionLeaf renders the limits the rule's units (or this Detachment's
// Enhancements) are left out of.
func limitExemptionLeaf(m map[string]any, subj string, target any) string {
	items, _ := m["exempt_from"].([]any)
	parts := make([]string, 0, len(items))
	for _, item := range items {
		if item == "enhancement-limit" {
			whose := "Enhancements on " + subj
			if target == nil || target == "this-unit" {
				whose = "Enhancements from this Detachment"
			}
			parts = append(parts, whose+" do not count toward your army's Enhancement limit")
			continue
		}
		limit := "the Retinue limit"
		if item == "strategic-reserves-points" {
			limit = "the points limit for Strategic Reserves"
		}
		parts = append(parts, subj+" "+ev(subj, "does")+" not count toward "+limit)
	}
	return strings.Join(parts, "; ")
}

// compositionLimit renders a composition limit: at most N units / models /
// points of X, per matching unit, outside the Retinue limit. No limit is a
// permission; a limit of 0 forbids.
func compositionLimit(m map[string]any, what string, ctx effCtx) string {
	exempt := ""
	if isList(m["exempt_from"]) {
		exempt = "; they do not count toward the Retinue limit"
	}
	if m["max"] == nil {
		return "your army can include " + what + exempt
	}
	literal := isLiteral(m["max"])
	if literal && jsNumber(m["max"]) == 0 {
		return "your army cannot include " + what + exempt
	}
	measure := ""
	switch m["measure"] {
	case "points":
		measure = "points of "
	case "models":
		measure = "models from "
	}
	max := diceCase(m["max"])
	if literal {
		max = ejstr(m["max"])
	}
	// "at most 1 INQUISITORIAL AGENTS unit", "at most 3 units".
	counted := what
	if literal && jsNumber(m["max"]) == 1 && measure == "" {
		counted = replaceFirst(unitsWordRe, what, " unit")
	}
	per := ""
	if m["per"] != nil {
		per = " for each " + replaceFirst(unitsWordRe, leadingAllRe.ReplaceAllString(effectSubject(m["per"], ctx), ""), " unit") + " in your army"
	}
	return "your army can include at most " + max + " " + measure + counted + per + exempt
}

var unitsWordBoundaryRe = regexp.MustCompile(`\bunits\b`)

// transportCapacityLeaf renders how models count against a Transport's capacity.
func transportCapacityLeaf(m map[string]any) string {
	if m["capacity"] != nil {
		who := " models"
		if m["eligible"] != nil {
			who = " " + replaceFirst(unitsWordBoundaryRe, leadingAllRe.ReplaceAllString(effectSubject(m["eligible"], effCtx{}), ""), "models")
		}
		parts := []string{"this model has a Transport capacity of " + ejstr(m["capacity"]) + who}
		if l, ok := asList(m["space_per_model"]); ok {
			for _, x := range l {
				sp := mapOr(x)
				f := map[string]any{}
				if sp["any_of"] != nil {
					f["any_of"] = sp["any_of"]
				}
				if sp["all_of"] != nil {
					f["all_of"] = sp["all_of"]
				}
				noun := replaceFirst(unitsWordBoundaryRe, leadingAllRe.ReplaceAllString(effectSubject(f, effCtx{}), ""), "models")
				parts = append(parts, noun+" take "+ejstr(sp["slots"])+" spaces each")
			}
		}
		return strings.Join(parts, "; ")
	}
	keyword := ""
	if m["model_keyword"] != nil {
		keyword = titleCase(ejstr(m["model_keyword"]))
	}
	singleModel := m["subject_kind"] == "single-model"
	model := "model in this unit"
	if keyword != "" {
		this := ""
		if singleModel {
			this = "this "
		}
		model = this + keyword + " model"
	} else if singleModel {
		model = "this model"
	}
	eachModel := "each " + model
	if singleModel {
		eachModel = model
	}
	eligibility := mapOr(m["transport_eligibility"])
	qualification := ""
	if eligibility["requires_capacity_keyword"] != nil {
		qualification = " in a Transport able to carry " + titleCase(ejstr(eligibility["requires_capacity_keyword"])) + " models"
	} else if eligibility["embark_as_keyword"] != nil {
		qualification = " when embarking as " + titleCase(ejstr(eligibility["embark_as_keyword"]))
	}
	if m["occupancy_kind"] == "fixed-model-spaces" {
		spaces := jsNumber(m["spaces_per_model"])
		plural := "s"
		if spaces == 1 {
			plural = ""
		}
		return "for Transport capacity" + qualification + ", " + eachModel + " occupies " + jsNumStr(spaces) + " model space" + plural
	}
	if m["occupancy_kind"] == "equivalent-model" {
		equivalent := "model"
		if m["equivalent_model_keyword"] != nil {
			equivalent = titleCase(ejstr(m["equivalent_model_keyword"])) + " model"
		}
		c := m["equivalent_model_count"]
		if c == nil {
			c = 1.0
		}
		count := jsNumber(c)
		plural := "s"
		if count == 1 {
			plural = ""
		}
		return "for Transport capacity" + qualification + ", " + eachModel + " counts as " + jsNumStr(count) + " " + equivalent + plural
	}
	models := jsNumber(m["models_per_group"])
	spaces := jsNumber(m["spaces_per_group"])
	groupModel, groupModels := "model in this unit", "models in this unit"
	if keyword != "" {
		groupModel, groupModels = keyword+" model", keyword+" models"
	}
	subject := "each group of " + jsNumStr(models) + " " + groupModels
	if singleModel {
		subject = model
	} else if models == 1 {
		subject = "each " + groupModel
	}
	spaceNoun := "model spaces"
	if spaces == 1 {
		spaceNoun = "model space"
	}
	return "for Transport capacity" + qualification + ", " + subject + " occupies " + jsNumStr(spaces) + " " + spaceNoun + ", rounding " + ejstr(m["rounding"])
}

// jsNumStr renders a JS number the way template interpolation does (NaN -> "NaN").
func jsNumStr(n float64) string {
	if math.IsNaN(n) {
		return "NaN"
	}
	return numStr(n)
}
