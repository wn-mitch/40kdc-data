package wh40kdc

import (
	"regexp"
	"strings"
)

// The binding containers of the phase-4 shapes -- `roll` (one roll whose result
// nested numeric fields and dice gates share) and `select-objective` (bind
// objective markers for the nested effect) -- and the placement phrases shared
// by set-up, add-unit and return-models. Mirror of
// tools/src/translate/{effect-bind,effect-placement}.ts.

var poolSuffixRe = regexp.MustCompile(`-pool$`)

// rollHead renders "roll 8D6, plus one D6 for each die in your Blessings of
// Khorne pool (a Blessings of Khorne roll)".
func rollHead(e map[string]any) string {
	extra := ""
	if pool, ok := e["extra_dice_pool"].(string); ok {
		extra = ", plus one D6 for each die in your " + titleCase(poolSuffixRe.ReplaceAllString(pool, "")) + " pool"
	}
	kind := ""
	if e["kind"] != nil {
		kind = " (" + rollKindNoun(e["kind"]) + ")"
	}
	return "roll " + diceCase(e["dice"]) + extra + kind
}

// objectiveSelectorPhrase renders a canonical objective selector including
// inclusive cardinality, eligibility, binding and per-target allowance.
func objectiveSelectorPhrase(sel map[string]any) string {
	count, plural := selectorCountPhrase(sel)
	noun := "objective marker"
	if plural {
		noun = "objective markers"
	}
	base := objectivePhrase(mapOr(sel["filter"]), false, noun)
	eligibility := ""
	if condition, ok := asMap(sel["eligibility"]); ok && condition != nil {
		eligibility = " " + describeSelectionEligibility(condition)
	}
	return count + " " + base + eligibility + selectionBinding(sel) + selectionLimitCanonical(sel, "objective marker")
}

func objectiveSelectionLimit(sel map[string]any) string {
	limit, ok := asMap(sel["limit"])
	if !ok || limit == nil {
		return ""
	}
	times := ejstr(limit["count"]) + " times"
	if jsNumber(limit["count"]) == 1 {
		times = "once"
	}
	return " (each objective marker can be selected for this ability at most " + times + " per " + strings.ReplaceAll(ejstr(limit["period"]), "-", " ") + ")"
}

func selectObjectiveLead(sel map[string]any) string {
	verb := "select"
	if sel["count"] == "each" {
		verb = "for"
	}
	return verb + " " + objectiveSelectorPhrase(sel) + objectiveSelectionLimit(sel)
}

// selectObjectiveInline renders select-objective on one line: "select one
// objective marker ...: <effect>".
func selectObjectiveInline(e map[string]any, inline func(any) string) string {
	return selectObjectiveLead(mapOr(e["selector"])) + ": " + inline(e["effect"])
}

// selectObjectiveBlock renders select-objective as a header line and the
// nested effect one level deeper (hasNested), else the effect inline.
func selectObjectiveBlock(e map[string]any, indent, arrow, nested string, hasNested bool, inline func(any) string) string {
	head := indent + arrow + capitalize(selectObjectiveLead(mapOr(e["selector"])))
	if hasNested {
		return head + ":\n" + nested
	}
	return head + ": " + inline(e["effect"]) + "."
}

var placementPhrases = map[string]string{
	"closest-to-destruction": "as close as possible to where it was destroyed",
	"closest-to-original":    "as close as possible to its original position",
	"coherency":              "in Unit Coherency",
	"unengaged":              "not within Engagement Range of any enemy units",
	"strategic-reserves":     "in Strategic Reserves",
	"cult-ambush":            "in Cult Ambush",
	"anywhere":               "anywhere on the battlefield",
	"connected-sections":     "with its sections touching",
	"deployment-zone":        "wholly within your deployment zone",
	"on-terrain":             "on top of a terrain feature",
}

// placementPhrase renders a placement keyword, or a list of them that all
// apply, with the legacy `range` for (wholly) within; " ..." or "".
func placementPhrase(m map[string]any) string {
	var list []any
	if l, ok := asList(m["placement"]); ok {
		list = l
	} else if m["placement"] != nil {
		list = []any{m["placement"]}
	}
	parts := make([]string, 0, len(list))
	for _, p := range list {
		k := ejstr(p)
		switch k {
		case "wholly-within":
			parts = append(parts, "wholly within "+rangePhrase(m["range"])+" of this model")
		case "within":
			parts = append(parts, "within "+rangePhrase(m["range"])+" of this model")
		default:
			if ph, ok := placementPhrases[k]; ok {
				parts = append(parts, ph)
			} else {
				parts = append(parts, dekebab(k))
			}
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return " " + andList(parts)
}

var placeMarkerSuffixRe = regexp.MustCompile(`(?i) marker$`)

// placePhrase names something a distance is measured to: a unit, an objective
// marker, a named marker, an edge or the centre.
func placePhrase(of any, ctx effCtx) string {
	switch of {
	case "battlefield-edge":
		return "a battlefield edge"
	case "battlefield-centre":
		return "the centre of the battlefield"
	}
	if o, ok := of.(map[string]any); ok {
		if o["marker"] != nil {
			label := placeMarkerSuffixRe.ReplaceAllString(dekebab(ejstr(o["marker"])), "")
			return article(label) + " " + label + " marker"
		}
		// The enemy deployment zone (a region-ref place): the printed name.
		if o["territory"] != nil {
			if o["territory"] == "enemy-deployment-zone" {
				return "your opponent's deployment zone"
			}
			return dekebab(ejstr(o["territory"]))
		}
		if o["objective"] != nil {
			objective := mapOr(o["objective"])
			if objective["selection_var"] != nil {
				return "that objective marker"
			}
			obj := objectivePhrase(objective, false, "objective marker")
			return article(obj) + " " + obj
		}
	}
	if of == nil {
		of = "this-model"
	}
	return strings.TrimPrefix(effectSubject(of, ctx), "all ")
}

// awayPhrase reads away-from targets as models: a bare enemy filter is "all enemy models".
func awayPhrase(of any, ctx effCtx) string {
	if o, ok := of.(map[string]any); ok && len(o) == 1 && o["owner"] == "enemy" {
		return "all enemy models"
	}
	return placePhrase(of, ctx)
}

// placementLimits renders the near / away_from / in_region lists as trailing
// limits joined with " and "; " ..." or "".
func placementLimits(m map[string]any, ctx effCtx) string {
	var parts []string
	near, _ := asList(m["near"])
	for _, nAny := range near {
		n := mapOr(nAny)
		wholly := ""
		if n["wholly"] == true {
			wholly = "wholly "
		}
		parts = append(parts, wholly+"within "+rangePhrase(n["range"])+" of "+placePhrase(n["of"], ctx))
	}
	if region, ok := asMap(m["in_region"]); ok && region != nil {
		wholly := ""
		if region["wholly"] == true {
			wholly = "wholly "
		}
		parts = append(parts, wholly+"within "+regionPhrase(mapOr(region["region"])))
	}
	away, _ := asList(m["away_from"])
	if len(away) > 0 {
		items := make([]string, len(away))
		for i, aAny := range away {
			a := mapOr(aAny)
			items[i] = rangePhrase(a["range"]) + " away from " + awayPhrase(a["of"], ctx)
		}
		parts = append(parts, "more than "+andList(items))
	}
	if len(parts) == 0 {
		return ""
	}
	return " " + strings.Join(parts, " and ")
}
