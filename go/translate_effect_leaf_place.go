package wh40kdc

import (
	"regexp"
	"strings"
)

// Board leaves that place models: return-models and add-unit, plus the move
// helpers (typed pass-through items, the ends_within place, the disembark /
// Desperate Escape mode). Mirror of the placement half of
// tools/src/translate/effect-leaf-board.ts.

var dieDiceSuffixRe = regexp.MustCompile(`\b(die|dice)$`)

// woundsLeft is what a set-up or returned model has left: "its full wounds",
// "half of its starting number of wounds", "3 wounds", "D3 wounds".
func woundsLeft(wr any) string {
	if wr == nil || wr == "full" {
		return "its full wounds"
	}
	if wr == "half-starting" {
		return "half of its starting number of wounds"
	}
	if isLiteral(wr) {
		n := diceCase(wr)
		return n + " " + woundsNoun(n, "wound")
	}
	return amountOf(wr, "wound", "wounds")
}

// detachPhrase is ", as a separate unit with a Starting Strength of 1 (it is
// no longer part of its attached unit)".
func detachPhrase(m map[string]any) string {
	if m["detach"] != true {
		return ""
	}
	strength := ""
	if m["starting_strength"] != nil {
		strength = " with a Starting Strength of " + ejstr(m["starting_strength"])
	}
	return ", as a separate unit" + strength + " (it is no longer part of its attached unit)"
}

func returnModelsLeaf(e, m map[string]any, subj string, ctx effCtx) string {
	w := woundsLeft(m["wounds_remaining"])
	where := placementPhrase(m) + placementLimits(m, ctx)
	detach := detachPhrase(m)
	if e["target"] == "this-model" {
		return subj + " is set up again" + where + " with " + w + " remaining" + detach
	}
	if filter, ok := asMap(e["target"]); ok && filter != nil && filter["level"] == "model" {
		recipients := map[string]any{}
		for key, value := range filter {
			if key != "member_of" {
				recipients[key] = value
			}
		}
		models := strings.TrimPrefix(effectSubject(recipients, ctx), "all ")
		kind := "destroyed " + strings.Replace(models, "models", "model", 1)
		what := amountOf(m["count"], kind, "destroyed "+models)
		if m["count"] == "all" {
			what = "all destroyed " + models
		}
		to := ""
		if filter["member_of"] != nil {
			to = " to " + effectSubject(filter["member_of"], ctx)
		}
		return "return " + what + to + where + ", each with " + w + " remaining" + detach
	}
	kind := "destroyed model"
	what := amountOf(m["count"], kind, kind+"s")
	if m["count"] == "all" {
		what = "all " + kind + "s"
	}
	return "return " + what + " to " + subj + where + ", each with " + w + " remaining" + detach
}

func addUnitLeaf(m map[string]any, ctx effCtx) string {
	where := placementPhrase(m) + placementLimits(m, ctx)
	engage := ""
	if m["allow_engagement_with"] != nil {
		engage = "; it can be set up within Engagement Range of " + effectSubject(m["allow_engagement_with"], ctx)
	}
	models := ""
	if m["model_count"] != nil {
		models = " containing " + amountOf(m["model_count"], "model", "models")
	}
	strength := ""
	if m["starting_strength"] != nil {
		strength = " with a Starting Strength of " + ejstr(m["starting_strength"])
	}
	sheet := titleCase(ejstr(m["datasheet"]))
	// New models that join an existing unit rather than forming their own.
	if m["join"] != nil {
		q := m["model_count"]
		if q == nil {
			q = m["count"]
		}
		if q == nil {
			q = 1.0
		}
		return "add " + amountOf(q, sheet+" model", sheet+" models") + " to " + effectSubject(m["join"], ctx) + where + engage
	}
	literal := isLiteral(m["count"])
	c := m["count"]
	if c == nil {
		c = 1.0
	}
	n := jsNumber(c)
	if !literal {
		n = jsNumber(nil)
	}
	var what string
	if m["copy_of"] != nil {
		units := amountOf(m["count"], "new unit", "new units")
		switch {
		case n == 1:
			units = "a new unit"
		case literal:
			units = jsNumStr(n) + " new units"
		}
		excluded := ""
		if l, ok := asList(m["excluded_keywords"]); ok {
			excluded = " (excluding " + orList(jstrList(l)) + " models)"
		}
		what = units + " identical to " + effectSubject(m["copy_of"], ctx) + excluded
	} else {
		switch {
		case n == 1:
			what = "a " + sheet + " unit"
		case literal:
			what = jsNumStr(n) + " " + sheet + " units"
		default:
			what = amountOf(m["count"], sheet+" unit", sheet+" units")
		}
	}
	full := ""
	if m["at_starting_strength"] == true {
		full = ", at its Starting Strength and with all of its wounds remaining"
	}
	oneShot := ""
	if m["reset_one_shot"] == true {
		oneShot = ", with its [ONE SHOT] weapons counted as not having been shot"
	}
	// Where the unit goes comes first, then what it comes back with.
	return "add " + what + models + strength + " to your army" + where + full + oneShot + engage
}

// passItem renders a typed pass-through item: "models (excluding MONSTER and
// VEHICLE models)", "terrain features 4\" or lower".
func passItem(x map[string]any) string {
	if x["kind"] == "terrain" {
		switch x["height"] {
		case "up-to-4":
			return "terrain features 4\" or lower"
		case "over-4":
			return "terrain features over 4\""
		}
		return "terrain features"
	}
	owner := ""
	switch x["owner"] {
	case "friendly":
		owner = "friendly "
	case "enemy":
		owner = "enemy "
	}
	all := ""
	if l, ok := asList(x["all_of"]); ok {
		words := make([]string, len(l))
		for i, k := range l {
			words[i] = titleCase(strings.ToLower(ejstr(k)))
		}
		all = strings.Join(words, " ") + " "
	}
	excl := ""
	if l, ok := asList(x["excluding"]); ok {
		excl = " (excluding " + andList(jstrList(l)) + " models)"
	}
	return owner + all + "models" + excl
}

// endsOf keeps a unit-ref's effect-subject phrase; markers, objectives and
// edges read as places.
func endsOf(of any, ctx effCtx) string {
	if of == nil {
		return "this model"
	}
	place := false
	switch o := of.(type) {
	case string:
		place = strings.HasPrefix(o, "battlefield-")
	case map[string]any:
		place = o["marker"] != nil || o["objective"] != nil
	}
	if place {
		return placePhrase(of, ctx)
	}
	return effectSubject(of, ctx)
}

// moveModeClause renders " using the Assault Disembarkation rules" or " using
// the Desperate Escape rules".
func moveModeClause(m map[string]any) string {
	if m["mode"] == nil {
		return ""
	}
	mode := titleCase(ejstr(m["mode"]))
	if m["move_type"] == "disembark" || m["from"] == "transport" {
		return " using the " + mode + " Disembarkation rules"
	}
	return " using the " + mode + " rules"
}
