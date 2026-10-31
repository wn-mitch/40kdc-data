package wh40kdc

// The ritual-menu container: Rituals attempted with a Psychic test, each with its Warp Charge.
// Mirrors tools/src/translate/effect-ritual.ts.

import "strings"

// ritualLimit is the menu's limit on each Ritual.
const ritualLimit = "each Ritual can be attempted once per turn across your army"

// ritualTestPhrase: "take a Psychic test: roll 2D6, and you can roll one additional D6; if any two of
// its dice show the same result, …; if this model is not destroyed and the total of all its dice equals
// or exceeds the Ritual's Warp Charge, this model manifests that Ritual".
func ritualTestPhrase(e map[string]any, inline func(any) string) string {
	test := mapOr(e["test"])
	more := ""
	if extra, ok := test["extra_die"].(map[string]any); ok {
		offer := "roll"
		if extra["optional"] == true {
			offer = "you can roll"
		}
		more = ", and " + offer + " one additional " + diceCase(extra["dice"])
	}
	cost := ""
	if perils, ok := test["perils"].(map[string]any); ok {
		cost = "; if any two of its dice show the same result, " + inline(perils["effect"])
	}
	kind := "a test"
	if test["kind"] != nil {
		kind = rollKindNoun(test["kind"])
	}
	return "take " + kind + ": roll " + diceCase(test["dice"]) + more + cost +
		"; if this model is not destroyed and the total of all its dice equals or exceeds the Ritual's Warp Charge, this model manifests that Ritual"
}

// ritualHead: "Destiny's Ruin (Warp Charge 5)".
func ritualHead(ritual map[string]any) string {
	return ejstr(ritual["name"]) + " (Warp Charge " + ejstr(ritual["warp_charge"]) + ")"
}

func ritualMenuInline(e map[string]any, inline func(any) string) string {
	parts := []string{}
	for _, r := range getList(e, "rituals") {
		ritual := mapOr(r)
		parts = append(parts, ritualHead(ritual)+": "+inline(ritual["effect"]))
	}
	return "attempt one Ritual (" + ritualLimit + "); to do so, " + ritualTestPhrase(e, inline) + ": " + strings.Join(parts, " / ")
}

func ritualMenuBlock(e map[string]any, indent, arrow string, inline func(any) string) string {
	lines := []string{indent + arrow + "Attempt one of the Rituals below (" + ritualLimit + "). To do so, " + ritualTestPhrase(e, inline) + ":"}
	for _, r := range getList(e, "rituals") {
		ritual := mapOr(r)
		lines = append(lines, indent+"  - "+ritualHead(ritual)+": "+capitalize(inline(ritual["effect"]))+".")
	}
	return strings.Join(lines, "\n")
}
