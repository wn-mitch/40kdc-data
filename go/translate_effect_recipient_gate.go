package wh40kdc

// A condition on each unit an effect reaches ("While an enemy unit is within 3" of this unit, that
// unit has -1 OC"). Mirrors tools/src/translate/effect-recipient-gate.ts.

import (
	"reflect"
	"strings"
)

// recipientGateParts is a gated effect's condition lead-in, its effect aimed at the recipient,
// and that effect's context.
type recipientGateParts struct {
	lead  string
	inner map[string]any
	ctx   effCtx
}

// recipientAsThatUnit returns the condition with every recipient subject read as "that unit"
// (event-object).
func recipientAsThatUnit(c any) any {
	m, ok := asMap(c)
	if !ok || m == nil {
		return c
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	if p, ok := asMap(m["parameters"]); ok && p != nil && p["subject"] == "recipient" {
		params := make(map[string]any, len(p))
		for k, v := range p {
			params[k] = v
		}
		params["subject"] = "event-object"
		out["parameters"] = params
	}
	if ops, ok := asList(m["operands"]); ok {
		mapped := make([]any, len(ops))
		for i, o := range ops {
			mapped[i] = recipientAsThatUnit(o)
		}
		out["operands"] = mapped
	}
	return out
}

func conditionNamesRecipient(c any) bool {
	m, ok := asMap(c)
	if !ok || m == nil {
		return false
	}
	if p, ok := asMap(m["parameters"]); ok && p != nil && p["subject"] == "recipient" {
		return true
	}
	ops, _ := asList(m["operands"])
	for _, o := range ops {
		if conditionNamesRecipient(o) {
			return true
		}
	}
	return false
}

func recipientIsLeaf(e map[string]any) bool {
	return e["effect"] == nil && e["steps"] == nil && e["options"] == nil
}

// recipientSharedFilter returns the unit filter a leaf, or every step of a sequence of leaves, is
// aimed at; ok is false when they do not share one.
func recipientSharedFilter(inner map[string]any) (map[string]any, bool) {
	leaves := []map[string]any{inner}
	if inner["type"] == "sequence" {
		steps, ok := asList(inner["steps"])
		if !ok {
			return nil, false
		}
		leaves = leaves[:0]
		for _, step := range steps {
			m, ok := asMap(step)
			if !ok || m == nil {
				return nil, false
			}
			leaves = append(leaves, m)
		}
	}
	if len(leaves) == 0 {
		return nil, false
	}
	for _, leaf := range leaves {
		if !recipientIsLeaf(leaf) {
			return nil, false
		}
	}
	filter, ok := asMap(leaves[0]["target"])
	if !ok || filter == nil {
		return nil, false
	}
	for _, leaf := range leaves[1:] {
		if !reflect.DeepEqual(leaf["target"], leaves[0]["target"]) {
			return nil, false
		}
	}
	return filter, true
}

// recipientGate reads a condition on each unit the effect reaches (subject recipient) gating a
// leaf effect, or a sequence of leaves, aimed at one unit filter. The condition names the unit
// with the filter's phrase; its later mentions and the effects say "that unit" (or "that model").
// ok is false when the shape is not that one.
func recipientGate(e map[string]any, ctx effCtx) (recipientGateParts, bool) {
	condition := e["condition"]
	inner, ok := asMap(e["effect"])
	if condition == nil || !ok || inner == nil || !conditionNamesRecipient(condition) {
		return recipientGateParts{}, false
	}
	filter, ok := recipientSharedFilter(inner)
	if !ok {
		return recipientGateParts{}, false
	}
	sequence := inner["type"] == "sequence"
	defended := inner
	if sequence {
		steps, _ := asList(inner["steps"])
		defended = mapOr(steps[0])
	}
	model := filter["level"] == "model"
	that := "that unit"
	if model {
		that = "that model"
	}
	lead := strings.ReplaceAll(conditionLeadInFor(mapOr(recipientAsThatUnit(condition)), isDefensiveEffect(defended)), "that unit", that)
	at := strings.Index(lead, that)
	if at < 0 {
		return recipientGateParts{}, false
	}
	lead = lead[:at] + unitFilterPhrase(filter) + lead[at+len(that):]
	gated := make(map[string]any, len(inner))
	for k, v := range inner {
		gated[k] = v
	}
	if sequence {
		steps, _ := asList(inner["steps"])
		aimed := make([]any, len(steps))
		for i, step := range steps {
			copied := make(map[string]any)
			for k, v := range mapOr(step) {
				copied[k] = v
			}
			copied["target"] = "recipient"
			aimed[i] = copied
		}
		gated["steps"] = aimed
	} else {
		gated["target"] = "recipient"
	}
	if model {
		ctx.eachModel = true
	} else {
		ctx.auraRecipient = true
	}
	return recipientGateParts{lead: lead, inner: gated, ctx: ctx}, true
}
