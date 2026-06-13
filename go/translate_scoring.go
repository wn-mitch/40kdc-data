package wh40kdc

// Humanize a secondary-card scoring award into plain English. ASCII-only,
// fixed clause order, pinned by conformance/scoring-translation. Go mirror of
// python .../translate/scoring.py.

// capitalize upper-cases the first byte (output is ASCII-only by design, so a
// byte-level upper matches Python's s[0].upper() + s[1:]).
func capitalize(s string) string {
	if s == "" {
		return ""
	}
	b := []byte(s)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 32
	}
	return string(b)
}

func describeTrigger(t map[string]any) string {
	turn := "your"
	switch t["player_turn"] {
	case "opponent-turn":
		turn = "the opponent's"
	case "either":
		turn = "any"
	}
	timing, _ := t["timing"].(string)
	phase, _ := t["phase"].(string)
	var base string
	switch timing {
	case "start-of-turn":
		base = "Start of " + turn + " turn"
	case "end-of-turn":
		base = "End of " + turn + " turn"
	case "start-of-phase":
		base = "Start of " + turn + " " + capitalize(phase) + " phase"
	case "end-of-phase":
		base = "End of " + turn + " " + capitalize(phase) + " phase"
	case "end-of-battle":
		base = "End of the battle"
	default:
		if phase != "" {
			base = "During " + turn + " " + capitalize(phase) + " phase"
		} else {
			base = "Any time"
		}
	}
	if br, ok := getMap(t, "battle_round"); ok && br != nil {
		minV, hasMin := br["min"], br["min"] != nil
		maxV, hasMax := br["max"], br["max"] != nil
		switch {
		case hasMin && hasMax:
			if numStr(minV) == numStr(maxV) {
				base += " (round " + cstr(minV) + ")"
			} else {
				base += " (rounds " + cstr(minV) + "-" + cstr(maxV) + ")"
			}
		case hasMin:
			base += " (round " + cstr(minV) + "+)"
		case hasMax:
			base += " (rounds 1-" + cstr(maxV) + ")"
		}
	}
	return base
}

func describeAward(a map[string]any) string {
	trigger := "Any time"
	if tr, ok := getMap(a, "trigger"); ok && tr != nil {
		trigger = describeTrigger(tr)
	}
	var amount string
	switch {
	case a["vp"] != nil:
		amount = cstr(a["vp"]) + " VP"
	case a["vp_per"] != nil:
		per := "instance"
		if a["per"] != nil && truthy(a["per"]) {
			per = dekebab(cstr(a["per"]))
		}
		amount = cstr(a["vp_per"]) + " VP per " + per
		if a["per_max"] != nil {
			amount += " (max " + cstr(a["per_max"]) + ")"
		}
	default:
		amount = "no VP"
	}
	prefix := ""
	if truthy(a["cumulative"]) {
		prefix = "+ "
	}
	when := ""
	if w, ok := getMap(a, "when"); ok && w != nil {
		when = " when " + describeCondition(w)
	}
	tier := ""
	if truthy(a["exclusive_group"]) {
		tier = " [highest tier]"
	}
	return prefix + trigger + ": " + amount + when + tier
}

func describeScoringCard(card map[string]any) []string {
	out := []string{}
	for _, aAny := range getList(card, "awards") {
		a, _ := asMap(aAny)
		out = append(out, describeAward(a))
	}
	return out
}
