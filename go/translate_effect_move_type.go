package wh40kdc

// The move-type container: a move type an army rule defines (Special Move Types), as a named mode of a
// core move or a move of its own, with what applies before, while and after a unit makes it.
// Mirrors tools/src/translate/effect-move-type.ts.

import "strings"

var moveTypeNames = map[string]string{
	"normal": "Normal", "advance": "Advance", "fall-back": "Fall Back", "charge": "Charge", "pile-in": "Pile-in", "consolidation": "Consolidation",
	"surge": "Surge", "scout": "Scout", "ingress": "Ingress", "disembark": "Disembark", "embark": "Embark", "pulse-jet": "Pulse Jet",
}

// moveTypeTitled title-cases each hyphen-separated word of a slug: "pulse-jet" -> "Pulse Jet".
func moveTypeTitled(slug string) string {
	words := strings.Split(slug, "-")
	for i, w := range words {
		words[i] = capitalize(w)
	}
	return strings.Join(words, " ")
}

// moveTypeHead: "Shock Disembark Move (the shock mode of a Disembark move)".
func moveTypeHead(e map[string]any) string {
	slug := ejstr(e["move_type"])
	move, ok := moveTypeNames[slug]
	if !ok {
		move = moveTypeTitled(slug)
	}
	if e["mode"] == nil {
		return ejstr(e["name"])
	}
	return ejstr(e["name"]) + " (the " + moveTypeTitled(ejstr(e["mode"])) + " mode of a " + move + " move)"
}

// moveTypeClauses lists each statement the move type makes, as a clause, in the order the app prints them.
func moveTypeClauses(e map[string]any, inline func(any) string) []string {
	out := []string{}
	if e["distance"] != nil {
		out = append(out, "the unit can move up to "+diceCase(e["distance"])+"\"")
	}
	if e["setup_distance"] != nil {
		out = append(out, "each model is set up wholly within "+rangePhrase(e["setup_distance"])+" of that Transport")
	}
	if e["eligible_if"] != nil {
		out = append(out, "a unit can make this move only if "+describeCondition(mapOr(e["eligible_if"])))
	}
	if e["before"] != nil {
		out = append(out, "before it moves, "+inline(e["before"]))
	}
	if e["while"] != nil {
		out = append(out, "while it moves, "+inline(e["while"]))
	}
	if e["after"] != nil {
		out = append(out, "after it moves, "+inline(e["after"]))
	}
	return out
}

func moveTypeInline(e map[string]any, inline func(any) string) string {
	parts := moveTypeClauses(e, inline)
	if len(parts) == 0 {
		return moveTypeHead(e)
	}
	return moveTypeHead(e) + ": " + strings.Join(parts, "; ")
}

func moveTypeBlock(e map[string]any, indent, arrow string, inline func(any) string) string {
	parts := moveTypeClauses(e, inline)
	if len(parts) == 0 {
		return indent + arrow + moveTypeHead(e) + "."
	}
	lines := []string{indent + arrow + moveTypeHead(e) + ":"}
	for _, part := range parts {
		lines = append(lines, indent+"  - "+capitalize(part)+".")
	}
	return strings.Join(lines, "\n")
}
