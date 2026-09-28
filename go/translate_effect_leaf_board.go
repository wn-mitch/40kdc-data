package wh40kdc

import (
	"math"
	"regexp"
	"strings"
)

// Single effects on the board axes: protection, models, moves, placement,
// tests, resources, designation and army construction. One lowercase-initial
// clause, no period. Mirror of tools/src/translate/effect-leaf-board.ts.

func woundsNoun(n, noun string) string {
	if n == "1" {
		return noun
	}
	return noun + "s"
}

func mortalWoundsLeaf(m map[string]any, subj string) string {
	count := diceCase(m["count"])
	suffered := count + " " + woundsNoun(count, "mortal wound")
	if !isLiteral(m["count"]) {
		suffered = amountOf(m["count"], "mortal wound", "mortal wounds")
	}
	psychic := ""
	if m["psychic"] == true {
		psychic = " (Psychic Attack)"
	}
	// A range the target filter already states is not repeated ("enemy units within 9\" within 9\"").
	rng := ""
	if m["range"] != nil && !strings.Contains(subj, " within "+rangePhrase(m["range"])) {
		rng = " within " + rangePhrase(m["range"])
	}
	who := subj + rng
	if roll, ok := asMap(m["roll"]); ok && roll != nil {
		each := ""
		switch roll["per_model"] {
		case "target":
			each = " for each model in the target unit"
		case "this":
			each = " for each model in this unit"
		}
		dice := diceCase(roll["dice"])
		if each != "" {
			dice = "one " + dice
		}
		return "roll " + dice + each + ": for each " + ejstr(roll["threshold"]) + "+, " + who + " " + ev(who, "suffers") + " " + suffered + psychic
	}
	per := ""
	if m["per"] == "model" {
		them := "it"
		if pronoun(who) == "their" {
			them = "them"
		}
		per = " for each model in " + them
	}
	return who + " " + ev(who, "suffers") + " " + suffered + per + psychic
}

var fnpAgainst = map[string]string{
	"mortal": " against mortal wounds", "psychic": " against Psychic Attacks", "psychic-and-mortal": " against Psychic Attacks and mortal wounds",
}

func destroyModelsLeaf(m map[string]any, subj string) string {
	kind := "model"
	if m["model_keyword"] != nil {
		kind = ejstr(m["model_keyword"]) + " model"
	}
	var what string
	if m["count"] == "all" {
		what = "every " + kind + " in " + subj
	} else {
		n := diceCase(m["count"])
		k := kind + "s"
		if n == "1" {
			k = kind
		}
		what = n + " " + k + " in " + subj
	}
	leader := ""
	if m["exclude_leader"] == true {
		leader = " (excluding Leader models)"
	}
	verb, tail := "destroy", ""
	if m["remove_from_play"] == true {
		verb, tail = "remove", " from play"
	}
	triggers := ""
	if m["ignore_death_triggers"] == true {
		triggers = ", ignoring any rules triggered by their destruction"
	}
	return verb + " " + what + leader + tail + triggers
}

func actOnDeathLeaf(e, m map[string]any, subj string, ctx effCtx) string {
	act := "fight"
	if m["act"] == "shoot" {
		act = "shoot"
	}
	model := "a model in " + subj
	if e["target"] == "event-object" {
		model = "a model in this unit"
	} else if subj == "this model" {
		model = "this model"
	}
	if gate, ok := asMap(m["gate"]); ok && gate != nil {
		before := ""
		if elig, ok := asMap(m["eligibility"]); ok && elig != nil {
			before = " " + conditionLeadIn(elig)
		}
		adds := ""
		for _, g := range getList(gate, "modifiers") {
			gm := mapOr(g)
			adds += ", adding " + ejstr(gm["value"]) + " " + conditionLeadIn(mapOr(gm["condition"]))
		}
		removal := ". Remove it after this unit has fought or at the end of the phase, whichever comes first"
		if m["removal"] == "after-destroyed-model-fights" {
			past := "fought"
			if act == "shoot" {
				past = "shot"
			}
			removal = ". Remove it after it has " + past
		}
		comp := "gte"
		if gate["comparison"] != nil {
			comp = ejstr(gate["comparison"])
		}
		// Under a destroyed trigger the ability's lead-in already names the death: one lead-in only.
		var lead string
		if ctx.destroyedTrigger {
			if before != "" {
				lead = strings.TrimSpace(before) + ", "
			}
		} else {
			lead = "each time " + model + " is destroyed"
			if before != "" {
				lead += "," + before
			}
			lead += ", "
		}
		return lead + "roll one " + diceCase(gate["dice"]) + adds + ". On " +
			formatComparison(comp, gate["threshold"]) + ", leave that model on the battlefield; it can " + act + removal
	}
	switch m["resolution"] {
	case "when-unit-fights":
		return "do not remove " + subj + " yet; when its unit is selected to fight, it can " + act + "; remove it after its unit has finished fighting or at the end of the phase, whichever happens first"
	case "after-attacking-unit-finishes":
		return "do not remove " + subj + " yet; after the attacking unit has finished making its attacks, it can " + act + "; then remove it"
	}
	if ctx.destroyedTrigger {
		who := "that model"
		if model == "this model" {
			who = "this model"
		}
		return who + " can " + act + " before being removed from play"
	}
	return "each time " + model + " is destroyed, it can " + act + " before being removed from play"
}

var moveVerbs = map[string]string{
	"normal": "make a Normal move", "advance": "Advance", "fall-back": "Fall Back", "charge": "declare a charge", "pile-in": "Pile In",
	"consolidation": "Consolidate", "surge": "make a Surge move", "scout": "make a Scout move", "ingress": "make an Ingress move",
	"disembark": "disembark", "embark": "embark", "pulse-jet": "make a Pulse Jet move",
}
var moveNouns = map[string]string{
	"normal": "Normal", "advance": "Advance", "fall-back": "Fall Back", "charge": "Charge", "pile-in": "Pile-in", "consolidation": "Consolidation",
	"surge": "Surge", "scout": "Scout", "ingress": "Ingress", "disembark": "Disembark", "embark": "Embark", "pulse-jet": "Pulse Jet",
}
var passthroughNames = map[string]string{
	"non-titanic-models": "non-Titanic models", "friendly-vehicles": "friendly Vehicle models", "friendly-monsters": "friendly Monster models",
	"terrain-le-4": "terrain features 4\" or lower", "tall-terrain": "terrain features over 4\"", "all-terrain": "terrain features",
	"enemy-models": "enemy models",
}

func passthroughList(p any) string {
	l, _ := asList(p)
	parts := make([]string, len(l))
	for i, x := range l {
		if item, ok := x.(map[string]any); ok {
			parts[i] = passItem(item)
		} else if n, ok := passthroughNames[ejstr(x)]; ok {
			parts[i] = n
		} else {
			parts[i] = dekebab(ejstr(x))
		}
	}
	return andList(parts)
}

func moveLeaf(m map[string]any, subj string, ctx effCtx) string {
	verb, ok := moveVerbs[ejstr(m["move_type"])]
	if !ok {
		verb = "make a " + dekebab(ejstr(m["move_type"])) + " move"
	}
	upTo := ""
	if m["distance"] != nil {
		if strings.HasPrefix(verb, "make ") {
			upTo = " of up to " + diceCase(m["distance"]) + "\""
		} else {
			upTo = " up to " + diceCase(m["distance"]) + "\""
		}
	}
	s := subj + " can " + verb + upTo + moveModeClause(m)
	if _, ok := asList(m["passthrough"]); ok {
		s += ", moving over " + passthroughList(m["passthrough"]) + " as though they were not there"
	}
	if ends, ok := asMap(m["ends_within"]); ok && ends != nil {
		wholly := ""
		if ends["wholly"] == true {
			wholly = "wholly "
		}
		s += ", ending that move " + wholly + "within " + rangePhrase(ends["range"]) + " of " + endsOf(ends["of"], ctx)
	}
	if m["allow_engagement"] == true {
		s += "; it can end that move within Engagement Range of enemy units"
	}
	if m["counts_as_move"] != nil {
		s += "; that move counts as " + movedPhrase(m["counts_as_move"])
	}
	if m["keeps_eligible"] == true {
		s += "; doing so does not change what it is eligible to do this turn"
	}
	return s
}

func moveModifierLeaf(m map[string]any, subj string) string {
	kinds := ""
	if l, ok := asList(m["applies_to_moves"]); ok {
		parts := make([]string, len(l))
		for i, x := range l {
			if n, ok := moveNouns[ejstr(x)]; ok {
				parts[i] = n
			} else {
				parts[i] = dekebab(ejstr(x))
			}
		}
		kinds = andList(parts)
	}
	var clauses []string
	if m["distance_bonus"] != nil {
		n := jsNumber(m["distance_bonus"])
		moves := "Move characteristic"
		if kinds != "" {
			moves = kinds + " moves"
		}
		if !math.IsNaN(n) && n < 0 {
			clauses = append(clauses, "subtract "+numStr(math.Abs(n))+"\" from "+ofOrPossessive(subj, moves))
		} else {
			clauses = append(clauses, "add "+diceCase(m["distance_bonus"])+"\" to "+ofOrPossessive(subj, moves))
		}
	}
	if m["advance"] == "fixed-6" {
		clauses = append(clauses, subj+" "+ev(subj, "does")+" not make an Advance roll; add 6\" to "+pronoun(subj)+" Move characteristic instead")
	}
	if _, ok := asList(m["passthrough"]); ok {
		clauses = append(clauses, subj+" can move over "+passthroughList(m["passthrough"])+" as though they were not there")
	}
	if m["no_end_in_engagement"] == true {
		clauses = append(clauses, subj+" cannot end a move within Engagement Range of any enemy unit")
	}
	if m["end_on_terrain"] == true {
		clauses = append(clauses, subj+" can end "+pronoun(subj)+" moves on top of terrain features")
	}
	if m["ignore_vertical"] == true {
		moves := "it moves"
		if pronoun(subj) == "their" {
			moves = "they move"
		}
		clauses = append(clauses, subj+" "+ev(subj, "ignores")+" vertical distances when "+moves)
	}
	s := strings.Join(clauses, "; ")
	if kinds != "" && m["distance_bonus"] == nil {
		return s + ", during " + pronoun(subj) + " " + kinds + " moves"
	}
	return s
}

var setUpOrdinals = []string{"", "first", "second", "third", "fourth", "fifth"}
var trailingMarkerRe = regexp.MustCompile(`(?i) marker$`)
var leadingVowelRe = regexp.MustCompile(`(?i)^[aeiou]`)
var lastCommaRe = regexp.MustCompile(`, ([^,]*)$`)

func setUpLeaf(m map[string]any, subj string, ctx effCtx) string {
	who := subj
	if m["subject"] == "models-on-this-model" {
		who = "the models on this model"
	} else if m["subject"] != nil {
		who = effectSubject(m["subject"], ctx)
	}
	limits := ""
	if m["ignore_limits"] == true {
		limits = ", ignoring any limits on units in Strategic Reserves"
	}
	can, whoCan := "can", who
	if m["allow"] == false {
		can, whoCan = "cannot", noneOf(who)
	} else if m["mandatory"] == true {
		can = "must"
	}
	if m["to"] == "strategic-reserves" {
		return whoCan + " " + can + " be placed into Strategic Reserves" + limits
	}
	from := ""
	switch m["from"] {
	case "strategic-reserves":
		from = " from Strategic Reserves"
	case "transport":
		from = " from its Transport"
	}
	var s string
	if m["from"] == "battlefield" {
		s = whoCan + " " + can + " be removed from the battlefield and set up again"
	} else {
		s = whoCan + " " + can + " be set up on the battlefield" + from
	}
	if m["via"] == "deep-strike" {
		s += " using the Deep Strike rules"
	}
	s += moveModeClause(m)
	if turns, ok := asList(m["turns"]); ok {
		parts := make([]string, len(turns))
		for i, t := range turns {
			n, isNum := t.(float64)
			if isNum && n == math.Trunc(n) && n >= 0 && int(n) < len(setUpOrdinals) {
				parts[i] = setUpOrdinals[int(n)]
			} else {
				parts[i] = ejstr(t) + "th"
			}
		}
		s += " in the Reinforcements step of your " + lastCommaRe.ReplaceAllString(strings.Join(parts, ", "), " or $1") + " Movement phase"
	}
	if m["arrives"] == "next-movement-phase" {
		s += " in the Reinforcements step of your next Movement phase"
		if m["allow_first_round"] == true {
			s += " (even in the first battle round)"
		}
	}
	if m["sections"] != nil {
		s += " as " + ejstr(m["sections"]) + " separate sections"
	}
	s += placementPhrase(m) + placementLimits(m, ctx)
	if m["within_edge"] != nil {
		s += " wholly within " + ejstr(m["within_edge"]) + "\" of a battlefield edge"
	}
	if m["min_enemy_distance"] != nil {
		s += " more than " + ejstr(m["min_enemy_distance"]) + "\" away from all enemy models"
	}
	if md, ok := asMap(m["min_distance_from"]); ok && md != nil {
		rel, of := "more than", " away from"
		if m["allow"] == false {
			rel, of = "within", " of"
		}
		origin := "this model"
		if md["of"] != nil {
			origin = effectSubject(md["of"], ctx)
		}
		s += " " + rel + " " + rangePhrase(md["range"]) + of + " " + origin
	}
	if m["round_offset"] != nil {
		n := jsNumber(m["round_offset"])
		dir := "higher"
		if n < 0 {
			dir = "lower"
		}
		s += ", treating the battle round as " + numStr(math.Abs(n)) + " " + dir + " than it is"
	}
	if m["allow_engagement"] == true {
		s += "; it can be set up within Engagement Range of enemy units"
	}
	if m["counts_as_move"] != nil {
		s += "; it counts as having made " + movedPhrase(m["counts_as_move"]) + " this turn"
	}
	return s + limits
}

func markerLeaf(m map[string]any) string {
	// A label that already ends in "marker" ("cult-ambush-marker") must not read "marker marker".
	label := replaceFirst(trailingMarkerRe, dekebab(ejstr(m["label"])), "")
	consume := ""
	if m["consume"] == "on-use" {
		consume = "; using the marker consumes it"
	}
	if m["operation"] == "relocate" {
		dist := ""
		if m["distance"] != nil {
			dist = " up to " + ejstr(m["distance"]) + "\""
		}
		return "move the " + label + " marker" + dist + consume
	}
	where := ""
	if m["placement"] != nil {
		where = " " + dekebab(ejstr(m["placement"]))
	}
	article := "a"
	if leadingVowelRe.MatchString(label) {
		article = "an"
	}
	return "place " + article + " " + label + " marker" + where + consume
}

// describeBoardLeaf renders the board-axis leaves; anything unknown degrades to [type].
func describeBoardLeaf(e, m map[string]any, subj string, ctx effCtx) string {
	switch e["type"] {
	case "mortal-wounds":
		return mortalWoundsLeaf(m, subj)
	case "damage-reduction":
		r := ejstr(m["reduction"])
		how := "subtract " + r + " from the Damage characteristic of that attack"
		switch r {
		case "half":
			how = "halve the Damage of that attack"
		case "to-zero":
			how = "change the Damage of that attack to 0"
		}
		attack := "an attack"
		if hasWeapon(m) {
			attack = "an attack with " + weaponNoun(m)
		}
		return "each time " + attack + " is allocated to " + subj + ", " + how
	case "feel-no-pain":
		return subj + " " + ev(subj, "has") + " the Feel No Pain " + ejstr(m["threshold"]) + "+ ability" + fnpAgainst[ejstr(m["against"])]
	case "invulnerable-save":
		vs := ""
		if m["weapon_type"] != nil {
			vs = " against " + ejstr(m["weapon_type"]) + " attacks"
		}
		return subj + " " + ev(subj, "has") + " a " + ejstr(m["invuln_sv"]) + "+ invulnerable save" + vs
	case "heal":
		who := subj
		if m["per"] == "model" {
			who = "each model in " + subj
		}
		if m["amount"] == "full" {
			return who + " " + ev(who, "regains") + " all " + pronoun(who) + " lost wounds"
		}
		if !isLiteral(m["amount"]) {
			return who + " " + ev(who, "regains") + " up to " + amountOf(m["amount"], "lost wound", "lost wounds")
		}
		amount := diceCase(m["amount"])
		return who + " " + ev(who, "regains") + " up to " + amount + " lost " + woundsNoun(amount, "wound")
	case "return-models":
		return returnModelsLeaf(e, m, subj, ctx)
	case "destroy-models":
		return destroyModelsLeaf(m, subj)
	case "act-on-death":
		return actOnDeathLeaf(e, m, subj, ctx)
	case "split-unit":
		if m["by"] == "model" {
			return "split " + subj + " into units of one model each"
		}
		if by, ok := asMap(m["by"]); ok && by != nil && jsTruthy(by["model_keyword"]) {
			return "split " + subj + " into one unit of each of its " + andList(jstrList(by["model_keyword"])) + " models"
		}
		counts := jstrList(m["model_counts"])
		return "split " + subj + " into " + numStr(float64(len(counts))) + " units of " + andList(counts) + " models"
	case "add-unit":
		return addUnitLeaf(m, ctx)
	case "destruction-rule":
		return subj + " " + ev(subj, "is") + " not destroyed until " + effectSubject(m["also"], ctx) + " is also destroyed"
	case "move":
		return moveLeaf(m, subj, ctx)
	case "move-modifier":
		return moveModifierLeaf(m, subj)
	case "set-up":
		return setUpLeaf(m, subj, ctx)
	case "marker":
		return markerLeaf(m)
	case "transport-capacity":
		return transportCapacityLeaf(m)
	case "test":
		return testLeaf(m, subj)
	case "state-change":
		if m["set"] == false {
			return subj + " " + ev(subj, "is") + " no longer Battle-shocked"
		}
		return subj + " " + ev(subj, "is") + " Battle-shocked"
	case "cp-gain":
		n := jsNumber(m["amount"])
		if n < 0 {
			return "you lose " + numStr(math.Abs(n)) + "CP"
		}
		return "you gain " + ejstr(m["amount"]) + "CP"
	case "cost-modifier":
		return costModifierLeaf(m, subj)
	case "resource-gain":
		if _, ok := m["amount"].(map[string]any); ok {
			return "you gain " + amountOf(m["amount"], resourceNoun(m["pool"], m["label"], 1.0), resourceNoun(m["pool"], m["label"], 2.0))
		}
		amount := diceCase(m["amount"])
		switch m["amount"] {
		case "variable":
			amount = "a number of"
		case "any":
			amount = "any number of"
		}
		return "you gain " + amount + " " + resourceNoun(m["pool"], m["label"], m["amount"])
	case "resource-spend":
		amount := diceCase(m["amount"])
		count := m["amount"]
		switch m["amount"] {
		case "all":
			amount, count = "all your", 2.0
		case "one-or-more":
			amount = "one or more"
		}
		showing := ""
		if m["face"] != nil {
			showing = " showing a " + ejstr(m["face"])
		} else if m["requirement"] != nil {
			showing = " forming a " + requirementPhrase(m["requirement"])
		}
		noun := resourceNoun(m["pool"], m["label"], count)
		// A face or a pair/triple is only said of dice: "3 Blessings of Khorne dice forming a triple of 6+".
		if showing != "" && !dieDiceSuffixRe.MatchString(noun) {
			if jsNumber(ejstr(m["amount"])) == 1 {
				noun += " die"
			} else {
				noun += " dice"
			}
		}
		return "spend " + amount + " " + noun + showing
	case "resource-die":
		return resourceDieLeaf(m)
	case "objective-sticky":
		return "objective markers " + subj + " " + ev(subj, "controls") + " remain under your control until your opponent's Level of Control over them is greater than yours at the end of a phase"
	case "designate":
		return designateLeaf(m, subj, ctx)
	case "army-rule":
		return armyRuleLeaf(m, subj, ctx)
	}
	t := "unknown"
	if e["type"] != nil {
		t = ejstr(e["type"])
	}
	return "[" + t + "]"
}
