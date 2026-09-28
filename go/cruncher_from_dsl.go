package wh40kdc

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Translate an Ability DSL effect tree into the Buff stack it contributes,
// plus the fragments it could not auto-apply (unsupported) and player-decision
// levers (activatable). Go mirror of python .../cruncher/from_dsl.py. Applied
// order and unsupported-reason strings are pinned by
// conformance/abilities-resolver/from-dsl.json / defensive-from-dsl.json.

var selfTargets = map[string]bool{
	"this-unit": true, "this-model": true, "selected-unit": true, "recipient": true,
}

// modelTargets is the subset of selfTargets naming a single *model* (the bearer)
// rather than its unit. Core rule 19.04: a rule affecting one specified model
// applies only to that model, even while it is part of an attached unit.
var modelTargets = map[string]bool{"this-model": true}

// modelScopedReason is the diagnostic for a model-scoped effect pooled in from an
// attached member.
const modelScopedReason = "model-scoped effect from an attached model: applies to that model only (core rule 19.04)"

const stochasticDiceGatedReason = "dice-gated effect: stochastic; not expressible as a buff"

var defenderTargets = map[string]bool{"defender": true}

type effectTranslation struct {
	applied     []any
	unsupported []any
	activatable []any
}

type dslOpts struct {
	context       map[string]any
	perspective   string
	abilityID     string
	defaultTarget string
}

// effectToBuffs walks an ability DSL effect tree, producing the buff stack plus
// unsupported and activatable lists.
func effectToBuffs(effect any, source map[string]any, context map[string]any, perspective string) *effectTranslation {
	out := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	abilityID := "effect"
	if getStr(source, "kind") == "ability" {
		if a := getStr(source, "abilityId"); a != "" {
			abilityID = a
		}
	}
	opts := dslOpts{context: context, perspective: perspective, abilityID: abilityID}
	dslWalk(effect, source, opts, out)
	return out
}

// isModelScopedFromAttachedMember reports whether this node is a model-scoped
// effect reaching the buffed unit from *another* member of the combined unit.
// Core rule 19.04 keeps those on their own model: an attached Librarian's
// personal 4+ invulnerable save is not a 4+ invulnerable save for the ten
// Intercessors it joined.
//
// Keyed on the buff source, not on the DSL condition — the leak is not limited to
// abilities gated on is-attached (an Archon's Shadowfield says only "the bearer"),
// and the resolver already tags pooled member abilities as abilityKind "attached".
// An ability read as the chosen unit's own (abilityKind "unit") is unaffected.
func isModelScopedFromAttachedMember(node map[string]any, source map[string]any) bool {
	if getStr(source, "kind") != "ability" || getStr(source, "abilityKind") != "attached" {
		return false
	}
	return modelTargets[getStr(node, "target")]
}

func dslWalk(node any, source map[string]any, opts dslOpts, out *effectTranslation) {
	n, ok := asMap(node)
	if !ok || n == nil {
		return
	}
	if _, has := n["target"]; opts.defaultTarget != "" && !has {
		withTarget := make(map[string]any, len(n)+1)
		for k, v := range n {
			withTarget[k] = v
		}
		withTarget["target"] = opts.defaultTarget
		n = withTarget
	}
	// Core rule 19.04 gate, applied before any leaf translation and under both
	// perspectives. Safe at this level because no container node (sequence,
	// conditional, choice, …) carries a self/bearer target — only leaves do — so
	// this can never swallow a subtree holding unit-scoped effects too.
	if isModelScopedFromAttachedMember(n, source) {
		out.unsupported = append(out.unsupported, unsup(modelScopedReason, n))
		return
	}
	if hasUnresolvedFidelityBinding(n) {
		out.unsupported = append(out.unsupported, unsup(fidelityBindingReason, n))
		return
	}
	// An `incoming` change modifies attacks made against its target. On the buffed unit it is the
	// attacker's side of those attacks, which the `target: "attacker"` form already models; it never
	// modifies the buffed unit's own attacks.
	if m, ok := getMap(n, "modifier"); ok && m != nil && m["incoming"] == true && classifyTarget(n) == "self" {
		if opts.perspective == "attacker" {
			return
		}
		if n["type"] == "roll-modifier" || n["type"] == "stat-modifier" {
			stripped := make(map[string]any, len(m))
			for k, v := range m {
				if k != "incoming" {
					stripped[k] = v
				}
			}
			redirected := make(map[string]any, len(n))
			for k, v := range n {
				redirected[k] = v
			}
			redirected["target"] = "attacker"
			redirected["modifier"] = stripped
			dslWalk(redirected, source, opts, out)
		} else {
			out.unsupported = append(out.unsupported, unsup(jsStr(n["type"])+": an incoming change to attacks against the unit is not modelled", n))
		}
		return
	}
	switch getStr(n, "type") {
	case "re-roll":
		translateReroll(n, source, opts, out)
	case "roll-modifier":
		translateRollModifier(n, source, opts, out)
	case "stat-modifier":
		translateStatModifier(n, source, opts, out)
	case "feel-no-pain":
		translateFeelNoPain(n, source, opts, out)
	case "weapon-ability-grant":
		translateKeywordGrant(n, source, opts, out)
	case "damage-reduction":
		translateDamageReduction(n, source, opts, out)
	case "invulnerable-save":
		translateInvulnerableSave(n, source, opts, out)
	case "named-region-state":
		translateNamedRegionState(n, source, opts, out)
	case "conditional":
		translateConditional(n, source, opts, out)
	case "rules-bundle", "sequence":
		for _, step := range getList(n, "steps") {
			dslWalk(step, source, opts, out)
		}
	case "ability-part":
		// A part firing on its own moment is gated like a timing-is step; one with only a cost,
		// a choice or a usage limit is an activation, as a named effect is.
		if n["trigger"] == nil && (n["optional"] == true || n["cost"] != nil || n["usage"] != nil) {
			translateNamedEffect(n, source, opts, out)
		} else {
			dslWalk(momentGate(n["trigger"], n["effect"]), source, opts, out)
		}
	case "choice":
		enumerateChoice(n, source, opts, out)
	case "dice-gated":
		out.unsupported = append(out.unsupported, unsup(stochasticDiceGatedReason, n))
	case "dice-pool-allocation":
		enumerateDicePool(n, source, opts, out)
	case "select-units":
		// Targeting wrapper — the selected units receive the nested effect.
		dslWalk(n["effect"], source, opts, out)
	case "aura":
		// An aura's own target names the side it reaches, not a unit-ref: friendly recipients are the
		// buffed side, enemy ones the other.
		side := "unknown"
		switch n["target"] {
		case "friendly-within-aura":
			side = "self"
		case "enemy-within-aura":
			side = "defender"
		}
		if side == "unknown" || (side == "defender" && opts.perspective != "target") {
			return
		}
		modifier, _ := getMap(n, "modifier")
		if recipientFilter, present := modifier["recipient_filter"]; present {
			matches, reason := auraRecipientFilterMatches(recipientFilter, opts.context, opts.perspective)
			if reason != "" {
				out.unsupported = append(out.unsupported, unsup("aura recipient keywords are unavailable or its filter is malformed", n))
				return
			}
			if !matches {
				return
			}
		}
		if emitterFilter, present := modifier["emitter_filter"]; present {
			matches, _ := auraRecipientFilterMatches(emitterFilter, nil, opts.perspective)
			if !matches {
				out.unsupported = append(out.unsupported, unsup("aura emitter filter requires the source unit's keywords", n))
				return
			}
		}
		effect, ok := getMap(modifier, "effect")
		if ok && effect != nil {
			dslWalk(effect, source, opts, out)
		} else {
			out.unsupported = append(out.unsupported, unsup("aura without nested effect: not a combat buff", n))
		}
	case "leader-model-ability-grant":
		out.unsupported = append(out.unsupported, unsup("leader-model-ability-grant: attached leader beneficiary is not resolved by the buff engine", n))
	case "persistent-designation":
		out.unsupported = append(out.unsupported, unsup("persistent-designation: retained selection state is not resolved by the buff engine", n))
	case "designate-target":
		// Mark an enemy unit; when `to: attackers-of-target` the nested effect is
		// a buff every friendly attack against that unit receives (Oath of Moment).
		// A `to: target` debuff lands on the enemy, not the bearer, so it is not a
		// buff in this perspective.
		applies, _ := getMap(n, "applies")
		if applies["to"] == "attackers-of-target" {
			dslWalk(applies["effect"], source, opts, out)
		} else {
			out.unsupported = append(out.unsupported, unsup("designate-target debuff on the marked unit: not a buff on the bearer", n))
		}
	case "risk-reward":
		// The reward is the buff; the risk (self-damage on a failed test) is not.
		dslWalk(n["reward"], source, opts, out)
	case "stance-select":
		// Pick-one modal buff — each option is an opt-in lever (pick one).
		enumerateNamedOptions(n, source, opts, out, opts.abilityID+"?stance", 1)
	case "issue-orders":
		// Officer issues one Order from the menu — each is an opt-in lever.
		enumerateNamedOptions(n, source, opts, out, opts.abilityID+"?order", 1)
	case "resource-action-menu":
		// Each action is an INDEPENDENT reactive lever, not a pick-one group:
		// unlike stance-select/issue-orders, multiple actions (and repeats of
		// the same action by different units — see
		// usage.repeatable_if_different_unit) can fire in the same phase, so
		// no shared group/maxActivations cap is attached here.
		enumerateMenuActions(n, source, opts, out)
	default:
		out.unsupported = append(out.unsupported, unsup("effect type \""+jsStr(n["type"])+"\" is not modelled by the buff layer", n))
	}
}

// attackStepRolls are the rolls inside every attack: a trigger on one applies
// to each attack it modifies.
var attackStepRolls = map[string]bool{"hit": true, "wound": true, "save": true, "damage": true}

// isAttackStep reports a trigger on a step of every attack (a hit, wound, save
// or damage roll, or allocating damage).
func isAttackStep(trigger any) bool {
	t, ok := asMap(trigger)
	if !ok || t == nil {
		return false
	}
	if t["event"] == "damage-allocated" {
		return true
	}
	var roll any
	if f, ok := asMap(t["filter"]); ok && f != nil {
		roll = f["roll"]
	}
	r, isStr := roll.(string)
	return (t["event"] == "before-roll" || t["event"] == "after-roll") && isStr && attackStepRolls[r]
}

// momentKey is the lever key of a trigger: its event family and the filter
// value that tells moments apart (<family>[:<key>]).
func momentKey(trigger map[string]any) string {
	f, _ := asMap(trigger["filter"])
	if f == nil {
		f = map[string]any{}
	}
	var moveTypes any
	if l, ok := asList(f["move_types"]); ok {
		parts := make([]string, len(l))
		for i, e := range l {
			if e != nil {
				parts[i] = cstr(e)
			}
		}
		moveTypes = strings.Join(parts, "+")
	}
	for _, v := range []any{f["to"], f["kind"], f["roll"], moveTypes, f["from"]} {
		if s, ok := v.(string); ok && s != "" {
			return jsStr(trigger["event"]) + ":" + s
		}
	}
	return jsStr(trigger["event"])
}

// ownMoveFact is the unit's own move the engine context records: a Charge (or
// Advance) move is "charged this turn".
func ownMoveFact(trigger map[string]any) map[string]any {
	if trigger["event"] != "move-ended" || (trigger["subject"] != nil && trigger["subject"] != "this-unit") {
		return nil
	}
	var types []any
	if f, ok := asMap(trigger["filter"]); ok && f != nil {
		types, _ = asList(f["move_types"])
	}
	if len(types) != 1 || (types[0] != "charge" && types[0] != "advance") {
		return nil
	}
	return map[string]any{"type": "happened", "parameters": map[string]any{
		"event": "move-ended", "filter": map[string]any{"move_types": types}, "window": "turn",
	}}
}

// momentGate gates an effect on a trigger (one, or several alternatives) the way
// a timing-is condition gates it, so the moment is a player-controlled gate and a
// buff behind it an opt-in lever (<ability>@<event>). A trigger on an attack step
// is met by every attack: only its own condition gates the effect. If any
// alternative leaves no gate, the effect is returned ungated.
func momentGate(trigger any, effect any) any {
	if effect == nil {
		return effect
	}
	candidates, ok := trigger.([]any)
	if !ok {
		candidates = []any{trigger}
	}
	var gates []any
	for _, candidate := range candidates {
		t, ok := asMap(candidate)
		if !ok || t == nil {
			continue
		}
		if _, ok := t["event"].(string); !ok {
			continue
		}
		own, hasOwn := asMap(t["condition"])
		hasOwn = hasOwn && own != nil
		if isAttackStep(t) {
			if !hasOwn {
				// Met by every attack without a condition: nothing to gate.
				return effect
			}
			gates = append(gates, own)
			continue
		}
		// A unit's own Charge or Advance move is a fact the context carries, not a choice.
		moment := ownMoveFact(t)
		if moment == nil {
			moment = map[string]any{"type": "timing-is", "parameters": map[string]any{"timing": momentKey(t)}}
		}
		if hasOwn {
			gates = append(gates, map[string]any{"operator": "and", "operands": []any{moment, own}})
		} else {
			gates = append(gates, moment)
		}
	}
	if len(gates) == 0 {
		return effect
	}
	var condition any = gates[0]
	if len(gates) > 1 {
		condition = map[string]any{"operator": "or", "operands": gates}
	}
	return map[string]any{"type": "conditional", "condition": condition, "effect": effect}
}

// translateNamedEffect treats an un-gated named rule as transparent. Named
// rules with an optional/cost/trigger/usage gate become one opt-in lever while
// preserving any nested levers and unsupported fragments discovered in the
// body. Trigger conditions are wrapped around the body so they remain a
// resolver-visible guard rather than being silently discarded.
func translateNamedEffect(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if node["optional"] != true && node["cost"] == nil && node["trigger"] == nil && node["usage"] == nil {
		dslWalk(node["effect"], source, opts, out)
		return
	}

	var triggers []any
	if raw, ok := asList(node["trigger"]); ok {
		triggers = raw
	} else if node["trigger"] != nil {
		triggers = []any{node["trigger"]}
	}
	conditions := make([]any, 0, len(triggers))
	for _, raw := range triggers {
		trigger, ok := asMap(raw)
		if !ok {
			continue
		}
		if condition, ok := getMap(trigger, "condition"); ok {
			conditions = append(conditions, condition)
		}
	}
	body := node["effect"]
	if len(conditions) > 0 && len(conditions) == len(triggers) {
		var condition any = conditions[0]
		if len(conditions) > 1 {
			operands := make([]any, len(conditions))
			copy(operands, conditions)
			condition = map[string]any{"operator": "or", "operands": operands}
		}
		body = map[string]any{
			"type":      "conditional",
			"condition": condition,
			"effect":    node["effect"],
		}
	}

	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(body, source, opts, sub)
	out.unsupported = append(out.unsupported, sub.unsupported...)
	out.activatable = append(out.activatable, sub.activatable...)
	if len(sub.applied) > 0 {
		name := getStr(node, "name")
		if name == "" {
			name = labelForBuffs(sub.applied)
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":    opts.abilityID + "#" + name,
			"label": name,
			"buffs": sub.applied,
		})
	}
}

// --- activatable-lever enumeration ---
func enumerateChoice(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	options, _ := asList(node["options"])
	maxActivations := float64(1)
	if isNumber(node["max_choices"]) {
		maxActivations, _ = num(node["max_choices"])
	}
	for i, opt := range options {
		var buffs []any
		collectGatedBuffs(opt, source, opts, map[string]any{}, &buffs)
		if len(buffs) == 0 {
			continue
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":    opts.abilityID + "?" + strconv.Itoa(i),
			"label": labelForBuffs(buffs),
			"buffs": buffs,
			"group": map[string]any{"id": opts.abilityID + "?choice", "maxActivations": maxActivations},
		})
	}
}

func enumerateDicePool(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	options, _ := asList(node["options"])
	var maxActivations float64
	if isNumber(node["max_activations"]) {
		maxActivations, _ = num(node["max_activations"])
	} else {
		maxActivations = float64(len(options))
	}
	for _, optAny := range options {
		opt, ok := asMap(optAny)
		if !ok {
			continue
		}
		var buffs []any
		collectGatedBuffs(opt["effect"], source, opts, map[string]any{}, &buffs)
		if len(buffs) == 0 {
			continue
		}
		name, _ := opt["name"].(string)
		if name == "" {
			name = labelForBuffs(buffs)
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":    opts.abilityID + "#" + name,
			"label": name,
			"buffs": buffs,
			"group": map[string]any{"id": opts.abilityID, "maxActivations": maxActivations},
		})
	}
}

// enumerateNamedOptions emits one opt-in lever per buff-bearing named option
// (stance-select / issue-orders), grouped under groupID with maxActivations.
func enumerateNamedOptions(node, source map[string]any, opts dslOpts, out *effectTranslation, groupID string, maxActivations float64) {
	options, _ := asList(node["options"])
	for _, optAny := range options {
		opt, ok := asMap(optAny)
		if !ok {
			continue
		}
		var buffs []any
		collectGatedBuffs(opt["effect"], source, opts, map[string]any{}, &buffs)
		if len(buffs) == 0 {
			continue
		}
		name, _ := opt["name"].(string)
		if name == "" {
			name = labelForBuffs(buffs)
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":    opts.abilityID + "#" + name,
			"label": name,
			"buffs": buffs,
			"group": map[string]any{"id": groupID, "maxActivations": maxActivations},
		})
	}
}

// enumerateMenuActions emits one opt-in lever per buff-bearing
// resource-action-menu action. Unlike enumerateNamedOptions (stance-select /
// issue-orders, a pick-one group), each action here is an INDEPENDENT
// decision with its own trigger and cost — no shared group/maxActivations
// cap, since a unit's per-phase manoeuvre limit isn't a mutual-exclusion pool
// the cruncher can enforce (and usage.repeatable_if_different_unit
// explicitly allows the same action to recur via a different unit in one
// phase). A single eligibility.requires_keyword narrows the lever to
// attackers carrying that keyword; multiple required keywords have no
// single-field applicability representation today and are left ungated
// (correctness-conservative: the lever still surfaces, just without that
// extra restriction attached).
func enumerateMenuActions(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	actions, _ := asList(node["actions"])
	for _, actionAny := range actions {
		action, ok := asMap(actionAny)
		if !ok {
			continue
		}
		applicability := map[string]any{}
		if elig, ok := getMap(action, "eligibility"); ok {
			requiresKeyword := getStrList(elig, "requires_keyword")
			if len(requiresKeyword) == 1 {
				applicability = map[string]any{"requiresAttackerKeyword": requiresKeyword[0]}
			}
		}
		var buffs []any
		collectGatedBuffs(action["effect"], source, opts, applicability, &buffs)
		if len(buffs) == 0 {
			continue
		}
		label, _ := action["label"].(string)
		if label == "" {
			label = labelForBuffs(buffs)
		}
		id, _ := action["id"].(string)
		if id == "" {
			id = label
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":    opts.abilityID + "#" + id,
			"label": label,
			"buffs": buffs,
		})
	}
}

func enumerateTimingGate(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	condition, ok := getMap(node, "condition")
	if !ok {
		return
	}
	var buffs []any
	collectGatedBuffs(node["effect"], source, opts, map[string]any{}, &buffs)
	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(node["effect"], source, opts, sub)
	// A stochastic branch contributes nothing to a timing activation. Preserve
	// every other unsupported diagnostic discovered while finding inner levers.
	for _, unsupported := range sub.unsupported {
		fragment, ok := asMap(unsupported)
		if ok && getStr(fragment, "reason") == stochasticDiceGatedReason {
			effectFragment, isDiceGate := asMap(fragment["effectFragment"])
			if isDiceGate && getStr(effectFragment, "type") == "dice-gated" {
				continue
			}
		}
		out.unsupported = append(out.unsupported, unsupported)
	}
	// Inner independent decisions pass straight through as their own levers.
	out.activatable = append(out.activatable, sub.activatable...)
	// Inner unconditional buffs become one lever gated only on the timing.
	if len(buffs) > 0 {
		timing := extractTiming(condition)
		if timing == "" {
			timing = "timing"
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":    opts.abilityID + "@" + timing,
			"label": labelForBuffs(buffs),
			"buffs": buffs,
		})
	}
}

func collectGatedBuffs(node any, source map[string]any, opts dslOpts, applicability map[string]any, outBuffs *[]any) {
	n, ok := asMap(node)
	if !ok {
		return
	}
	switch getStr(n, "type") {
	case "conditional":
		condition, ok := getMap(n, "condition")
		if !ok {
			return
		}
		app := conditionToApplicability(condition)
		switch a := app.(type) {
		case string:
			if a == "gate" {
				collectGatedBuffs(n["effect"], source, opts, applicability, outBuffs)
				return
			}
			if a == "context" {
				if evaluateCondition(condition, opts.context) == true {
					collectGatedBuffs(n["effect"], source, opts, applicability, outBuffs)
				}
				return
			}
		case map[string]any:
			collectGatedBuffs(n["effect"], source, opts, combineApplicability(applicability, a), outBuffs)
			return
		}
		return
	case "rules-bundle", "sequence":
		for _, step := range getList(n, "steps") {
			collectGatedBuffs(step, source, opts, applicability, outBuffs)
		}
		return
	case "ability-part":
		if n["trigger"] != nil || (n["optional"] != true && n["cost"] == nil && n["usage"] == nil) {
			collectGatedBuffs(momentGate(n["trigger"], n["effect"]), source, opts, applicability, outBuffs)
		}
		return
	case "choice", "dice-pool-allocation", "dice-gated":
		return
	}
	tmp := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(n, source, opts, tmp)
	for _, b := range tmp.applied {
		*outBuffs = append(*outBuffs, applyApplicability(b.(map[string]any), applicability))
	}
}

func unsup(reason string, fragment any) map[string]any {
	return map[string]any{"reason": reason, "effectFragment": fragment}
}

func classifyTarget(node map[string]any) string {
	// A unit filter reaches every unit it matches: friendly ones are the buffed side, enemy ones the other.
	if f, isMap := asMap(node["target"]); isMap && f != nil {
		_, ev := f["event_var"]
		_, sv := f["selection_var"]
		if !ev && !sv {
			switch f["owner"] {
			case "friendly":
				return "self"
			case "enemy":
				return "defender"
			}
			return "unknown"
		}
	}
	target, ok := node["target"].(string)
	if !ok {
		return "unknown"
	}
	if target == "attacker" {
		return "attacker"
	}
	if defenderTargets[target] {
		return "defender"
	}
	if selfTargets[target] {
		return "self"
	}
	return "unknown"
}

func appliesToBuffedUnit(node map[string]any, perspective string) bool {
	switch classifyTarget(node) {
	case "self":
		return true
	case "attacker":
		return perspective == "attacker"
	case "defender":
		return perspective == "target"
	}
	return false
}

func auraRecipientFilterMatches(value any, context map[string]any, perspective string) (bool, string) {
	filter, ok := asMap(value)
	if !ok || filter == nil {
		return false, "aura recipient_filter is malformed"
	}
	for key := range filter {
		if key != "required_keywords" && key != "excluded_keywords" {
			return false, "aura recipient_filter has unrecognised keys"
		}
	}
	requiredRaw, ok := asList(filter["required_keywords"])
	if !ok || len(requiredRaw) == 0 {
		return false, "aura recipient_filter is missing required keywords"
	}
	required := make([]string, len(requiredRaw))
	for i, raw := range requiredRaw {
		keyword, ok := raw.(string)
		if !ok || keyword == "" {
			return false, "aura recipient_filter has malformed required keywords"
		}
		required[i] = strings.ToLower(keyword)
	}
	excluded := []string{}
	if raw, present := filter["excluded_keywords"]; present {
		excludedRaw, ok := asList(raw)
		if !ok || len(excludedRaw) == 0 {
			return false, "aura recipient_filter has malformed excluded keywords"
		}
		excluded = make([]string, len(excludedRaw))
		for i, item := range excludedRaw {
			keyword, ok := item.(string)
			if !ok || keyword == "" {
				return false, "aura recipient_filter has malformed excluded keywords"
			}
			excluded[i] = strings.ToLower(keyword)
		}
	}
	contextKey := "targetKeywords"
	if perspective == "attacker" {
		contextKey = "attackerKeywords"
	}
	rawKeywords, present := context[contextKey]
	if !present || rawKeywords == nil {
		return false, "aura recipient_filter cannot be evaluated without recipient keywords"
	}
	keywords, ok := asList(rawKeywords)
	if !ok {
		return false, "aura recipient_filter recipient keywords are malformed"
	}
	current := map[string]bool{}
	for _, raw := range keywords {
		keyword, ok := raw.(string)
		if !ok || keyword == "" {
			return false, "aura recipient_filter recipient keywords are malformed"
		}
		current[strings.ToLower(keyword)] = true
	}
	for _, keyword := range required {
		if !current[keyword] {
			return false, ""
		}
	}
	for _, keyword := range excluded {
		if current[keyword] {
			return false, ""
		}
	}
	return true, ""
}

func translateReroll(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective == "attacker" && !appliesToBuffedUnit(node, "attacker") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("re-roll: missing modifier object", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("re-roll: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	roll, _ := modifier["roll"].(string)
	subset, _ := modifier["subset"].(string)
	if jsNumberEq(modifier["value"], 1) {
		subset = "ones"
	}
	if opts.perspective == "target" && roll != "save" {
		return
	}
	if _, capped := modifier["count"]; capped {
		out.unsupported = append(out.unsupported, unsup("re-roll: count-capped permissions are not modelled by the expected-value engine", node))
		return
	}
	if (roll == "hit" || roll == "wound" || roll == "save" || roll == "damage") &&
		(subset == "ones" || subset == "all-failures") {
		out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "reroll", "roll": roll, "subset": subset}})
		return
	}
	out.unsupported = append(out.unsupported, unsup("re-roll on \""+jsStr(modifier["roll"])+"\" (subset \""+jsStr(modifier["subset"])+"\") is outside the damage path", node))
}

func translateRollModifier(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("roll-modifier: missing modifier object", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("roll-modifier: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	value, ok := signedValue(modifier)
	if !ok {
		out.unsupported = append(out.unsupported, unsup("roll-modifier: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	roll, _ := modifier["roll"].(string)
	if opts.perspective == "attacker" {
		if !appliesToBuffedUnit(node, "attacker") {
			return
		}
		if roll == "save" {
			return
		}
	} else {
		cls := classifyTarget(node)
		if cls == "attacker" {
			if roll != "hit" && roll != "wound" {
				return
			}
		} else if cls == "self" {
			if roll != "save" {
				return
			}
		} else {
			return
		}
	}
	ct := rollToContribType(roll)
	if ct == "" {
		out.unsupported = append(out.unsupported, unsup("roll-modifier on \""+jsStr(modifier["roll"])+"\" is outside the damage path", node))
		return
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": ct, "value": value}})
}

func translateStatModifier(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("stat-modifier: missing modifier object", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("stat-modifier: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	stat, _ := modifier["stat"].(string)
	isOnBuffedUnit := appliesToBuffedUnit(node, opts.perspective)
	applicability := attackTypeApplicability(modifier)

	emit := func(contribution map[string]any) {
		buff := map[string]any{"source": source, "contribution": contribution}
		if applicability != nil {
			buff["applicableWhen"] = applicability
		}
		out.applied = append(out.applied, buff)
	}

	if stat == "AP" {
		translateAPModifier(node, modifier, opts, out, emit)
		return
	}

	// Ballistic Skill on the attacker is a defender-side rule: it penalises incoming hit rolls
	// (e.g. Benefit of Cover), so it is a `hit-mod` under target perspective.
	if stat == "BS" {
		if opts.perspective != "target" || classifyTarget(node) != "attacker" {
			return
		}
		if bs, ok := signedValue(modifier); ok {
			out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "hit-mod", "value": bs}})
		}
		return
	}

	value, ok := signedValue(modifier)
	if !ok {
		out.unsupported = append(out.unsupported, unsup("stat-modifier: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	switch stat {
	case "A":
		if opts.perspective != "attacker" || !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "attacks-mod", "value": value})
	case "S":
		if opts.perspective != "attacker" || !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "strength-mod", "value": value})
	case "T":
		if opts.perspective != "target" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier T: defender-side stat; applies when the buffed unit is the target", node))
			return
		}
		if !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "toughness-mod", "value": value})
	case "Sv":
		if opts.perspective != "target" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier Sv: defender-side stat; applies when the buffed unit is the target", node))
			return
		}
		if !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "save-mod", "value": -value})
	default:
		out.unsupported = append(out.unsupported, unsup("stat-modifier on \""+jsStr(modifier["stat"])+"\" is outside the damage path", node))
	}
}

func translateAPModifier(node, modifier map[string]any, opts dslOpts, out *effectTranslation, emit func(map[string]any)) {
	if classifyTarget(node) == "attacker" {
		out.unsupported = append(out.unsupported, unsup("stat-modifier AP on the attacker: defender-side AP reduction is not modelled by the buff layer", node))
		return
	}
	if opts.perspective != "attacker" || !appliesToBuffedUnit(node, "attacker") {
		return
	}
	delta, ok := apDelta(modifier)
	if !ok {
		out.unsupported = append(out.unsupported, unsup("stat-modifier AP: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	emit(map[string]any{"type": "ap-mod", "value": delta})
}

func translateFeelNoPain(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "target" {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("feel-no-pain: missing modifier object", node))
		return
	}
	threshold := jsNumber(modifier["threshold"])
	if math.IsInf(threshold, 0) || math.IsNaN(threshold) {
		out.unsupported = append(out.unsupported, unsup("feel-no-pain: threshold not numeric", node))
		return
	}
	// `psychic-and-mortal` folds into the mortal stream (its mortal-wound
	// coverage is exact; the psychic-attack half is invisible to the buff
	// layer); bare `psychic` has no stream to attach to, so it stays
	// unsupported rather than overstating defence.
	rawAgainst, present := modifier["against"]
	scope := "all"
	if present {
		if rawAgainst == "all" || rawAgainst == "mortal" {
			scope = rawAgainst.(string)
		} else if rawAgainst == "psychic-and-mortal" {
			scope = "mortal"
		} else if rawAgainst == "psychic" {
			out.unsupported = append(out.unsupported, unsup("feel-no-pain: against \"psychic\" (psychic attacks are not tracked by the buff layer)", node))
			return
		} else {
			out.unsupported = append(out.unsupported, unsup("feel-no-pain: unrecognised against \""+jsStr(rawAgainst)+"\" (expected \"all\" or \"mortal\")", node))
			return
		}
	}
	contribution := map[string]any{"type": "feel-no-pain", "threshold": threshold}
	if scope == "mortal" {
		contribution["scope"] = "mortal"
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": contribution})
}

func translateKeywordGrant(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "attacker" {
		return
	}
	if !appliesToBuffedUnit(node, "attacker") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return
	}
	raws := keywordGrantList(modifier)
	if len(raws) == 0 {
		return
	}
	applicability := weaponTypeApplicability(modifier)
	for _, raw := range raws {
		ref := parseKeywordGrant(raw)
		if ref == nil {
			out.unsupported = append(out.unsupported, unsup("keyword-grant: cannot parse \""+raw+"\" to a catalog keyword", map[string]any{"keyword": raw}))
			continue
		}
		buff := map[string]any{"source": source, "contribution": map[string]any{"type": "extra-keyword", "keywordRef": ref}}
		if applicability != nil {
			buff["applicableWhen"] = applicability
		}
		out.applied = append(out.applied, buff)
	}
}

func keywordGrantList(modifier map[string]any) []string {
	var out []string
	if arr, ok := asList(modifier["abilities"]); ok {
		for _, k := range arr {
			if s, ok := k.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func weaponTypeApplicability(modifier map[string]any) map[string]any {
	switch modifier["weapon_type"] {
	case "melee":
		return map[string]any{"phases": []any{"fight"}}
	case "ranged":
		return map[string]any{"phases": []any{"shooting"}}
	}
	return nil
}

func attackTypeApplicability(modifier map[string]any) map[string]any {
	kind := modifier["attack_type"]
	if kind == nil {
		kind = modifier["weapon_type"]
	}
	switch kind {
	case "melee":
		return map[string]any{"phases": []any{"fight"}}
	case "ranged":
		return map[string]any{"phases": []any{"shooting"}}
	}
	return nil
}

var unhonorableNarrowingKeys = []string{
	"weapon_name", "weapon_profile", "weapon_keyword", "weapon_filter",
	"model_filter", "model_scope",
}

func unhonorableNarrowing(modifier map[string]any) string {
	for _, k := range unhonorableNarrowingKeys {
		if modifier[k] != nil {
			return k
		}
	}
	return ""
}

func translateDamageReduction(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "target" {
		return
	}
	if !appliesToBuffedUnit(node, "target") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("damage-reduction: missing modifier object", node))
		return
	}
	reduction := modifier["reduction"]
	if isNumber(reduction) {
		r, _ := num(reduction)
		if !math.IsInf(r, 0) && !math.IsNaN(r) && r > 0 {
			out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "damage-reduction", "value": r}})
			return
		}
	}
	if reduction == "half" || reduction == "to-zero" {
		out.unsupported = append(out.unsupported, unsup("damage-reduction: \""+reduction.(string)+"\" is a one-use ablation effect, not modelled by the expected-value engine", node))
		return
	}
	out.unsupported = append(out.unsupported, unsup("damage-reduction: unrecognised reduction \""+jsStr(reduction)+"\"", node))
}

func translateInvulnerableSave(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "target" {
		return
	}
	if !appliesToBuffedUnit(node, "target") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("invulnerable-save: missing modifier object", node))
		return
	}
	threshold := jsNumber(modifier["invuln_sv"])
	if math.IsInf(threshold, 0) || math.IsNaN(threshold) || threshold < 2 || threshold > 7 {
		out.unsupported = append(out.unsupported, unsup("invulnerable-save: invuln_sv \""+jsStr(modifier["invuln_sv"])+"\" is not a valid save threshold (2-7)", node))
		return
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "invulnerable-save", "threshold": threshold}})
}

func translateNamedRegionState(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "attacker" {
		return
	}
	modifier, _ := getMap(node, "modifier")
	consumer, _ := getMap(modifier, "consumer")
	gate, _ := getMap(consumer, "beneficiary_gate")
	rawKeywords, _ := asList(gate["keywords"])
	keywords := make([]string, 0, len(rawKeywords))
	for _, raw := range rawKeywords {
		if keyword, ok := raw.(string); ok {
			keywords = append(keywords, keyword)
		}
	}
	operator, _ := gate["operator"].(string)
	attackerKeywords, hasKeywords := asList(opts.context["attackerKeywords"])
	if len(gate) == 0 || len(keywords) == 0 || (operator != "and" && operator != "or") || !hasKeywords {
		out.unsupported = append(out.unsupported, unsup("named-region-state beneficiary gate cannot be evaluated against current attacker keywords", node))
		return
	}
	current := map[string]bool{}
	for _, raw := range attackerKeywords {
		if keyword, ok := raw.(string); ok {
			current[strings.ToLower(keyword)] = true
		}
	}
	eligible := operator == "and"
	for _, keyword := range keywords {
		match := current[strings.ToLower(keyword)]
		if operator == "and" && !match {
			eligible = false
			break
		}
		if operator == "or" && match {
			eligible = true
			break
		}
	}
	if !eligible {
		return
	}
	defaultBranch, ok := getMap(consumer, "default_branch")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("named-region-state default branch is missing", node))
		return
	}
	dslWalk(defaultBranch["effect"], source, opts, out)
	if qualifiedBranch, ok := getMap(consumer, "qualified_branch"); ok {
		out.unsupported = append(out.unsupported, unsup(
			"named-region-state qualified branch: region membership is unavailable in EngineContext; qualified replacement is unsupported",
			qualifiedBranch,
		))
	}
}

func translateConditional(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	condition, ok := getMap(node, "condition")
	if !ok {
		return
	}
	verdict := evaluateCondition(condition, opts.context)
	if verdict == nil { // unknown
		if conditionMentionsTiming(condition) {
			enumerateTimingGate(node, source, opts, out)
		} else {
			out.unsupported = append(out.unsupported, unsup("conditional: cannot evaluate condition \""+jsStr(condition["type"])+"\" against current context", node))
		}
		return
	}
	if verdict != true {
		return
	}
	dslWalk(node["effect"], source, opts, out)
}

func conditionMentionsTiming(condition map[string]any) bool {
	if getStr(condition, "type") == "timing-is" {
		return true
	}
	if _, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			for _, o := range operands {
				if om, ok := asMap(o); ok && conditionMentionsTiming(om) {
					return true
				}
			}
		}
	}
	return false
}

func extractTiming(condition map[string]any) string {
	if getStr(condition, "type") == "timing-is" {
		params, _ := getMap(condition, "parameters")
		if t, ok := params["timing"].(string); ok {
			return t
		}
		return ""
	}
	if operands, ok := asList(condition["operands"]); ok {
		for _, o := range operands {
			if om, ok := asMap(o); ok {
				if t := extractTiming(om); t != "" {
					return t
				}
			}
		}
	}
	return ""
}

// conditionToApplicability returns "gate", "context", or a map[string]any.
func conditionToApplicability(condition map[string]any) any {
	if op, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			if op != "and" {
				return "context"
			}
			merged := map[string]any{}
			for _, operandAny := range operands {
				operand, ok := asMap(operandAny)
				if !ok {
					return "context"
				}
				a := conditionToApplicability(operand)
				if a == "gate" {
					continue
				}
				if a == "context" {
					return "context"
				}
				merged = combineApplicability(merged, a.(map[string]any))
			}
			return merged
		}
	}
	params, _ := getMap(condition, "parameters")
	switch getStr(condition, "type") {
	case "timing-is":
		return "gate"
	case "phase-is":
		if phase, ok := params["phase"].(string); ok {
			return map[string]any{"phases": []any{phase}}
		}
		return "context"
	case "has-keyword":
		kw, ok := singleKeyword(params)
		if !ok {
			return "context"
		}
		if params["subject"] == "defender" {
			return map[string]any{"requiresTargetKeyword": kw}
		}
		if isBuffedUnit(params["subject"]) {
			return map[string]any{"requiresAttackerKeyword": kw}
		}
		return "context"
	case "attack-is":
		if params == nil {
			return "context"
		}
		for k := range params {
			if k != "attack_type" {
				return "context"
			}
		}
		switch params["attack_type"] {
		case "melee":
			return map[string]any{"phases": []any{"fight"}}
		case "ranged":
			return map[string]any{"phases": []any{"shooting"}}
		}
		return "context"
	}
	return "context"
}

func combineApplicability(a, b map[string]any) map[string]any {
	out := cloneMap(a)
	if bp := getList(b, "phases"); len(bp) > 0 {
		if ap := getList(a, "phases"); len(ap) > 0 {
			var inter []any
			for _, p := range ap {
				if containsAnyV(bp, p) {
					inter = append(inter, p)
				}
			}
			if inter == nil {
				inter = []any{}
			}
			out["phases"] = inter
		} else {
			out["phases"] = bp
		}
	}
	if v, ok := b["rollType"]; ok && v != nil {
		out["rollType"] = v
	}
	if v, ok := b["requiresTargetKeyword"]; ok && v != nil {
		out["requiresTargetKeyword"] = v
	}
	if v, ok := b["requiresAttackerKeyword"]; ok && v != nil {
		out["requiresAttackerKeyword"] = v
	}
	return out
}

func applyApplicability(buff map[string]any, applicability map[string]any) map[string]any {
	if len(applicability) == 0 {
		return buff
	}
	merged := applicability
	if existing, ok := getMap(buff, "applicableWhen"); ok {
		merged = combineApplicability(existing, applicability)
	}
	out := cloneMap(buff)
	out["applicableWhen"] = merged
	return out
}

func labelForBuffs(buffs []any) string {
	seen := map[string]bool{}
	var parts []string
	for _, bAny := range buffs {
		b, _ := asMap(bAny)
		c, _ := getMap(b, "contribution")
		p := describeContribution(c)
		if !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return "buff"
	}
	return strings.Join(parts, ", ")
}

func describeContribution(c map[string]any) string {
	switch getStr(c, "type") {
	case "extra-keyword":
		ref, _ := getMap(c, "keywordRef")
		return keywordLabel(ref)
	case "hit-mod":
		return signedStr(c["value"]) + " to hit"
	case "wound-mod":
		return signedStr(c["value"]) + " to wound"
	case "save-mod":
		return signedStr(c["value"]) + " to save"
	case "damage-mod":
		return signedStr(c["value"]) + " damage"
	case "attacks-mod":
		return signedStr(c["value"]) + " attacks"
	case "strength-mod":
		return signedStr(c["value"]) + " strength"
	case "toughness-mod":
		return signedStr(c["value"]) + " toughness"
	case "ap-mod":
		return "AP " + numStr(c["value"])
	case "reroll":
		ones := ""
		if getStr(c, "subset") == "ones" {
			ones = " 1s"
		}
		return "re-roll " + getStr(c, "roll") + ones
	case "feel-no-pain":
		if getStr(c, "scope") == "mortal" {
			return "feel no pain " + numStr(c["threshold"]) + "+ vs mortals"
		}
		return "feel no pain " + numStr(c["threshold"]) + "+"
	case "damage-reduction":
		return "-" + numStr(c["value"]) + " damage"
	case "invulnerable-save":
		return numStr(c["threshold"]) + "+ invuln"
	}
	return "cover"
}

func signedStr(v any) string {
	n, _ := num(v)
	if n >= 0 {
		return "+" + numStr(v)
	}
	return numStr(v)
}

func keywordLabel(ref map[string]any) string {
	params, _ := getMap(ref, "parameters")
	if getStr(ref, "keyword_id") == "anti" {
		if tk, ok := params["target_keyword"].(string); ok {
			suffix := ""
			if isNumber(params["threshold"]) {
				suffix = " " + numStr(params["threshold"]) + "+"
			}
			return "Anti-" + tk + suffix
		}
	}
	var words []string
	for _, w := range strings.Split(getStr(ref, "keyword_id"), "-") {
		if w == "" {
			words = append(words, w)
		} else {
			words = append(words, strings.ToUpper(w[:1])+w[1:])
		}
	}
	base := strings.Join(words, " ")
	if isNumber(params["value"]) {
		return base + " " + numStr(params["value"])
	}
	return base
}

// --- condition evaluator ---

// evaluateCondition returns bool, or nil for "unknown".
// isBuffedUnit reports the buffed unit: the ability's own unit (or model), or
// the unit an aura is applied to.
func isBuffedUnit(subject any) bool {
	return subject == nil || subject == "this-unit" || subject == "this-model" || subject == "recipient"
}

// singleKeyword returns the one keyword a `has-keyword` names.
func singleKeyword(params map[string]any) (string, bool) {
	all, _ := asList(params["all_of"])
	if params["any_of"] != nil || len(all) != 1 {
		return "", false
	}
	kw, ok := all[0].(string)
	return kw, ok
}

func evaluateCondition(condition, ctx map[string]any) any {
	if op, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			return evaluateCompound(op, operands, ctx)
		}
	}
	params, _ := getMap(condition, "parameters")
	switch getStr(condition, "type") {
	case "phase-is":
		wanted, ok := params["phase"].(string)
		if !ok {
			return nil
		}
		return ctx["phase"] == wanted
	case "attack-is":
		for k := range params {
			if k != "attack_type" {
				return nil
			}
		}
		switch params["attack_type"] {
		case "melee":
			return ctx["phase"] == "fight"
		case "ranged":
			return ctx["phase"] == "shooting"
		}
		return nil
	case "timing-is":
		wanted, ok := params["timing"].(string)
		if !ok {
			return nil
		}
		if ctx["timing"] == nil {
			return nil
		}
		return ctx["timing"] == wanted
	case "happened":
		var types []any
		filter, filterIsMap := asMap(params["filter"])
		if filterIsMap && filter != nil {
			types, _ = asList(filter["move_types"])
		}
		own := params["subject"] == nil && params["object"] == nil && params["count_min"] == nil && params["window"] == "turn"
		if !own || params["event"] != "move-ended" || len(types) != 1 || len(filter) != 1 {
			return nil
		}
		// Player-controlled context flags for the buffed unit's own move this turn. An undefined
		// charge flag means the caller couldn't pin it down: stay unknown so the SPA surfaces it.
		switch types[0] {
		case "remain-stationary":
			return ctx["attackerStationary"] == true
		case "charge":
			if ctx["attackerCharged"] == nil {
				return nil
			}
			return ctx["attackerCharged"] == true
		}
		return nil
	case "has-keyword":
		// A keyword the player picked is not in the context.
		if params["chosen_by"] != nil {
			return nil
		}
		subject := params["subject"]
		var pool []any
		switch {
		case subject == "defender":
			pool = getList(ctx, "targetKeywords")
		case isBuffedUnit(subject):
			pool = getList(ctx, "attackerKeywords")
		default:
			return nil
		}
		have := map[string]bool{}
		for _, k := range pool {
			if ks, ok := k.(string); ok {
				have[lower(ks)] = true
			}
		}
		all, _ := asList(params["all_of"])
		anyOf, _ := asList(params["any_of"])
		for _, k := range append(append([]any{}, all...), anyOf...) {
			if _, ok := k.(string); !ok {
				return nil
			}
		}
		for _, k := range all {
			if !have[lower(k.(string))] {
				return false
			}
		}
		if len(anyOf) == 0 {
			return true
		}
		for _, k := range anyOf {
			if have[lower(k.(string))] {
				return true
			}
		}
		return false
	case "attachment":
		// True whenever the buffed unit is a combined ("attached") unit. We do not thread
		// per-member leader identity, and a Leader keyword filter is not checked: "attachment
		// present" is the signal. An undefined flag stays unknown so the SPA surfaces the gap.
		if params["role"] == "led" || params["with"] != nil {
			return nil
		}
		if ctx["attackerAttached"] == nil {
			return nil
		}
		return ctx["attackerAttached"] == true
	}
	return nil
}

func evaluateCompound(operator string, operands []any, ctx map[string]any) any {
	if operator == "not" {
		if len(operands) == 0 {
			return nil
		}
		first, ok := asMap(operands[0])
		if !ok {
			return nil
		}
		v := evaluateCondition(first, ctx)
		if v == nil {
			return nil
		}
		return !v.(bool)
	}
	if operator != "and" && operator != "or" {
		return nil
	}
	sawUnknown := false
	for _, operandAny := range operands {
		operand, ok := asMap(operandAny)
		if !ok {
			sawUnknown = true
			continue
		}
		v := evaluateCondition(operand, ctx)
		if v == nil {
			sawUnknown = true
			continue
		}
		if operator == "and" && v == false {
			return false
		}
		if operator == "or" && v == true {
			return true
		}
	}
	if sawUnknown {
		return nil
	}
	return operator == "and"
}

// --- helpers ---

func jsStr(v any) string {
	switch x := v.(type) {
	case nil:
		return "undefined"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return numStr(x)
	case string:
		return x
	}
	return numStr(v)
}

func jsNumberEq(v any, target float64) bool {
	n := jsNumber(v)
	return !math.IsNaN(n) && n == target
}

func signedValue(modifier map[string]any) (float64, bool) {
	value := jsNumber(modifier["value"])
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return 0, false
	}
	switch modifier["operation"] {
	case "add", "improve":
		return value, true
	case "subtract", "worsen":
		return -value, true
	}
	return 0, false
}

func apDelta(modifier map[string]any) (float64, bool) {
	value := jsNumber(modifier["value"])
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return 0, false
	}
	switch modifier["operation"] {
	case "improve":
		return -math.Abs(value), true
	case "worsen":
		return math.Abs(value), true
	case "add":
		return value, true
	case "subtract":
		return -value, true
	}
	return 0, false
}

var antiGrantRe = regexp.MustCompile(`(?i)^anti-([A-Za-z][A-Za-z\s-]*)\s+(\d+)\+?$`)
var valueGrantRe = regexp.MustCompile(`^(.+?)\s+(\d+)$`)

func parseKeywordGrant(raw string) map[string]any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	if m := antiGrantRe.FindStringSubmatch(trimmed); m != nil {
		th, _ := strconv.Atoi(m[2])
		return map[string]any{"keyword_id": "anti", "parameters": map[string]any{
			"target_keyword": strings.TrimSpace(m[1]),
			"threshold":      float64(th),
		}}
	}
	if m := valueGrantRe.FindStringSubmatch(trimmed); m != nil {
		val, _ := strconv.Atoi(m[2])
		return map[string]any{"keyword_id": toKebabCase(m[1]), "parameters": map[string]any{"value": float64(val)}}
	}
	return map[string]any{"keyword_id": toKebabCase(trimmed)}
}

var kebabSpaceRe = regexp.MustCompile(`[\s_]+`)
var kebabStripRe = regexp.MustCompile(`[^a-z0-9-]`)

func toKebabCase(s string) string {
	return kebabStripRe.ReplaceAllString(kebabSpaceRe.ReplaceAllString(strings.ToLower(s), "-"), "")
}

func containsAnyV(l []any, v any) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

const fidelityBindingReason = "selection/history/model/attack predicates are not resolved by the buff engine"

func hasUnresolvedFidelityBinding(n map[string]any) bool {
	selector, _ := getMap(n, "selector")
	selectSpec, _ := getMap(n, "select")
	applies, _ := getMap(n, "applies")
	modifier, _ := getMap(n, "modifier")
	consumer, _ := getMap(modifier, "consumer")
	selectorUnresolved := (n["type"] == "select-units" || n["type"] == "for-each-unit") && (selector["target_kind"] == "model" ||
		selector["eligibility"] != nil ||
		selector["reference"] != nil ||
		selector["origin"] != nil ||
		selector["selection_limit"] != nil ||
		selector["bind_as"] != nil ||
		selector["within_inches_from"] != nil ||
		selector["visible_to"] != nil ||
		selector["visibility_required"] == true)
	designationUnresolved := n["type"] == "designate-target" && (selectSpec["eligibility"] != nil ||
		selectSpec["reference"] != nil ||
		selectSpec["visibility_required"] == true ||
		selectSpec["bind_as"] != nil ||
		selectSpec["within_inches_from"] != nil ||
		selectSpec["visible_to"] != nil ||
		selectSpec["selection_limit"] != nil ||
		applies["attacker_keywords"] != nil ||
		applies["attacker_unit_keywords"] != nil ||
		applies["beneficiary"] != nil ||
		applies["reference"] != nil)
	triggerUnresolved := n["type"] == "ability-part" && hasUnresolvedTriggerBinding(n["trigger"])
	return selectorUnresolved ||
		designationUnresolved ||
		triggerUnresolved ||
		(n["type"] == "named-region-state" && consumer["attack_condition"] != nil)
}

func hasUnresolvedTriggerBinding(raw any) bool {
	if triggers, ok := asList(raw); ok {
		for _, trigger := range triggers {
			if hasUnresolvedTriggerBinding(trigger) {
				return true
			}
		}
		return false
	}
	trigger, ok := asMap(raw)
	if !ok || trigger == nil {
		return false
	}
	filter, isFilter := asMap(trigger["filter"])
	return (isFilter && filter != nil && filter["by"] != nil) || trigger["source_ability"] != nil
}
