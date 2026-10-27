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

// stanceSplit is a stance-option gate and the condition's remaining operands
// (nil when the condition is the gate itself).
type stanceSplit struct {
	option stanceOptionRef
	rest   map[string]any
}

// stanceGated collects the buffs an activation gives only under a stance
// option, and the options gating them.
type stanceGated struct {
	buffs   []any
	options []stanceOptionRef
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

// splitStanceOption matches a condition that is, or is an `and` with exactly
// one top-level operand that is, rule-active on a stance option.
func splitStanceOption(condition map[string]any) (stanceSplit, bool) {
	if option, ok := stanceOptionOf(condition); ok {
		return stanceSplit{option: option}, true
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
		if _, ok := stanceOptionOf(operand); ok {
			if matchIndex >= 0 {
				return stanceSplit{}, false
			}
			matchIndex = i
		}
	}
	if matchIndex < 0 {
		return stanceSplit{}, false
	}
	option, _ := stanceOptionOf(operands[matchIndex])
	rest := make([]any, 0, len(operands)-1)
	for i, operand := range operands {
		if i != matchIndex {
			rest = append(rest, operand)
		}
	}
	if len(rest) == 1 {
		if only, ok := asMap(rest[0]); ok {
			return stanceSplit{option: option, rest: only}, true
		}
	}
	return stanceSplit{option: option, rest: map[string]any{"operator": "and", "operands": rest}}, true
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
// lever requiring that option. Buffs gated on the same option within one
// ability share one lever.
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
		withOption["requiresOption"] = split.option.toMap()
		out.activatable = append(out.activatable, withOption)
	}
	if len(sub.applied) == 0 {
		return
	}
	id := opts.abilityID + "#" + split.option.optionID
	for _, leverAny := range out.activatable {
		existing, ok := asMap(leverAny)
		if !ok || existing["id"] != id {
			continue
		}
		buffs := append(append([]any{}, getList(existing, "buffs")...), sub.applied...)
		existing["buffs"] = buffs
		existing["label"] = split.option.optionID + ": " + labelForBuffs(buffs)
		return
	}
	out.activatable = append(out.activatable, map[string]any{
		"id": id, "label": split.option.optionID + ": " + labelForBuffs(sub.applied),
		"buffs": sub.applied, "requiresOption": split.option.toMap(),
	})
}

// collectOptionBuffs is the buffs one activation gives, as collectGatedBuffs
// finds them. Buffs gated on an undeclared stance option make the activation
// require that option when they are all it gives; mixed with ungated buffs,
// or gated on different options, they are reported and left out. The
// returned option map is nil when the activation requires none.
func collectOptionBuffs(node any, source map[string]any, opts dslOpts, diagnostics *[]any) ([]any, map[string]any) {
	var buffs []any
	stance := &stanceGated{}
	collectGatedBuffs(node, source, opts, map[string]any{}, &buffs, diagnostics, stance)
	if len(stance.buffs) == 0 {
		return buffs, nil
	}
	option := stance.options[0]
	single := true
	for _, other := range stance.options {
		if other != option {
			single = false
			break
		}
	}
	if len(buffs) == 0 && single {
		return stance.buffs, option.toMap()
	}
	if diagnostics != nil {
		*diagnostics = append(*diagnostics, unsup("activation mixes stance-gated buffs with other buffs", node))
	}
	return buffs, nil
}

// withRequiresOption sets lever.requiresOption when the activation requires one.
func withRequiresOption(lever map[string]any, requiresOption map[string]any) map[string]any {
	if requiresOption != nil {
		lever["requiresOption"] = requiresOption
	}
	return lever
}
