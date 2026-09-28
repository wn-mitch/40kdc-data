package wh40kdc

import "strings"

// The ability-level sentence of the effect describer: trigger, usage and
// duration lead-ins, ability parts, resource-action menus and the
// `Applies to:` footer. Mirror of the top-level half of
// tools/src/translate/effect.ts.

// menuActionSubject renders the eligible-unit noun phrase for a menu action.
func menuActionSubject(elig map[string]any) string {
	requires := jstrList(elig["requires_keyword"])
	excludes := jstrList(elig["excludes_keyword"])
	if len(excludes) > 0 {
		return "one friendly non-" + strings.Join(excludes, "/") + " unit"
	}
	if len(requires) > 0 {
		return "a friendly " + strings.Join(requires, " ") + " unit"
	}
	return "the unit"
}

// menuActionEligibilityClause renders a trailing parenthetical naming which
// unit may use a menu action and any extra requirements.
func menuActionEligibilityClause(elig map[string]any) string {
	if elig == nil {
		return ""
	}
	hasKeywordGate := len(getList(elig, "requires_keyword")) > 0 || len(getList(elig, "excludes_keyword")) > 0
	var reqs []string
	for _, c := range getList(elig, "requires") {
		reqs = append(reqs, describeCondition(mapOr(c)))
	}
	if !hasKeywordGate && len(reqs) == 0 {
		return ""
	}
	var parts []string
	if hasKeywordGate {
		parts = append(parts, "only usable by "+menuActionSubject(elig))
	}
	if len(reqs) > 0 {
		parts = append(parts, strings.Join(reqs, " and "))
	}
	return " (" + strings.Join(parts, ", ") + ")"
}

func menuActionDurationClause(duration any) string {
	switch duration {
	case "until-end-of-phase":
		return "until the end of the phase"
	case "until-end-of-turn":
		return "until the end of the turn"
	}
	return ""
}

// describeMenuAction renders one resource-action-menu action as a bullet body.
func describeMenuAction(a map[string]any, ctx effCtx) string {
	label := a["label"]
	if label == nil {
		label = a["id"]
	}
	var trigs []string
	for _, t := range normalizeTriggers(a["when"]) {
		if s := describeReactiveTrigger(t); s != "" {
			trigs = append(trigs, s)
		}
	}
	cost := mapOr(a["cost"])
	costPhrase := "spend " + ejstr(cost["amount"]) + " " + resourceNoun(cost["pool_id"], cost["resource_label"], cost["amount"])
	eff := describeEffectInline(mapOr(a["effect"]), ctx)
	usageNote := ""
	if jsTruthy(mapOr(a["usage"])["repeatable_if_different_unit"]) {
		usageNote = " (may be triggered more than once per phase if a different unit performs it each time)"
	}
	elig, _ := asMap(a["eligibility"])
	var body []string
	for _, p := range []string{strings.Join(trigs, " or ") + menuActionEligibilityClause(elig), costPhrase, eff, menuActionDurationClause(a["duration"])} {
		if p != "" {
			body = append(body, p)
		}
	}
	return ejstr(label) + ": " + strings.Join(body, ", ") + usageNote + "."
}

var capacityRefresh = map[string]string{"battle-round": "battle round", "turn": "turn", "phase": "phase", "battle": "battle"}

// capacityClause renders a menu's per-refresh budget sentence ("" when absent).
func capacityClause(capacity map[string]any) string {
	if capacity == nil {
		return ""
	}
	label := ejstr(capacity["resource_label"])
	noun := ejstr(capacity["ability_noun"])
	amount := ejstr(capacity["amount"])
	refresh, ok := capacityRefresh[ejstr(capacity["refresh"])]
	if !ok {
		refresh = dekebab(ejstr(capacity["refresh"]))
	}
	return "This unit has a " + label + " of " + amount + ". In each " + refresh + ", it can use " + noun + " abilities whose combined " + label + " does not exceed " + amount + "."
}

// sharedUsageClause renders a menu-level usage fragment ("" when absent).
func sharedUsageClause(su map[string]any) string {
	if su == nil {
		return ""
	}
	var parts []string
	if v := su["unit_max_manoeuvres_per_phase"]; v != nil {
		if v == 1.0 {
			parts = append(parts, "a unit may perform at most one action per phase")
		} else {
			parts = append(parts, "a unit may perform at most "+ejstr(v)+" actions per phase")
		}
	}
	if v := su["default_manoeuvre_max_per_phase"]; v != nil {
		if v == 1.0 {
			parts = append(parts, "unless stated otherwise, a given action may be triggered once per phase")
		} else {
			parts = append(parts, "unless stated otherwise, a given action may be triggered up to "+ejstr(v)+" times per phase")
		}
	}
	return strings.Join(parts, "; ")
}

func resourceActionMenuBlock(e map[string]any, indent, arrow string, ctx effCtx) string {
	su, _ := asMap(e["shared_usage"])
	suText := sharedUsageClause(su)
	intro := "Actions may be performed when their conditions are met"
	if suText != "" {
		intro = "Actions may be performed when their conditions are met. " + capitalize(suText)
	}
	lines := []string{indent + arrow + intro + ":"}
	for _, a := range getList(e, "actions") {
		lines = append(lines, indent+"  - "+describeMenuAction(mapOr(a), ctx))
	}
	capacity, _ := asMap(e["capacity"])
	if c := capacityClause(capacity); c != "" {
		return indent + c + "\n" + strings.Join(lines, "\n")
	}
	return strings.Join(lines, "\n")
}

// usageClause renders a usage limit as a front-of-sentence lead ("once per turn").
func usageClause(usage any) string {
	// Several limits that all apply: "once per battle per model and once per battle round per army".
	if l, ok := asList(usage); ok {
		parts := make([]string, len(l))
		for i, x := range l {
			parts[i] = usageClause(x)
		}
		return strings.Join(parts, " and ")
	}
	u := mapOr(usage)
	c := u["count"]
	if c == nil {
		c = 1.0
	}
	n := jsNumber(c)
	var base string
	switch u["frequency"] {
	case "once-per-turn":
		base = "once per turn"
	case "once-per-phase":
		base = "once per phase"
	case "once-per-battle-round":
		base = "once per battle round"
	case "once-per-command-phase":
		base = "once per Command phase"
	case "once-per-opponent-turn":
		base = "once per opponent's turn"
	case "first-this-battle":
		base = "the first time this battle"
	case "first-time-this-phase":
		base = "the first time this phase"
	case "n-per-battle":
		switch n {
		case 1:
			base = "once per battle"
		case 2:
			base = "twice per battle"
		default:
			base = numStr(n) + " times per battle"
		}
	default:
		base = dekebab(ejstr(u["frequency"]))
	}
	if u["per"] != nil {
		return base + " per " + ejstr(u["per"])
	}
	return base
}

// partHead renders what leads an ability part: its moment, usage limit, name,
// the choice to use it and its cost.
func partHead(e map[string]any) string {
	var moments []string
	for _, t := range normalizeTriggers(e["trigger"]) {
		if s := describeReactiveTrigger(t); s != "" {
			moments = append(moments, s)
		}
	}
	level := ""
	if e["kind"] == "psychic" && e["level"] != nil {
		level = " (Psychic level " + ejstr(e["level"]) + ")"
	}
	named := ""
	if jsTruthy(e["name"]) {
		use := "use "
		if jsTruthy(e["optional"]) {
			use = "you can use "
		}
		named = use + ejstr(e["name"]) + level
	} else if jsTruthy(e["optional"]) {
		named = "you can"
	}
	cost := ""
	if jsTruthy(e["cost"]) {
		cost = "by paying this cost (" + describeEffectInline(mapOr(e["cost"]), effCtx{}) + ")"
	}
	usage := ""
	if isObject(e["usage"]) {
		usage = usageClause(e["usage"])
	}
	_, trail := durationClauses(e["duration"])
	return joinNonEmpty([]string{strings.Join(moments, " or "), usage, named, cost, trail}, ", ")
}

// partInline renders a part on one line: its head, then its effect.
func partInline(e map[string]any, ctx effCtx) string {
	head := partHead(e)
	body := describeEffectInline(mapOr(e["effect"]), ctx)
	if head != "" {
		return head + ": " + body
	}
	return body
}

// describeAppliesTo renders the roster-highlighting audience of a curated
// applies_to filter ("" when it names no keywords).
func describeAppliesTo(a map[string]any) string {
	if a == nil {
		return ""
	}
	required := jstrList(a["required_keywords"])
	excluded := jstrList(a["excluded_keywords"])
	if len(required) == 0 && len(excluded) == 0 {
		return ""
	}
	base := "all units"
	if len(required) > 0 {
		base = "units with " + strings.Join(required, ", ")
	}
	exc := ""
	if len(excluded) > 0 {
		exc = " (excluding " + strings.Join(excluded, ", ") + ")"
	}
	return "Applies to: " + base + exc + "."
}

func joinNonEmpty(parts []string, sep string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}

// assembleSentence joins non-empty clauses, capitalizes and ends with a period.
func assembleSentence(parts []string) string {
	body := joinNonEmpty(parts, ", ")
	if body == "" {
		return ""
	}
	if strings.HasSuffix(body, ".") || strings.HasSuffix(body, ":") {
		return capitalize(body)
	}
	return capitalize(body) + "."
}

// describeAbility renders the full generated text for an ability: the effect
// sentence plus a trailing `Applies to:` line.
func describeAbility(a map[string]any) string {
	core := ""
	if e, ok := asMap(a["effect"]); ok && e != nil {
		scope, _ := asMap(a["scope"])
		core = renderTopLevel(e, scope, a["usage"], a["trigger"])
	}
	applies, _ := asMap(a["applies_to"])
	return joinNonEmpty([]string{core, describeAppliesTo(applies)}, "\n")
}

// conditionWithinRange is the inch range of a top-level `within` condition.
func conditionWithinRange(c map[string]any) (float64, bool) {
	if c == nil || c["type"] != "within" {
		return 0, false
	}
	r := mapOr(paramsOf(c)["range"])
	f, ok := r["inches"].(float64)
	return f, ok
}

func renderTopLevel(e, scope map[string]any, usage, trigger any) string {
	ctx := effCtx{}
	var scopeDuration any
	if scope != nil {
		scopeDuration = scope["duration"]
	}
	durLead, trail := durationClauses(scopeDuration)
	lead := durLead
	// An explicit usage limit (or a list of them) supersedes the duration's coarse "once per battle" lead.
	if isList(usage) || mapOr(usage)["frequency"] != nil {
		lead = usageClause(usage)
	}
	var condRange float64
	hasCondRange := false
	if e["type"] == "conditional" {
		condRange, hasCondRange = conditionWithinRange(mapOr(e["condition"]))
	}
	var trigs []string
	for _, t := range normalizeTriggers(trigger) {
		if t["event"] == "destroyed" || t["event"] == "model-destroyed" {
			ctx.destroyedTrigger = true
		}
	}
	for _, t := range normalizeTriggers(trigger) {
		if t["event"] == nil {
			continue
		}
		tt := t
		if hasCondRange {
			if in, ok := mapOr(mapOr(t["proximity"])["range"])["inches"].(float64); ok && in == condRange {
				tt = make(map[string]any, len(t))
				for k, v := range t {
					if k != "proximity" {
						tt[k] = v
					}
				}
			}
		}
		// Two triggers that read the same are one trigger in English ("when X or when X").
		if s := describeReactiveTrigger(tt); s != "" && !containsStr(trigs, s) {
			trigs = append(trigs, s)
		}
	}
	trig := strings.Join(trigs, " or ")
	if e["type"] == "conditional" {
		inner := mapOr(e["effect"])
		leadIn := conditionLeadIn(mapOr(e["condition"]))
		if containerTypes[ejstrType(inner)] {
			header := joinNonEmpty([]string{trig, lead, leadIn, trail}, ", ")
			return capitalize(header) + ":\n" + describeEffect(inner, 1, ctx)
		}
		return assembleSentence([]string{trig, lead, leadIn, trail, describeEffectInline(inner, ctx)})
	}
	if containerTypes[ejstrType(e)] {
		ownDuration := (e["type"] == "designate-target" || e["type"] == "persistent-designation") && e["duration"] != nil
		t := trail
		if ownDuration {
			t = ""
		}
		head := joinNonEmpty([]string{trig, lead, t}, ", ")
		if head != "" {
			return capitalize(head) + ":\n" + describeEffect(e, 1, ctx)
		}
		return describeEffect(e, 0, ctx)
	}
	return assembleSentence([]string{trig, lead, trail, describeEffectInline(e, ctx)})
}

func containsStr(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}
