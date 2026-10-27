package wh40kdc

// Stance-option gates: a `rule-active` condition naming one option of a
// stance-select rule, evaluated without a declared activeRules list. Mirror of
// splitStanceOption / offerStanceGated / collectOptionBuffs in
// tools/src/cruncher/from-dsl.ts.

// stanceOptionRef is one option of a stance-select rule, as a rule-active
// condition names it: {ability_id, option_id}.
type stanceOptionRef struct {
	abilityID string
	optionID  string
}

func (r stanceOptionRef) toMap() map[string]any {
	return map[string]any{"ability_id": r.abilityID, "option_id": r.optionID}
}

// stanceGate is a gate on a stance option: it holds while the option is
// picked, or, negated, while it is not.
type stanceGate struct {
	option  stanceOptionRef
	negated bool
}

// name is the gate's lever-id suffix and label prefix: the option id, with a
// `not-` prefix when negated.
func (g stanceGate) name() string {
	if g.negated {
		return "not-" + g.option.optionID
	}
	return g.option.optionID
}

// field is the lever field that carries the gate.
func (g stanceGate) field() string {
	if g.negated {
		return "excludesOption"
	}
	return "requiresOption"
}

// stanceSplit is a stance-option gate and the condition's remaining operands
// (nil when the condition is the gate itself).
type stanceSplit struct {
	stanceGate
	rest map[string]any
}

// stanceGated collects the buffs an activation gives only under a stance
// gate, and the gates on them.
type stanceGated struct {
	buffs []any
	gates []stanceGate
}

// activeRulesUndeclared reports whether the context leaves rule-active "unknown".
func activeRulesUndeclared(ctx map[string]any) bool {
	return ctx["activeRules"] == nil
}

func stanceOptionOf(operand any) (stanceOptionRef, bool) {
	m, ok := asMap(operand)
	if !ok || m["type"] != "rule-active" {
		return stanceOptionRef{}, false
	}
	params, ok := asMap(m["parameters"])
	if !ok {
		return stanceOptionRef{}, false
	}
	rule, ok := asMap(params["rule"])
	if !ok {
		return stanceOptionRef{}, false
	}
	abilityID, okA := rule["ability_id"].(string)
	optionID, okO := rule["option_id"].(string)
	if !okA || !okO {
		return stanceOptionRef{}, false
	}
	return stanceOptionRef{abilityID: abilityID, optionID: optionID}, true
}

// stanceGateOf matches rule-active on a stance option, or its single-operand
// `not`.
func stanceGateOf(operand any) (stanceGate, bool) {
	if option, ok := stanceOptionOf(operand); ok {
		return stanceGate{option: option}, true
	}
	m, ok := asMap(operand)
	if !ok || m["operator"] != "not" {
		return stanceGate{}, false
	}
	operands, ok := asList(m["operands"])
	if !ok || len(operands) != 1 {
		return stanceGate{}, false
	}
	if option, ok := stanceOptionOf(operands[0]); ok {
		return stanceGate{option: option, negated: true}, true
	}
	return stanceGate{}, false
}

// splitStanceOption matches a condition that is, or is an `and` with exactly
// one top-level operand that is, rule-active on a stance option or its
// single-operand `not`.
func splitStanceOption(condition map[string]any) (stanceSplit, bool) {
	if gate, ok := stanceGateOf(condition); ok {
		return stanceSplit{stanceGate: gate}, true
	}
	if condition["operator"] != "and" {
		return stanceSplit{}, false
	}
	operands, ok := asList(condition["operands"])
	if !ok {
		return stanceSplit{}, false
	}
	matchIndex := -1
	for i, operand := range operands {
		if _, ok := stanceGateOf(operand); ok {
			if matchIndex >= 0 {
				return stanceSplit{}, false
			}
			matchIndex = i
		}
	}
	if matchIndex < 0 {
		return stanceSplit{}, false
	}
	gate, _ := stanceGateOf(operands[matchIndex])
	rest := make([]any, 0, len(operands)-1)
	for i, operand := range operands {
		if i != matchIndex {
			rest = append(rest, operand)
		}
	}
	if len(rest) == 1 {
		if only, ok := asMap(rest[0]); ok {
			return stanceSplit{stanceGate: gate, rest: only}, true
		}
	}
	return stanceSplit{stanceGate: gate, rest: map[string]any{"operator": "and", "operands": rest}}, true
}

// stanceGatedNode is what a stance gate guards: the conditional under its
// remaining condition (keeping its activation source), or its bare effect.
func stanceGatedNode(node map[string]any, split stanceSplit) any {
	if split.rest == nil {
		return node["effect"]
	}
	gated := cloneMap(node)
	gated["condition"] = split.rest
	return gated
}

// offerStanceGated turns a rule gated on an undeclared stance option into a
// lever requiring that option, or, for a negated gate, excluding it. Buffs
// under the same gate within one ability share one lever.
func offerStanceGated(node map[string]any, split stanceSplit, source map[string]any, opts dslOpts, out *effectTranslation) {
	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(stanceGatedNode(node, split), source, opts, sub)
	out.unsupported = append(out.unsupported, sub.unsupported...)
	for _, leverAny := range sub.activatable {
		lever, ok := asMap(leverAny)
		if !ok {
			continue
		}
		withOption := cloneMap(lever)
		withOption[split.field()] = split.option.toMap()
		out.activatable = append(out.activatable, withOption)
	}
	if len(sub.applied) == 0 {
		return
	}
	name := split.name()
	id := opts.abilityID + "#" + name
	for _, leverAny := range out.activatable {
		existing, ok := asMap(leverAny)
		if !ok || existing["id"] != id {
			continue
		}
		buffs := append(append([]any{}, getList(existing, "buffs")...), sub.applied...)
		existing["buffs"] = buffs
		existing["label"] = name + ": " + labelForBuffs(buffs)
		return
	}
	out.activatable = append(out.activatable, map[string]any{
		"id": id, "label": name + ": " + labelForBuffs(sub.applied),
		"buffs": sub.applied, split.field(): split.option.toMap(),
	})
}

// collectOptionBuffs is the buffs one activation gives, as collectGatedBuffs
// finds them. Buffs under a gate on an undeclared stance option make the
// activation carry that gate when they are all it gives; mixed with ungated
// buffs, or under different gates, they are reported and left out. The
// returned gate is nil when the activation carries none.
func collectOptionBuffs(node any, source map[string]any, opts dslOpts, diagnostics *[]any) ([]any, *stanceGate) {
	var buffs []any
	stance := &stanceGated{}
	collectGatedBuffs(node, source, opts, map[string]any{}, &buffs, diagnostics, stance)
	if len(stance.buffs) == 0 {
		return buffs, nil
	}
	gate := stance.gates[0]
	single := true
	for _, other := range stance.gates {
		if other != gate {
			single = false
			break
		}
	}
	if len(buffs) == 0 && single {
		return stance.buffs, &gate
	}
	if diagnostics != nil {
		*diagnostics = append(*diagnostics, unsup("activation mixes stance-gated buffs with other buffs", node))
	}
	return buffs, nil
}

// withStanceGate sets lever.requiresOption, or lever.excludesOption for a
// negated gate, when the activation carries a stance gate.
func withStanceGate(lever map[string]any, gate *stanceGate) map[string]any {
	if gate != nil {
		lever[gate.field()] = gate.option.toMap()
	}
	return lever
}
