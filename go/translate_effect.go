package wh40kdc

import (
	"sort"
	"strings"
)

// Humanize an Ability-DSL effect tree into natural English. ASCII-only, pinned
// byte-for-byte by conformance/effect-translation. This file holds the
// container dispatch; leaves are in translate_effect_leaf*.go, selections in
// translate_effect_select.go, named regions in translate_effect_region.go and
// the ability-level sentence in translate_effect_top.go. Mirror of
// tools/src/translate/effect.ts.

var containerTypes = map[string]bool{
	"roll": true, "select-objective": true, "sequence": true, "rules-bundle": true, "ability-part": true, "choice": true, "dice-gated": true, "dice-table": true,
	"dice-pool-allocation": true, "select-units": true, "for-each-unit": true, "designate-target": true,
	"persistent-designation": true, "stance-select": true, "risk-reward": true, "issue-orders": true, "resource-action-menu": true,
}

// ejstrType is an effect node's `type` as a string ("" when absent).
func ejstrType(e map[string]any) string {
	s, _ := e["type"].(string)
	return s
}

// durationClauses maps a duration to its woven clauses: `lead` sits at the
// front of the sentence, `trail` after the trigger/condition.
func durationClauses(duration any) (string, string) {
	if duration == "one-use" {
		return "once per battle", ""
	}
	return "", expiryTrail(duration)
}

// scalingClause renders a scaling block as a trailing clause ("for every 5 enemy models within 6\"").
func scalingClause(s map[string]any) string {
	maxTail := ""
	if s["max_value"] != nil {
		maxTail = " (to a maximum of " + ejstr(s["max_value"]) + ")"
	}
	if s["of"] == "battle-round" {
		return "multiplied by the battle round number" + maxTail
	}
	// A summed characteristic is counted in points: "for every point of Objective Control of the models embarked within this model".
	if s["of"] == "embarked-models-oc" {
		per := ejstr(s["per"]) + " points"
		if jsNumber(s["per"]) == 1 {
			per = "point"
		}
		return "for every " + per + " of " + scaleSource(s) + maxTail
	}
	c := "for every " + ejstr(s["per"]) + " " + scaleSource(s)
	if s["within_inches"] != nil && !strings.HasSuffix(c, "within "+ejstr(s["within_inches"])+"\"") {
		c += " within " + ejstr(s["within_inches"]) + "\""
	}
	if s["round"] == "up" {
		c += " (rounding up)"
	}
	return c + maxTail
}

func auraEligibleSubject(who string, eligible any) string {
	e, ok := asMap(eligible)
	if !ok || e == nil {
		return who
	}
	required := jstrList(e["required_keywords"])
	excluded := jstrList(e["excluded_keywords"])
	base := who
	if len(required) > 0 {
		base = who[:len(who)-4] + strings.Join(required, " ") + " unit"
	}
	if len(excluded) > 0 {
		base += " (excluding " + strings.Join(excluded, " ") + " units)"
	}
	return base
}

// keywordFilterClause renders one aura-role keyword predicate.
func keywordFilterClause(value any, noun string) string {
	filter, ok := asMap(value)
	if !ok || filter == nil {
		return noun
	}
	s := noun
	if _, ok := asList(filter["required_keywords"]); ok {
		if r := strings.Join(jstrList(filter["required_keywords"]), " and "); r != "" {
			s += " with " + r
		}
	}
	if _, ok := asList(filter["excluded_keywords"]); ok {
		if x := strings.Join(jstrList(filter["excluded_keywords"]), " or "); x != "" {
			s += " without " + x
		}
	}
	return s
}

func auraClause(e, m map[string]any, ctx effCtx) string {
	if m["range_bonus"] != nil {
		named := ""
		if m["of"] != nil {
			named = titleCase(ejstr(m["of"])) + " "
		}
		capped := ""
		if m["range_cap"] != nil {
			capped = " (to a maximum of " + ejstr(m["range_cap"]) + "\")"
		}
		return "the range of this model's " + named + "abilities is increased by " + ejstr(m["range_bonus"]) + "\"" + capped
	}
	rangeText := "range"
	if l, ok := asList(m["range"]); ok {
		parts := make([]string, len(l))
		for i, r := range l {
			parts[i] = ejstr(r) + "\""
		}
		rangeText = strings.Join(parts, "/") + " (by battle round)"
	} else if m["range"] != nil {
		rangeText = ejstr(m["range"]) + "\""
	}
	who := "an enemy unit"
	if e["target"] == "friendly-within-aura" {
		who = "a friendly unit"
	}
	eligibleWho := auraEligibleSubject(who, m["eligible"])
	recipient := eligibleWho
	if m["recipient_filter"] != nil {
		recipient = keywordFilterClause(m["recipient_filter"], eligibleWho)
	}
	emitter := "this model"
	if m["emitter_filter"] != nil {
		emitter = keywordFilterClause(m["emitter_filter"], "this model")
	}
	effectText := "that unit is affected"
	if m["effect"] != nil {
		inner := ctx
		inner.auraRecipient = true
		effectText = describeEffectInline(mapOr(m["effect"]), inner)
	}
	capped := ""
	if m["range_cap"] != nil {
		capped = " (to a maximum of " + ejstr(m["range_cap"]) + "\", extensions included)"
	}
	return "while " + recipient + " is within " + rangeText + capped + " of " + emitter + ", " + effectText
}

// describeEffectInline renders a single-clause translation (lowercase-initial,
// no period), with any `scaling` block woven on as a trailing clause.
func describeEffectInline(e map[string]any, ctx effCtx) string {
	base := describeEffectInlineBase(e, ctx)
	if e["type"] == "movement-modifier" && jsTruthy(e["after_move"]) {
		base += "; if it does, " + describeEffectInline(mapOr(e["after_move"]), ctx)
	}
	if e["type"] == "mortal-wounds" && mod(e)["in_addition_to_normal_damage"] == true {
		base += ", in addition to normal damage"
	}
	if s, ok := asMap(e["scaling"]); ok && s != nil {
		return base + " " + scalingClause(s)
	}
	return base
}

// describeRequirement renders a dice-pool option requirement ("pair of 4+", or alternatives joined by " or ").
func describeRequirement(req any) string { return requirementPhrase(req) }

func diceTableResultLabel(results any) string {
	l, ok := asList(results)
	if !ok {
		return ""
	}
	var faces []float64
	for _, v := range l {
		if f, ok := v.(float64); ok {
			faces = append(faces, f)
		}
	}
	sort.Float64s(faces)
	if len(faces) > 1 {
		consecutive := true
		for i := 1; i < len(faces); i++ {
			if faces[i] != faces[i-1]+1 {
				consecutive = false
			}
		}
		if consecutive {
			return numStr(faces[0]) + "-" + numStr(faces[len(faces)-1])
		}
	}
	parts := make([]string, len(faces))
	for i, f := range faces {
		parts[i] = numStr(f)
	}
	return strings.Join(parts, ", ")
}

func diceTableInline(e map[string]any, ctx effCtx) string {
	var outcomes []string
	for _, o := range getList(e, "outcomes") {
		om := mapOr(o)
		outcomes = append(outcomes, "on "+diceTableResultLabel(om["results"])+", "+describeEffectInline(mapOr(om["effect"]), ctx))
	}
	return "roll one " + diceCase(e["dice"]) + ": " + strings.Join(outcomes, "; ")
}

// rollWithRider renders a [dice-gated rider, unconditional primary] sequence.
// Only a gate declaring `rider: true` qualifies.
func rollWithRider(steps []any, ctx effCtx) (string, bool) {
	if len(steps) != 2 {
		return "", false
	}
	first := mapOr(steps[0])
	if first["type"] != "dice-gated" || first["rider"] != true || first["on_success"] == nil {
		return "", false
	}
	comp := "gte"
	if first["comparison"] != nil {
		comp = ejstr(first["comparison"])
	}
	return "roll one " + diceCase(first["dice"]) + ". On " + formatComparison(comp, first["threshold"]) + ", " +
		describeEffectInline(mapOr(first["on_success"]), ctx) + ". Regardless of the result, " +
		describeEffectInline(mapOr(steps[1]), ctx), true
}

func dicePoolLabel(e map[string]any) string {
	if p, ok := asMap(e["pool"]); ok && p != nil {
		return ejstr(p["count"]) + ejstr(p["die"])
	}
	return "your dice pool"
}

// diceGate renders a dice gate: roll new dice ("roll one D6: on a 4+, ..."), or
// test the dice of a bound roll against a threshold or a pair/triple
// requirement ("using a pair of 3+ from that roll's unused dice, ...").
func diceGate(e map[string]any, ctx effCtx) string {
	success := "nothing happens"
	if jsTruthy(e["on_success"]) {
		success = describeEffectInline(mapOr(e["on_success"]), ctx)
	}
	fail := ""
	if jsTruthy(e["on_fail"]) {
		fail = "; otherwise, " + describeEffectInline(mapOr(e["on_fail"]), ctx)
	}
	comp := "gte"
	if e["comparison"] != nil {
		comp = ejstr(e["comparison"])
	}
	if e["from"] != nil {
		if e["requirement"] != nil {
			return "using a " + describeRequirement(e["requirement"]) + " from that roll's unused dice, " + success + fail
		}
		return "if " + quantityPhrase(mapOr(e["from"])) + " is " + formatComparison(comp, e["threshold"]) + ", " + success + fail
	}
	kind := ""
	if e["kind"] != nil {
		kind = " (" + rollKindNoun(e["kind"]) + ")"
	}
	// "roll one D6", but "roll 2D6": a dice expression with its own count takes no article.
	dice := diceCase(e["dice"])
	one := "one "
	if dice != "" && dice[0] >= '0' && dice[0] <= '9' {
		one = ""
	}
	return "roll " + one + dice + kind + ": on " + formatComparison(comp, e["threshold"]) + ", " + success + fail
}

func describeEffectInlineBase(e map[string]any, ctx effCtx) string {
	m := mod(e)
	switch e["type"] {
	case "named-region-state":
		return describeNamedRegionState(m, ctx)
	case "aura":
		return auraClause(e, m, ctx)
	case "no-effect":
		return "nothing happens"
	case "conditional":
		inner := mapOr(e["effect"])
		if inner["type"] == "named-region-state" {
			return describeNamedRegionConditional(mod(inner), mapOr(e["condition"]), ctx)
		}
		return conditionLeadIn(mapOr(e["condition"])) + ", " + describeEffectInline(inner, ctx)
	case "rules-bundle", "sequence":
		steps := getList(e, "steps")
		if rider, ok := rollWithRider(steps, ctx); ok {
			return rider
		}
		parts := make([]string, len(steps))
		for i, s := range steps {
			parts[i] = describeEffectInline(mapOr(s), ctx)
		}
		return strings.Join(parts, "; ")
	case "ability-part":
		return partInline(e, ctx)
	case "choice":
		var opts []string
		for _, o := range getList(e, "options") {
			opts = append(opts, describeEffectInline(mapOr(o), ctx))
		}
		return choicePrompt(e) + ": " + strings.Join(opts, " / ")
	case "dice-gated":
		if jsTruthy(e["test"]) {
			return leadershipTest(e, ctx)
		}
		return diceGate(e, ctx)
	case "roll":
		return rollHead(e) + "; then " + describeEffectInline(mapOr(e["effect"]), ctx)
	case "select-objective":
		return selectObjectiveInline(e, func(x any) string { return describeEffectInline(mapOr(x), ctx) })
	case "dice-table":
		return diceTableInline(e, ctx)
	case "dice-pool-allocation":
		var opts []string
		for _, o := range getList(e, "options") {
			om := mapOr(o)
			opts = append(opts, ejstr(om["name"])+" (requires "+describeRequirement(om["requirement"])+"): "+describeEffectInline(mapOr(om["effect"]), ctx))
		}
		return "roll " + dicePoolLabel(e) + ": " + strings.Join(opts, " / ")
	case "select-units":
		return selectUnitsInline(mapOr(e["selector"]), mapOr(e["effect"]), ctx)
	case "leader-model-ability-grant":
		return leaderModelAbilityGrantClause(e, ctx)
	case "persistent-designation":
		if e["operation"] == "replace" {
			return persistentDesignationReplacement(e)
		}
		if !persistentDesignationSupported(e) {
			return "[persistent-designation]"
		}
		return persistentDesignationLead(e) + " " + persistentDesignationWhen(e) + ", " + describeEffectInline(mapOr(mapOr(e["consumer"])["effect"]), ctx)
	case "for-each-unit":
		sel := mapOr(e["selector"])
		return "for each " + forEachUnitSubject(sel) + ": " + describeEffectInline(mapOr(e["effect"]), selectedContext(ctx, sel))
	case "designate-target":
		return designateTargetInline(e, ctx)
	case "stance-select":
		var opts []string
		for _, o := range getList(e, "options") {
			om := mapOr(o)
			opts = append(opts, ejstr(om["name"])+" ("+describeEffectInline(mapOr(om["effect"]), ctx)+")")
		}
		return stancePick(e) + ": " + strings.Join(opts, " / ")
	case "stance-selection-capacity":
		n := jsNumber(m["additional_selections"])
		if n != n || n == 0 {
			n = 1
		}
		times := numStr(n) + " additional times"
		if n == 1 {
			times = "one additional time"
		}
		subject := "one option of " + titleCase(ejstr(m["stance_id"]))
		if m["allocation"] == "fixed-option" && m["option_id"] != nil {
			subject = titleCase(ejstr(m["option_id"]))
		}
		return "you can select " + subject + " " + times + " per battle"
	case "risk-reward":
		risk := mapOr(e["risk"])
		onFail := "suffer a consequence"
		if jsTruthy(risk["on_fail"]) {
			onFail = describeEffectInline(mapOr(risk["on_fail"]), ctx)
		}
		return "take a " + testName(risk["test"]) + " test (on a failure, " + onFail + "), then " + describeEffectInline(mapOr(e["reward"]), ctx)
	case "issue-orders":
		var names []string
		for _, o := range getList(e, "options") {
			names = append(names, ejstr(mapOr(o)["name"]))
		}
		return "issue Orders, each one of: " + strings.Join(names, " / ")
	case "resource-action-menu":
		var acts []string
		for _, a := range getList(e, "actions") {
			acts = append(acts, describeMenuAction(mapOr(a), ctx))
		}
		return "actions may be performed when their conditions are met: " + strings.Join(acts, " / ")
	}
	if leafTypes[ejstrType(e)] {
		return describeLeaf(e, ctx)
	}
	t := "unknown"
	if e["type"] != nil {
		t = ejstr(e["type"])
	}
	return "[" + t + "]"
}

var smallNumberWords = []string{"zero", "one", "two", "three", "four"}

// stancePick renders how many menu options are picked ("select one", "select up to two").
func stancePick(e map[string]any) string {
	min, max := 1.0, 1.0
	if v, ok := e["min_choices"].(float64); ok {
		min = v
	}
	if v, ok := e["max_choices"].(float64); ok {
		max = v
	}
	n := func(k float64) string {
		if k == float64(int(k)) && k >= 0 && int(k) < len(smallNumberWords) {
			return smallNumberWords[int(k)]
		}
		return numStr(k)
	}
	if min == max {
		return "select " + n(max)
	}
	if min <= 1 {
		return "select up to " + n(max)
	}
	return "select from " + n(min) + " to " + n(max)
}

func choicePrompt(e map[string]any) string {
	if p, ok := e["choice_prompt"].(string); ok && strings.TrimSpace(p) != "" {
		return p
	}
	label := ""
	if l, ok := e["choice_label"].(string); ok && l != "" {
		label = " (" + titleCase(l) + ")"
	}
	if e["min_choices"] != nil && e["max_choices"] != nil {
		minC, maxC := e["min_choices"], e["max_choices"]
		var quantity string
		if numEq(minC, maxC) {
			quantity = "exactly " + ejstr(maxC)
		} else if minC == 0.0 {
			quantity = "up to " + ejstr(maxC)
		} else {
			quantity = "from " + ejstr(minC) + " through " + ejstr(maxC)
		}
		return "select " + quantity + " distinct options" + label
	}
	return "select one of the following" + label
}

func leadershipTest(e map[string]any, ctx effCtx) string {
	test := mapOr(e["test"])
	who := "that unit"
	switch test["subject"] {
	case "self":
		who = "this model"
	case "target":
		who = "the target unit"
	}
	kind := "Leadership"
	if test["kind"] == "battle-shock" {
		kind = "Battle-shock"
	}
	var mods []string
	for _, x := range getList(test, "modifiers") {
		xm := mapOr(x)
		mods = append(mods, "apply "+esigned("add", xm["value"])+" if "+describeCondition(mapOr(xm["condition"])))
	}
	modifiers := strings.Join(mods, "; ")
	success := "nothing happens"
	if jsTruthy(e["on_success"]) {
		success = describeEffectInline(mapOr(e["on_success"]), ctx)
	}
	var failures []string
	if test["kind"] == "battle-shock" {
		failures = append(failures, who+" becomes Battle-shocked")
	}
	if jsTruthy(e["on_fail"]) {
		failures = append(failures, describeEffectInline(mapOr(e["on_fail"]), ctx))
	}
	fail := ""
	if len(failures) > 0 {
		fail = "; otherwise, " + strings.Join(failures, "; ")
	}
	if modifiers != "" {
		modifiers = "; " + modifiers
	}
	return who + " takes a " + kind + " test (2D6, passing on its current Leadership or higher" + modifiers + "); if passed, " + success + fail
}

// describeEffect renders a container effect tree as a block (multi-line,
// two-space indentation). Leaves render as one capitalized sentence.
func describeEffect(e map[string]any, depth int, ctx effCtx) string {
	indent := strings.Repeat("  ", depth)
	arrow := ""
	if depth > 0 {
		arrow = "-> "
	}
	switch e["type"] {
	case "conditional":
		inner := mapOr(e["effect"])
		lead := capitalize(conditionLeadIn(mapOr(e["condition"])))
		if containerTypes[ejstrType(inner)] {
			return indent + lead + ":\n" + describeEffect(inner, depth+1, ctx)
		}
		return indent + arrow + lead + ", " + describeEffectInline(inner, ctx) + "."
	case "rules-bundle", "sequence":
		steps := getList(e, "steps")
		if rider, ok := rollWithRider(steps, ctx); ok {
			return indent + arrow + capitalize(rider) + "."
		}
		parts := make([]string, len(steps))
		for i, s := range steps {
			parts[i] = describeEffect(mapOr(s), depth, ctx)
		}
		return strings.Join(parts, "\n")
	case "ability-part":
		inner := mapOr(e["effect"])
		if containerTypes[ejstrType(inner)] {
			return indent + "-> " + capitalize(partHead(e)) + ":\n" + describeEffect(inner, depth+1, ctx)
		}
		return indent + "-> " + capitalize(partInline(e, ctx)) + "."
	case "choice":
		lines := []string{indent + capitalize(choicePrompt(e)) + ":"}
		for _, o := range getList(e, "options") {
			lines = append(lines, indent+"  - "+capitalize(describeEffectInline(mapOr(o), ctx))+".")
		}
		return strings.Join(lines, "\n")
	case "dice-gated":
		if jsTruthy(e["test"]) {
			return indent + arrow + capitalize(leadershipTest(e, ctx)) + "."
		}
		return indent + arrow + capitalize(diceGate(e, ctx)) + "."
	case "roll":
		inner := mapOr(e["effect"])
		head := indent + arrow + capitalize(rollHead(e))
		if containerTypes[ejstrType(inner)] {
			return head + ", then:\n" + describeEffect(inner, depth+1, ctx)
		}
		return head + "; then " + describeEffectInline(inner, ctx) + "."
	case "select-objective":
		inner := mapOr(e["effect"])
		nested := ""
		hasNested := containerTypes[ejstrType(inner)]
		if hasNested {
			nested = describeEffect(inner, depth+1, ctx)
		}
		return selectObjectiveBlock(e, indent, arrow, nested, hasNested, func(x any) string { return describeEffectInline(mapOr(x), ctx) })
	case "dice-table":
		lines := []string{indent + arrow + "Roll one " + diceCase(e["dice"]) + ":"}
		for _, o := range getList(e, "outcomes") {
			om := mapOr(o)
			lines = append(lines, indent+"  - On "+diceTableResultLabel(om["results"])+": "+capitalize(describeEffectInline(mapOr(om["effect"]), ctx))+".")
		}
		return strings.Join(lines, "\n")
	case "dice-pool-allocation":
		upTo := " to activate the following"
		if e["max_activations"] != nil {
			upTo = " to activate up to " + ejstr(e["max_activations"]) + " of the following"
		}
		lines := []string{indent + arrow + "Roll " + dicePoolLabel(e) + "; allocate dice" + upTo + ":"}
		for _, o := range getList(e, "options") {
			om := mapOr(o)
			lines = append(lines, indent+"  - "+ejstr(om["name"])+" (requires "+describeRequirement(om["requirement"])+"): "+describeEffectInline(mapOr(om["effect"]), ctx)+".")
		}
		return strings.Join(lines, "\n")
	case "select-units":
		return selectUnitsBlock(e, indent, arrow, depth, ctx)
	case "leader-model-ability-grant":
		return indent + arrow + capitalize(leaderModelAbilityGrantClause(e, ctx)) + "."
	case "persistent-designation":
		if e["operation"] == "replace" {
			return indent + arrow + capitalize(persistentDesignationReplacement(e)) + "."
		}
		if !persistentDesignationSupported(e) {
			return indent + arrow + "[persistent-designation]."
		}
		inner := mapOr(mapOr(e["consumer"])["effect"])
		head := indent + arrow + capitalize(persistentDesignationLead(e)) + " " + persistentDesignationWhen(e)
		if containerTypes[ejstrType(inner)] {
			return head + ":\n" + describeEffect(inner, depth+1, ctx)
		}
		return head + ", " + describeEffectInline(inner, ctx) + "."
	case "for-each-unit":
		sel := mapOr(e["selector"])
		inner := mapOr(e["effect"])
		selectedCtx := selectedContext(ctx, sel)
		lead := "For each " + forEachUnitSubject(sel)
		if containerTypes[ejstrType(inner)] {
			return indent + lead + ":\n" + describeEffect(inner, depth+1, selectedCtx)
		}
		return indent + lead + ": " + capitalize(describeEffectInline(inner, selectedCtx)) + "."
	case "designate-target":
		return designateTargetBlock(e, indent, arrow, depth, ctx)
	case "stance-select":
		when := "At the start of your turn"
		if s, ok := e["select"].(string); ok {
			when = capitalize(eventClause(s))
		}
		consum := ""
		if e["mode"] == "consumable" {
			consum = " (each may be chosen once per battle)"
		}
		lines := []string{indent + arrow + when + ", " + stancePick(e) + consum + ":"}
		for _, o := range getList(e, "options") {
			om := mapOr(o)
			lines = append(lines, indent+"  - "+ejstr(om["name"])+": "+describeEffectInline(mapOr(om["effect"]), ctx)+".")
		}
		return strings.Join(lines, "\n")
	case "risk-reward":
		risk := mapOr(e["risk"])
		onFail := "there is a consequence"
		if jsTruthy(risk["on_fail"]) {
			onFail = describeEffectInline(mapOr(risk["on_fail"]), ctx)
		}
		return indent + arrow + "First take a " + testName(risk["test"]) + " test — on a failure, " + onFail + "; then " + describeEffectInline(mapOr(e["reward"]), ctx) + "."
	case "issue-orders":
		n := "one or more"
		if e["count"] != nil {
			n = ejstr(e["count"])
		}
		rng := ""
		if e["range"] != nil {
			rng = " within " + ejstr(e["range"]) + "\""
		}
		elig := ""
		if kw := mapOr(e["eligible"])["keyword"]; jsTruthy(kw) {
			elig = " " + ejstr(kw)
		}
		lines := []string{indent + arrow + "Issue up to " + n + " Orders to eligible friendly" + elig + " units" + rng + ", each one of:"}
		for _, o := range getList(e, "options") {
			om := mapOr(o)
			lines = append(lines, indent+"  - "+ejstr(om["name"])+": "+describeEffectInline(mapOr(om["effect"]), ctx)+".")
		}
		return strings.Join(lines, "\n")
	case "resource-action-menu":
		return resourceActionMenuBlock(e, indent, arrow, ctx)
	}
	return indent + arrow + capitalize(describeEffectInline(e, ctx)) + "."
}

func selectUnitsBlock(e map[string]any, indent, arrow string, depth int, ctx effCtx) string {
	sel := mapOr(e["selector"])
	inner := mapOr(e["effect"])
	selectedCtx := selectedContext(ctx, sel)
	engagement := selectUnitsEngagement(sel)
	lead := "Select " + selectUnitsSubject(sel) + selectionBinding(sel)
	header := indent + arrow + lead
	if engagement != "" {
		header += ". " + engagement
	}
	if containerTypes[ejstrType(inner)] {
		trimmed := strings.TrimSuffix(header, ".")
		if selectUnitsPlural(sel) {
			noun := "unit"
			if sel["target_kind"] == "model" {
				noun = "model"
			}
			return trimmed + ":\n" + indent + "  -> For each selected " + noun + ":\n" + describeEffect(inner, depth+2, selectedCtx)
		}
		return trimmed + ":\n" + describeEffect(inner, depth+1, selectedCtx)
	}
	nested := selectedRecipient(describeEffectInline(inner, selectedCtx), sel)
	if engagement != "" {
		return header + " " + capitalize(nested) + "."
	}
	return header + ": " + nested + "."
}
