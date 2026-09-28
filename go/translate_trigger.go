package wh40kdc

import (
	"regexp"
	"strings"
)

// Humanize a reactive trigger: an event family, who acted (subject), what it
// was aimed at (object), which one (filter), a spatial gate and a condition.
// ASCII-only, pinned across the ports by the conformance corpus like the
// condition describer. Mirror of tools/src/translate/trigger.ts. Distinct from
// the scoring-card describeTrigger (different shape; same package).

// normalizeTriggers flattens the polymorphic trigger field (one object, an
// array, or nil) to a flat list of trigger maps (the ability fires on ANY).
func normalizeTriggers(t any) []map[string]any {
	if t == nil {
		return nil
	}
	if list, ok := asList(t); ok {
		out := make([]map[string]any, 0, len(list))
		for _, e := range list {
			if m, ok := asMap(e); ok {
				out = append(out, m)
			}
		}
		return out
	}
	if m, ok := asMap(t); ok {
		return []map[string]any{m}
	}
	return nil
}

// turnOwners names whose turn a trigger window falls in.
var turnOwners = map[string]string{"your-turn": "your", "opponent-turn": "your opponent's"}

// triggerActor renders the actor of a trigger: "the unit", "an enemy unit", "this model".
func triggerActor(ref any) string {
	switch r := ref.(type) {
	case nil:
		return "the unit"
	case string:
		switch r {
		case "this-unit":
			return "the unit"
		case "this-model":
			return "this model"
		case "model-in-this-unit":
			return "a model in this unit"
		}
		return dekebab(r)
	case map[string]any:
		if _, ok := r["event_var"].(string); ok {
			return "that unit"
		}
		// Keywords on the actor read as a trailing requirement, as the event names them.
		owner := "a"
		switch r["owner"] {
		case "friendly":
			owner = "a friendly"
		case "enemy":
			owner = "an enemy"
		}
		noun := "unit"
		if r["level"] == "model" {
			noun = "model"
		}
		return owner + " " + noun
	case []any:
		return "a unit"
	}
	return dekebab(cstr(ref))
}

// actorKeywords renders keyword requirements on a filter actor:
// " (the triggering unit must have A and B)".
func actorKeywords(ref any) string {
	f, ok := asMap(ref)
	if !ok || f == nil {
		return ""
	}
	noun := "unit"
	if f["level"] == "model" {
		noun = "model"
	}
	s := ""
	if isList(f["all_of"]) {
		s += " (the triggering " + noun + " must have " + andList(cstrList(f["all_of"])) + ")"
	}
	if isList(f["none_of"]) {
		s += " (the triggering " + noun + " must not have " + orList(cstrList(f["none_of"])) + ")"
	}
	return s
}

// triggerObjectPhrase renders an object phrase: "this unit", "an enemy unit".
func triggerObjectPhrase(ref any) string {
	switch r := ref.(type) {
	case nil:
		return "this unit"
	case string:
		switch r {
		case "this-unit":
			return "this unit"
		case "this-model":
			return "this model"
		case "model-in-this-unit":
			return "a model in this unit"
		}
		return dekebab(r)
	case map[string]any:
		return unitFilterPhrase(r)
	case []any:
		return unitFilterPhrase(map[string]any{})
	}
	return dekebab(cstr(ref))
}

var rollNouns = map[string]string{
	"hit": "Hit roll", "wound": "Wound roll", "save": "saving throw", "damage": "Damage roll", "charge": "Charge roll",
	"advance": "Advance roll", "battle-shock": "Battle-shock test", "leadership": "Leadership test", "hazard": "Hazard roll",
	"psychic": "Psychic test", "desperate-escape": "Desperate Escape test", "dark-pact": "Dark Pact Leadership test",
	"blessings-of-khorne": "Blessings of Khorne roll", "manoeuvre": "Agile Manoeuvre roll", "channelling": "Channel the Warp roll",
}

var testRolls = map[string]bool{"battle-shock": true, "leadership": true, "desperate-escape": true}

var attackModels = map[string]string{
	"this-model": "this model", "this-unit": "a model in this unit", "model-in-this-unit": "a model in this unit",
}

// isObject is JS `typeof v === "object" && v !== null`.
func isObject(v any) bool {
	switch v.(type) {
	case map[string]any, []any:
		return true
	}
	return false
}

func rollClause(t, f map[string]any) string {
	// An ability's own dice ({of_ability}) read "Reanimation Protocols roll".
	roll := ""
	if !isObject(f["roll"]) {
		roll = cstr(f["roll"])
	}
	noun, ok := rollNouns[roll]
	if !ok {
		noun = rollWord(f["roll"]) + " roll"
	}
	subject := t["subject"]
	sm, isMap := asMap(subject)
	anyone := isMap && sm != nil && sm["owner"] == "any" && len(sm) == 1
	subjectKey := "this-unit"
	if subject != nil {
		subjectKey = cstr(subject)
	}
	if t["event"] == "before-roll" {
		if testRolls[roll] && !anyone {
			return "when " + triggerActor(subject) + " takes a " + noun
		}
		by := ""
		if !anyone && (roll == "hit" || roll == "wound" || roll == "damage") {
			if m, ok := attackModels[subjectKey]; ok {
				by = m
			} else if isObject(subject) {
				by = "a model in " + triggerActor(subject)
			}
		}
		s := "before " + article(noun) + " " + noun + " is made"
		if by != "" {
			s += " for an attack made by " + by
		}
		return s
	}
	if f["result"] == "success" && roll == "hit" {
		return "after scoring a hit"
	}
	if f["result"] == "success" && roll == "wound" {
		by := ""
		if !anyone {
			m, ok := attackModels[subjectKey]
			if !ok {
				m = "a model in " + triggerActor(subject)
			}
			by = " made by " + m
		}
		return "each time an attack" + by + " scores a wound"
	}
	if f["result"] == "success" && roll == "dark-pact" {
		return "each time the unit makes a Dark Pact and passes its Leadership test"
	}
	if roll == "psychic" {
		return "after a Psychic test is taken"
	}
	if roll == "blessings-of-khorne" {
		return "each time you make a Blessings of Khorne roll"
	}
	return "after " + article(noun) + " " + noun + " is made"
}

var usedPhrases = map[string]string{
	"dark-pact": "makes a Dark Pact", "act-of-faith": "performs an Act of Faith", "manoeuvre": "performs an Agile Manoeuvre",
	"ritual": "attempts a Ritual", "order": "issues an Order", "doctrine": "selects a Combat Doctrine", "contract": "invokes its contract",
}

var setUpFromPhrases = map[string]string{
	"deep-strike": "is set up by Deep Strike", "strategic-reserves": "arrives from Strategic Reserves",
	"cult-ambush": "is set up using Cult Ambush", "transport": "is set up from a Transport",
}

var trailingSpaceUnitRe = regexp.MustCompile(`\s+unit$`)

// triggerEventPhrase renders the event family's own clause, before proximity,
// condition and options.
func triggerEventPhrase(t map[string]any) string {
	f := mapOr(t["filter"])
	who := triggerActor(t["subject"])
	object := t["object"]
	switch t["event"] {
	case "battle-started":
		return "at the start of the battle"
	case "battle-formations-declared":
		return "when declaring Battle Formations"
	case "deployment-ended":
		return "after deployment"
	case "round-started":
		return "at the start of the battle round"
	case "round-ended":
		return "at the end of the battle round"
	case "turn-started":
		return "at the start of the turn"
	case "turn-ended":
		return "at the end of the turn"
	case "step-started":
		return "at the start of the " + titleCase(cstr(f["step"])) + " step"
	case "selected":
		if f["to"] == nil {
			return "when " + who + " is selected"
		}
		if f["to"] == "observe" {
			return "each time " + who + " is selected as an Observer unit"
		}
		if f["to"] == "move" && isList(f["move_types"]) {
			return "when " + who + " is selected to " + moveKinds(f["move_types"])
		}
		to := dekebab(cstr(f["to"]))
		if f["to"] == "attack" {
			to = "shoot or fight"
		}
		return "when " + who + " is selected to " + to
	case "targets-selected":
		if f["kind"] == "stratagem" {
			target := triggerObjectPhrase(object)
			if object == nil || object == "this-unit" || object == "this-model" {
				target = "this model's unit"
			}
			return "when " + target + " is targeted with a Stratagem"
		}
		if src, ok := asMap(t["source_ability"]); f["kind"] == "ability" && ok && src != nil {
			s := "when " + triggerActor(t["subject"]) + " is selected by the " + titleCase(cstr(src["ability_id"])) +
				" ability of a " + cstr(src["owner"]) + " " + strings.Join(cstrList(src["keywords"]), " ") + " unit"
			return trailingSpaceUnitRe.ReplaceAllString(s, " unit")
		}
		if f["kind"] == "charge" {
			if object != nil {
				return "when " + who + " selects " + triggerObjectPhrase(object) + " as a charge target"
			}
			if isObject(t["subject"]) {
				return "after " + who + " selects targets for its charge but before it makes a Charge move"
			}
			return "when a Charge is declared"
		}
		if object != nil {
			return "when " + who + " targets " + triggerObjectPhrase(object)
		}
		return "when " + who + " selects its targets"
	case "move-ended":
		if f["through"] == "tall-terrain" {
			return "when " + who + " moves through terrain over 4\" tall"
		}
		if f["through"] == "terrain" {
			return "when " + who + " moves through terrain"
		}
		kinds := ""
		if isList(f["move_types"]) {
			kinds = moveKinds(f["move_types"])
		}
		enemy := isObject(t["subject"])
		// Another unit's move is a reaction window: "each time an enemy unit ends a move".
		if enemy && kinds == "Fall Back" && object == nil {
			return "each time " + who + " Falls Back"
		}
		tail := ""
		if object != nil {
			tail = " from " + triggerObjectPhrase(object)
		}
		a := "a"
		if kinds != "" {
			a = article(kinds) + " " + kinds
		}
		if enemy {
			return "each time " + who + " ends " + a + " move" + tail
		}
		return "when " + who + " ends " + a + " move" + tail
	case "set-up":
		from, ok := setUpFromPhrases[cstr(f["from"])]
		if !ok {
			from = "is set up"
		}
		return "when " + who + " " + from
	case "disembarked":
		return "when " + who + " disembarks from a Transport"
	case "before-roll", "after-roll":
		return rollClause(t, f)
	case "damage-allocated":
		if object != nil && object != "this-unit" {
			return "when damage is allocated to " + triggerObjectPhrase(object)
		}
		return "when damage is allocated"
	case "attacks-resolved":
		if isObject(t["subject"]) {
			if object != nil {
				return "after " + who + " has shot and targeted " + triggerObjectPhrase(object)
			}
			verb := "shoots"
			if f["kind"] == "fight" {
				verb = "fights"
			}
			return "after " + who + " " + verb
		}
		return "after " + who + " resolves its attacks"
	case "destroyed":
		melee := ""
		if f["attack_type"] == "melee" {
			melee = " in melee"
		}
		if object == nil || object == "this-unit" {
			return "when the unit is destroyed" + melee
		}
		if om, ok := asMap(object); ok && om != nil && om["designated"] != nil && len(om) == 1 {
			return "each time your quarry is destroyed"
		}
		lead := "each time"
		if melee != "" {
			lead = "when"
		}
		return lead + " " + triggerObjectPhrase(object) + " is destroyed" + melee
	case "model-destroyed":
		if f["timing"] == "before-removal" {
			return "before this model is removed from play"
		}
		if f["first"] == true {
			return "the first time a model in the unit is destroyed"
		}
		if object == "this-model" {
			return "when this model is destroyed"
		}
		if object == "model-in-this-unit" || object == nil {
			return "when a model in the unit is destroyed"
		}
		return "when " + triggerObjectPhrase(object) + " is destroyed"
	case "used":
		if which := usedAbilityPhrase(f); which != "" {
			return "each time " + who + " uses " + which
		}
		switch {
		case f["kind"] == "stratagem":
			return "each time you use a Stratagem"
		case f["kind"] == "ability" && f["id"] != nil:
			return "when you use " + titleCase(cstr(f["id"]))
		case f["kind"] == "ritual" && f["result"] == "success":
			return "each time " + who + " manifests a Ritual"
		case f["kind"] == "act-of-faith":
			if f["result"] == "success" {
				return "after an Act of Faith is completed"
			}
			return "when an Act of Faith is performed"
		case f["kind"] == "order" && object != nil:
			return "each time an Order is issued to the unit"
		case f["kind"] == "contract" && f["result"] == "success":
			return "each time you complete a Contract"
		}
		verb, ok := usedPhrases[cstr(f["kind"])]
		if !ok {
			verb = "uses " + dekebab(cstr(f["kind"]))
		}
		return "each time " + who + " " + verb
	case "state-changed":
		return "when " + who + " becomes " + capWord(cstr(f["state"]))
	case "designation-changed":
		if f["tag"] == "EMPOWERED" {
			return "each time " + who + " is Empowered"
		}
		return "each time " + who + " becomes " + cstr(f["tag"])
	case "designation-resolved":
		if f["tag"] == "OATH OF MOMENT TARGET" {
			return "when you fulfil an Oath"
		}
		return "when a " + cstr(f["tag"]) + " designation is resolved"
	case "marker-removed":
		return "each time one of your " + titleCase(cstr(f["marker"])) + " markers is removed"
	case "objective-gained":
		return "when you gain control of an objective"
	case "resource-gained":
		if f["pool"] == "miracle-dice" {
			return "when a Miracle die is generated"
		}
		if f["pool"] == "cp" {
			if sm, ok := asMap(t["subject"]); ok && sm != nil && sm["owner"] == "enemy" {
				return "each time your opponent gains a CP"
			}
			return "each time you gain a CP"
		}
		return "each time " + dekebab(cstr(f["pool"])) + " is gained"
	case "resource-spent":
		if f["pool"] == "flux" {
			return "each time a Flux token is spent"
		}
		if f["pool"] == "yield-points" {
			return "each time you spend Yield points"
		}
		return "each time " + dekebab(cstr(f["pool"])) + " is spent"
	}
	return "when " + dekebab(cstr(t["event"]))
}

// triggerConditionOperands is the condition's top-level operands for the
// phase-boundary check: the `and` operands, the lone predicate, or none.
func triggerConditionOperands(t map[string]any) []map[string]any {
	cond, ok := asMap(t["condition"])
	if !ok || !jsTruthy(t["condition"]) {
		return nil
	}
	if cond["operator"] == "and" {
		ops, _ := conditionOperands(cond, "and")
		return ops
	}
	return []map[string]any{cond}
}

// phaseBoundary renders "at the start of your Command phase": a phase boundary
// narrowed only by phase and whose turn. ok is false otherwise.
func phaseBoundary(t map[string]any) (string, bool) {
	if t["event"] != "phase-started" && t["event"] != "phase-ended" {
		return "", false
	}
	operands := triggerConditionOperands(t)
	var phaseOp, turnOp map[string]any
	for _, c := range operands {
		if jsTruthy(c["operator"]) || (c["type"] != "phase-is" && c["type"] != "player-turn-is") {
			return "", false
		}
		if c["type"] == "phase-is" && phaseOp == nil {
			phaseOp = c
		}
		if c["type"] == "player-turn-is" && turnOp == nil {
			turnOp = c
		}
	}
	if phaseOp == nil {
		return "", false
	}
	phase, ok := paramsOf(phaseOp)["phase"].(string)
	if !ok {
		return "", false
	}
	var turn any
	hasTurn := false
	if turnOp != nil {
		turn, hasTurn = paramsOf(turnOp)["turn"]
	}
	want := 1
	if hasTurn {
		want = 2
	}
	if len(operands) != want {
		return "", false
	}
	owner := "the"
	if hasTurn {
		mapped, found := turnOwners[cstr(turn)]
		if !found {
			return "", false
		}
		owner = mapped
	}
	edge := "end"
	if t["event"] == "phase-started" {
		edge = "start"
	}
	return "at the " + edge + " of " + owner + " " + capWord(phase) + " phase", true
}

// turnBoundary renders "at the start of your turn": a turn boundary narrowed
// only by whose turn.
func turnBoundary(t map[string]any) (string, bool) {
	if t["event"] != "turn-started" && t["event"] != "turn-ended" {
		return "", false
	}
	c, ok := asMap(t["condition"])
	if !ok || c == nil || c["type"] != "player-turn-is" {
		return "", false
	}
	owner, found := turnOwners[cstr(paramsOf(c)["turn"])]
	if !found || owner == "" {
		return "", false
	}
	edge := "end"
	if t["event"] == "turn-started" {
		edge = "start"
	}
	return "at the " + edge + " of " + owner + " turn", true
}

// phaseWindow splits a trigger condition into its phase and whose turn, as a
// phrase on the moment ("during your Shooting phase", "in your opponent's
// turn"), and whatever else the condition says (nil when nothing is left). Only
// a plain phase-is and player-turn-is (at most one each, joined by "and") make
// a window; otherwise window is "" and rest is the whole condition.
func phaseWindow(condition map[string]any) (window string, rest map[string]any, phase string, owner string) {
	var operands []map[string]any
	if condition["operator"] == "and" {
		operands, _ = conditionOperands(condition, "and")
	} else if !jsTruthy(condition["operator"]) {
		operands = []map[string]any{condition}
	}
	var phases, turns, others []map[string]any
	for _, c := range operands {
		switch c["type"] {
		case "phase-is":
			phases = append(phases, c)
		case "player-turn-is":
			turns = append(turns, c)
		default:
			others = append(others, c)
		}
	}
	hasOwner := false
	if len(turns) > 0 {
		owner, hasOwner = turnOwners[cstr(paramsOf(turns[0])["turn"])]
	}
	phaseIsStr := false
	if len(phases) > 0 {
		phase, phaseIsStr = paramsOf(phases[0])["phase"].(string)
	}
	if len(phases) > 1 || len(turns) > 1 || (len(turns) == 1 && !hasOwner) || (len(phases) == 1 && !phaseIsStr) || len(phases)+len(turns) == 0 {
		return "", condition, "", ""
	}
	if len(phases) > 0 {
		windowOwner := owner
		if !hasOwner {
			windowOwner = "the"
		}
		window = "during " + windowOwner + " " + capWord(phase) + " phase"
	} else {
		window = "in " + owner + " turn"
	}
	switch len(others) {
	case 0:
		rest = nil
	case 1:
		rest = others[0]
	default:
		ops := make([]any, len(others))
		for i, o := range others {
			ops[i] = o
		}
		rest = map[string]any{"operator": "and", "operands": ops}
	}
	return window, rest, phase, owner
}

// disembarkBattleShock reports `phase-ended` with "disembarked this turn and
// battle-shocked": the one boundary that reads as an if.
func disembarkBattleShock(c map[string]any) bool {
	ops, ok := conditionOperands(c, "and")
	if !ok || len(ops) != 2 {
		return false
	}
	first, second := ops[0], ops[1]
	return first["type"] == "happened" && paramsOf(first)["event"] == "disembarked" &&
		second["type"] == "unit-state" && paramsOf(second)["state"] == "battle-shocked"
}

// describeReactiveTrigger renders a reactive trigger as a front-of-sentence
// lead clause ("an enemy unit ends a move within 9\" of this model").
func describeReactiveTrigger(t map[string]any) string {
	event := t["event"]
	clock := event == "phase-started" || event == "phase-ended"
	subject := t["subject"]
	plain := !jsTruthy(t["proximity"]) && !jsTruthy(t["binds_die_variable"]) && !jsTruthy(t["binds_selected_die_variable"]) &&
		(subject == nil || subject == "this-unit")
	if plain {
		boundary, ok := phaseBoundary(t)
		if !ok {
			boundary, ok = turnBoundary(t)
		}
		if ok && boundary != "" {
			if jsTruthy(t["optional"]) {
				return boundary + ", you may use this ability"
			}
			return boundary
		}
	}
	edge := ""
	switch event {
	case "phase-started":
		edge = "start"
	case "phase-ended":
		edge = "end"
	}
	cond, _ := asMap(t["condition"])
	disembarkShock := event == "phase-ended" && disembarkBattleShock(cond)
	hasSplit := jsTruthy(t["condition"]) && !disembarkShock
	var window, phase, owner string
	var rest map[string]any
	if hasSplit {
		window, rest, phase, owner = phaseWindow(mapOr(t["condition"]))
	}
	var s string
	switch {
	case !clock:
		s = triggerEventPhrase(t)
	case hasSplit && phase != "":
		lead := owner
		if lead == "" {
			lead = "the"
		}
		s = "at the " + edge + " of " + lead + " " + capWord(phase) + " phase"
	default:
		s = "at the " + edge + " of each phase"
	}
	s += actorKeywords(subject)
	f := mapOr(t["filter"])
	if f["by"] != nil {
		source := "this unit"
		if f["by"] == "this-model" {
			source = "this model"
		}
		typ := ""
		if jsTruthy(f["attack_type"]) && event != "destroyed" {
			typ = cstr(f["attack_type"]) + " "
		}
		weapon := ""
		if jsTruthy(f["weapon_keyword"]) {
			weapon = " with [" + strings.ToUpper(cstr(f["weapon_keyword"])) + "] weapons"
		}
		if typ != "" || weapon != "" {
			s += " by " + typ + "attacks made by " + source + weapon
		} else {
			s += " by " + source
		}
	}
	if prox, ok := asMap(t["proximity"]); ok && prox != nil && prox["range"] != nil {
		of := "this unit"
		if prox["of"] == "this-model" {
			of = "this model"
		}
		s += " within " + rangePhrase(prox["range"]) + " of " + of
	}
	if disembarkShock {
		s += ", if the unit disembarked from a Transport this turn and is Battle-shocked"
	} else if hasSplit {
		if edge != "" && phase == "" && owner != "" {
			s += " in " + owner + " turn"
		} else if edge == "" && window != "" {
			s += " " + window
		}
		if rest != nil {
			s += ", if " + describeCondition(rest)
		}
	}
	if v := t["binds_die_variable"]; jsTruthy(v) {
		s += " (binding the generated die as " + dekebab(strings.ReplaceAll(cstr(v), "_", "-")) + ")"
	}
	if v := t["binds_selected_die_variable"]; jsTruthy(v) {
		s += " (binding one chosen die used in that Act of Faith as " + dekebab(strings.ReplaceAll(cstr(v), "_", "-")) + ")"
	}
	if jsTruthy(t["optional"]) {
		s += ", you may use this ability"
	}
	return s
}
