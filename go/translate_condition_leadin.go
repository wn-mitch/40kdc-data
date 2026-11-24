package wh40kdc

import (
	"regexp"
	"strings"
)

// Conditions as sentence lead-ins ("while ...", "if ...", "against ...").
// Part of the condition describer; mirror of tools/src/translate/condition.ts.

// -- Lead-ins -----------------------------------------------------------------

// negatedTargetKeywords renders "against a unit that is not a X or Y": the
// attack's target lacks every listed keyword.
func negatedTargetKeywords(keywords []string) string {
	return "against a unit that is not a " + strings.Join(keywords, " or ")
}

func keywordNames(p map[string]any) string {
	if isList(p["any_of"]) {
		return orList(cstrList(p["any_of"]))
	}
	return andList(cstrList(p["all_of"]))
}

var (
	battleRoundOnwardRe  = regexp.MustCompile(`^during the (\w+) battle round onward$`)
	belowStartingRe      = regexp.MustCompile(` is below Starting Strength$`)
	belowHalfRe          = regexp.MustCompile(` is below Half-strength$`)
	leadingForRe         = regexp.MustCompile(`^for `)
	negatedLeadInWordsRe = regexp.MustCompile(`^(if|while|when|during|in|against) `)
	incomingAttackRe     = regexp.MustCompile(`^against [a-z -]*attacks( |$)`)
	targetIsRe           = regexp.MustCompile(`^while the target is (an? .+)$`)
	whileMakingAttacksRe = regexp.MustCompile(`while making [a-z -]*attacks$`)
)

var leadinTurnOwners = map[string]string{
	"your-turn":     "your",
	"opponent-turn": "your opponent's",
	"either":        "either player's",
}

func matchesLeadIn(c map[string]any, negated bool) string {
	p := paramsOf(c)
	f := mapOr(p["filter"])
	keys := 0
	for key := range f {
		if key != "level" {
			keys++
		}
	}
	if keys == 1 && (f["all_of"] != nil || f["any_of"] != nil) {
		if p["subject"] == "defender" && negated {
			if values, ok := asList(f["all_of"]); ok && len(values) > 1 {
				return "against a unit that does not have all of " + andList(cstrList(f["all_of"]))
			}
		}
		if p["subject"] == "defender" {
			if negated {
				return negatedTargetKeywords(cstrList(mapOrValue(f, "any_of", "all_of")))
			}
			return "against " + keywordNames(f) + " targets"
		}
		if p["subject"] == nil || (negated && p["subject"] == "recipient") {
			plural := ""
			if !negated && (isList(f["any_of"]) || len(cstrList(f["all_of"])) > 1) {
				plural = "s"
			}
			lead := "if"
			if negated {
				lead = "unless"
			}
			return lead + " this unit has the " + keywordNames(f) + " keyword" + plural
		}
		lead := "if"
		if negated {
			lead = "unless"
		}
		return lead + " " + describePredicate(c, false)
	}
	if keys == 1 && f["designated"] != nil && p["subject"] == "defender" &&
		cstr(f["designated"]) == strings.ToUpper(cstr(f["designated"])) && !negated {
		return "against " + cstr(f["designated"]) + " targets"
	}
	return "while " + describePredicate(c, negated)
}

func mapOrValue(m map[string]any, preferred, fallback string) []any {
	if values, ok := asList(m[preferred]); ok {
		return values
	}
	values, _ := asList(m[fallback])
	return values
}

// hindersAttacker reports whether a modifier aimed at the attacker hinders its
// attack ("-1 to Hit", "subtract 1 from Damage", "worsen AP"). A subtract on
// BS, WS, AP, Sv or Ld improves the stat, so it does not.
func hindersAttacker(e map[string]any) bool {
	m := mapOr(e["modifier"])
	op := m["operation"]
	switch e["type"] {
	case "roll-modifier":
		return op == "subtract" || op == "halve"
	case "stat-modifier":
		switch op {
		case "worsen", "halve":
			return true
		case "subtract":
			switch m["stat"] {
			case "BS", "WS", "AP", "Sv", "Ld":
				return false
			}
			return true
		}
	}
	return false
}

// isDefensiveEffect reports whether an effect is resolved from the attacked
// unit's side: it protects the unit being attacked (a save, Feel No Pain,
// damage reduction, its Save or Toughness) or it hinders the attacker. An
// attack condition on it is the incoming attack.
func isDefensiveEffect(e map[string]any) bool {
	if e["target"] == "attacker" && hindersAttacker(e) {
		return true
	}
	switch e["type"] {
	case "invulnerable-save", "feel-no-pain", "damage-reduction":
		return true
	case "stat-modifier":
		stat := mapOr(e["modifier"])["stat"]
		return stat == "Sv" || stat == "T"
	}
	return false
}

// orOperandLeadIn: one alternative of an or. "Unless" would read as negating the whole
// alternation, so a negated alternative reads as its own negated predicate: "if you do not have
// 2+ glory points or during the Fight phase".
func orOperandLeadIn(o map[string]any, defending bool) string {
	lead := conditionLeadInFor(o, defending)
	if o["operator"] == "not" && strings.HasPrefix(lead, "unless ") {
		return "if " + describeCondition(o)
	}
	return lead
}

// conditionLeadIn renders a condition as a natural lead-in clause
// (lowercase-initial; the caller capitalizes at the sentence boundary). Falls
// back to `if <condition>` for shapes without a dedicated framing.
func conditionLeadIn(c map[string]any) string {
	return conditionLeadInFor(c, false)
}

// conditionLeadInFor is conditionLeadIn with defending framing attack
// conditions from the attacked unit's side ("against ranged attacks"), for a
// condition gating a defensive effect.
func conditionLeadInFor(c map[string]any, defending bool) string {
	if c == nil {
		c = map[string]any{}
	}
	if ops, ok := conditionOperands(c, "and"); ok {
		return joinLeadIns(ops, defending)
	}
	if ops, ok := conditionOperands(c, "or"); ok {
		parts := make([]string, len(ops))
		for i, o := range ops {
			parts[i] = orOperandLeadIn(o, defending)
		}
		return strings.Join(parts, " or ")
	}
	if ops, ok := conditionOperands(c, "not"); ok {
		if len(ops) == 1 && !jsTruthy(ops[0]["operator"]) {
			return negatedLeadIn(ops[0], defending)
		}
		// not(and[not A, not B]) is or[A, B], and not(or[not A, not B]) is and[A, B]: read the
		// positive form.
		if len(ops) == 1 && (ops[0]["operator"] == "and" || ops[0]["operator"] == "or") {
			if inner, ok := conditionOperands(ops[0], cstr(ops[0]["operator"])); ok && len(inner) > 0 {
				positives := make([]any, 0, len(inner))
				for _, o := range inner {
					if negated, ok := conditionOperands(o, "not"); ok && len(negated) == 1 {
						positives = append(positives, negated[0])
					}
				}
				if len(positives) == len(inner) {
					flipped := "and"
					if ops[0]["operator"] == "and" {
						flipped = "or"
					}
					return conditionLeadInFor(map[string]any{"operator": flipped, "operands": positives}, defending)
				}
			}
		}
		// Otherwise "unless" covers the whole compound, read as one predicate with no lead word of
		// its own.
		parts := make([]string, len(ops))
		for i, o := range ops {
			parts[i] = describeCondition(o)
		}
		return "unless " + strings.Join(parts, " or ")
	}
	p := paramsOf(c)
	switch c["type"] {
	case "phase-is":
		if p["step"] != nil {
			return stepWindow(p, "the")
		}
		if cstr(p["phase"]) == "command" {
			return "during the Command phase"
		}
		return "during the " + titleCase(cstr(p["phase"])) + " phase"
	case "player-turn-is", "battle-round":
		return battleRoundOnwardRe.ReplaceAllString(describePredicate(c, false), "from the $1 battle round onward")
	case "rule-active":
		return "while the " + ruleRefPhrase(p["rule"]) + " is active"
	case "matches":
		return matchesLeadIn(c, false)
	case "has-keyword":
		return "if " + describePredicate(c, false)
	case "attachment":
		if p["role"] == "leading" && (p["subject"] == "this-model" || p["subject"] == nil) {
			phrase := describePredicate(c, false)
			if rest, ok := strings.CutPrefix(phrase, "the model "); ok {
				phrase = "this model " + rest
			}
			return "while " + phrase
		}
		return "while " + describePredicate(c, false)
	case "happened":
		f := mapOr(p["filter"])
		types := cstrList(f["move_types"])
		// A phase filter reads in the full history phrase ("this unit charged in the Charge phase this turn").
		if p["event"] == "move-ended" && p["window"] == "turn" && len(types) == 1 && p["subject"] == nil && f["phase"] == nil {
			switch types[0] {
			case "charge":
				return "if this unit charged this turn"
			case "advance":
				return "if this unit Advanced this turn"
			case "remain-stationary":
				return "if this unit Remained Stationary this turn"
			}
		}
		if p["event"] == "disembarked" && p["subject"] == nil && f["transport"] == nil && f["phase"] == nil {
			return trimEnd("if this unit disembarked from a Transport " + windowPhrase(p["window"]))
		}
		// "while this unit is performing an Agile Manoeuvre": the use is being resolved now.
		if p["event"] == "used" && p["window"] == "event" && f["ability_keyword"] == nil && f["same_rule_as"] == nil {
			return "while " + describeHappened(p, false)
		}
		if (p["event"] == "destroyed" || p["event"] == "model-destroyed") && isEventObject(p["object"]) && p["window"] == "event" {
			return "when " + describeHappened(p, false)
		}
		return "if " + describeHappened(p, false)
	case "resource":
		if p["below_max"] == true || p["gained"] == "turn" || p["holder"] == "opponent" {
			return "if " + describePredicate(c, false)
		}
		return "while " + describePredicate(c, false)
	case "strength":
		s := belowStartingRe.ReplaceAllString(describePredicate(c, false), " is below its Starting Strength")
		s = belowHalfRe.ReplaceAllString(s, " is Below Half-strength")
		return "while " + s
	case "designated":
		if p["subject"] == "defender" && cstr(p["tag"]) == strings.ToUpper(cstr(p["tag"])) {
			return "against " + cstr(p["tag"]) + " targets"
		}
		return "while " + describePredicate(c, false)
	case "unit-state", "wounds", "owned-by":
		return "while " + describePredicate(c, false)
	case "attack-is":
		if p["all_target_same_unit"] == true {
			return "when " + describePredicate(c, false)
		}
		if defending {
			return leadingForRe.ReplaceAllString(describePredicate(c, false), "against ")
		}
		return leadingForRe.ReplaceAllString(describePredicate(c, false), "while making ")
	case "attack-compare":
		return "when " + describePredicate(c, false)
	case "model-count", "loadout", "equipped-weapon-count", "named-weapon", "unit-wargear":
		return "if " + describePredicate(c, false)
	case "within", "in-region":
		return "while " + describePredicate(c, false)
	}
	return "if " + describePredicate(c, false)
}

func negatedLeadIn(c map[string]any, defending bool) string {
	switch {
	case c["type"] == "same-unit":
		return "if " + describePredicate(c, true)
	case c["type"] == "matches":
		return matchesLeadIn(c, true)
	case c["type"] == "unit-state" || c["type"] == "designated":
		return "while " + describePredicate(c, true)
	}
	// Otherwise the positive lead-in, turned: "unless an enemy unit is within 12\"".
	lead := conditionLeadInFor(c, defending)
	if m := negatedLeadInWordsRe.FindStringSubmatch(lead); m != nil {
		if m[1] != "during" && m[1] != "in" && m[1] != "against" {
			lead = lead[len(m[0]):]
		}
	}
	return "unless " + lead
}

// notKeyword returns the keyword of `not(matches <subject> X)` with a single keyword.
func notKeyword(op map[string]any, subject string) (string, bool) {
	ops, ok := conditionOperands(op, "not")
	if !ok || len(ops) != 1 {
		return "", false
	}
	inner := ops[0]
	p := paramsOf(inner)
	f := mapOr(p["filter"])
	all, isL := asList(f["all_of"])
	if inner["type"] != "matches" || p["subject"] != subject || len(f) != 1 || !isL || len(all) != 1 {
		return "", false
	}
	return cstr(all[0]), true
}

// ownKeyword returns a bare single-keyword `matches` on the ability's own unit.
func ownKeyword(op map[string]any) (string, bool) {
	p := paramsOf(op)
	f := mapOr(p["filter"])
	all, isL := asList(f["all_of"])
	if op["type"] != "matches" || p["subject"] != nil || len(f) != 1 || !isL || len(all) != 1 {
		return "", false
	}
	return cstr(all[0]), true
}

// joinLeadIns joins the operands of an `and` lead-in. Merges `phase-is` +
// `player-turn-is` into one timing window ("during your Shooting phase"),
// collapses runs of keyword exclusions, and avoids doubled openers
// ("while A, while B" -> "while A and B").
func joinLeadIns(operands []map[string]any, defending bool) string {
	// Flatten nested `and` operands so phase+turn fusion and opener deduplication work across nesting.
	var flat []map[string]any
	var flatten func([]map[string]any)
	flatten = func(list []map[string]any) {
		for _, op := range list {
			if ops, ok := conditionOperands(op, "and"); ok {
				flatten(ops)
			} else {
				flat = append(flat, op)
			}
		}
	}
	flatten(operands)

	// Fuse one `phase-is` + one `player-turn-is` into a single natural window ("during your Shooting phase").
	phaseIdx, turnIdx := -1, -1
	for i, o := range flat {
		if phaseIdx < 0 && !jsTruthy(o["operator"]) && o["type"] == "phase-is" {
			if _, ok := paramsOf(o)["phase"].(string); ok {
				phaseIdx = i
			}
		}
		if turnIdx < 0 && !jsTruthy(o["operator"]) && o["type"] == "player-turn-is" {
			if _, ok := leadinTurnOwners[cstr(paramsOf(o)["turn"])]; ok {
				turnIdx = i
			}
		}
	}
	fusedWindow := ""
	if phaseIdx >= 0 && turnIdx >= 0 {
		pp := paramsOf(flat[phaseIdx])
		owner := leadinTurnOwners[cstr(paramsOf(flat[turnIdx])["turn"])]
		if pp["step"] != nil {
			fusedWindow = stepWindow(pp, owner)
		} else {
			fusedWindow = "during " + owner + " " + titleCase(cstr(pp["phase"])) + " phase"
		}
	}

	var parts []string
	run := func(i int, pick func(map[string]any) (string, bool)) ([]string, int) {
		var kws []string
		for i < len(flat) {
			kw, ok := pick(flat[i])
			if !ok {
				break
			}
			kws = append(kws, kw)
			i++
		}
		return kws, i
	}
	notDefender := func(o map[string]any) (string, bool) { return notKeyword(o, "defender") }
	notRecipient := func(o map[string]any) (string, bool) { return notKeyword(o, "recipient") }
	firstFused := phaseIdx
	if turnIdx < firstFused {
		firstFused = turnIdx
	}
	for i := 0; i < len(flat); {
		if fusedWindow != "" && (i == phaseIdx || i == turnIdx) {
			if i == firstFused {
				parts = append(parts, fusedWindow)
			}
			i++
			continue
		}
		op := flat[i]
		if _, ok := notDefender(op); ok {
			kws, next := run(i, notDefender)
			parts = append(parts, negatedTargetKeywords(kws))
			i = next
			continue
		}
		if _, ok := notRecipient(op); ok {
			kws, next := run(i, notRecipient)
			capped := make([]string, len(kws))
			for j, k := range kws {
				capped[j] = capWord(k)
			}
			parts = append(parts, "(excluding "+strings.Join(capped, " or ")+" units)")
			i = next
			continue
		}
		if _, ok := ownKeyword(op); ok {
			kws, next := run(i, ownKeyword)
			if len(kws) >= 2 {
				parts = append(parts, "if this unit is "+article(kws[0])+" "+strings.Join(kws, " ")+" unit")
			} else {
				parts = append(parts, "if this unit has the "+kws[0]+" keyword")
			}
			i = next
			continue
		}
		parts = append(parts, conditionLeadInFor(op, defending))
		i++
	}
	acc := ""
	for _, part := range parts {
		if acc == "" {
			acc = part
			continue
		}
		// A second keyword gate on the same target narrows it: "against ORKS targets that are also VEHICLE".
		if m := againstTargetsRe.FindStringSubmatch(part); m != nil && strings.HasSuffix(acc, " targets") && againstClauseRe.MatchString(acc) {
			acc += " that are also " + m[1]
			continue
		}
		// "while making melee attacks" + "while the target is an enemy X unit" -> "while making melee attacks against an enemy X unit".
		if m := targetIsRe.FindStringSubmatch(part); m != nil && whileMakingAttacksRe.MatchString(acc) {
			acc += " against " + m[1]
			continue
		}
		// Merge consecutive clauses sharing the same opener ("while A" + "while B" -> "while A and B").
		mergedOpener := false
		lastClause := acc
		if idx := strings.LastIndex(acc, ", "); idx >= 0 {
			lastClause = acc[idx+2:]
		}
		for _, opener := range []string{"while ", "if ", "when "} {
			if strings.HasPrefix(lastClause, opener) && strings.HasPrefix(part, opener) &&
				!strings.HasPrefix(part, "while making ") && !strings.HasPrefix(lastClause, "while making ") {
				acc += " and " + strings.TrimPrefix(part, opener)
				mergedOpener = true
				break
			}
		}
		if mergedOpener {
			continue
		}
		if (strings.HasPrefix(part, "against ") && !incomingAttackRe.MatchString(part)) || strings.HasPrefix(part, "(excluding ") {
			// A target narrowing attaches to the clause before it; an incoming attack is its own clause.
			acc += " " + part
		} else {
			acc += ", " + part
		}
	}
	return acc
}

var againstTargetsRe = regexp.MustCompile(`^against (.+) targets$`)
var againstClauseRe = regexp.MustCompile(`(^|, )against `)
