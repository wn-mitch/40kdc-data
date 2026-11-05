package wh40kdc

// A condition on each unit an effect reaches ("While an enemy unit is within 3" of this unit, that
// unit has -1 OC"). Mirrors tools/src/translate/effect-recipient-gate.ts.

import "strings"

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

// recipientGate reads a condition on each unit the effect reaches (subject recipient) gating a
// leaf effect aimed at a unit filter. The condition names the unit with the filter's phrase; its
// later mentions and the effect say "that unit" (or "that model"). ok is false when the shape is
// not that one.
func recipientGate(e map[string]any, ctx effCtx) (recipientGateParts, bool) {
	condition := e["condition"]
	inner, ok := asMap(e["effect"])
	if condition == nil || !ok || inner == nil {
		return recipientGateParts{}, false
	}
	filter, ok := asMap(inner["target"])
	if !ok || filter == nil {
		return recipientGateParts{}, false
	}
	if inner["effect"] != nil || inner["steps"] != nil || inner["options"] != nil || !conditionNamesRecipient(condition) {
		return recipientGateParts{}, false
	}
	model := filter["level"] == "model"
	that := "that unit"
	if model {
		that = "that model"
	}
	lead := strings.ReplaceAll(conditionLeadInFor(mapOr(recipientAsThatUnit(condition)), isDefensiveEffect(inner)), "that unit", that)
	at := strings.Index(lead, that)
	if at < 0 {
		return recipientGateParts{}, false
	}
	lead = lead[:at] + unitFilterPhrase(filter) + lead[at+len(that):]
	gated := make(map[string]any, len(inner))
	for k, v := range inner {
		gated[k] = v
	}
	gated["target"] = "recipient"
	if model {
		ctx.eachModel = true
	} else {
		ctx.auraRecipient = true
	}
	return recipientGateParts{lead: lead, inner: gated, ctx: ctx}, true
}
