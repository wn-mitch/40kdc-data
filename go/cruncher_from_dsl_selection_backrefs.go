package wh40kdc

// Conditions inside an enemy selection lever that only restate the selection. Mirrors
// designatedTags, selectionHolds and their helpers in tools/src/cruncher/from-dsl-selection.ts.
// The lever vouches that the other side of the attack is the selected unit, so a condition that
// it is that unit (same-unit as the selection), or that it carries a tag the selection itself
// designates, holds. planSelection plans no selection with a named binding, so only
// "selected-unit" names the selection here.

// selectionDesignatedTags is the set of tags the selection's own designate steps put on the
// selected unit, outside a nested selection.
func selectionDesignatedTags(node any) map[string]bool {
	tags := map[string]bool{}
	var visit func(value any)
	visit = func(value any) {
		switch v := value.(type) {
		case []any:
			for _, child := range v {
				visit(child)
			}
		case map[string]any:
			if v["type"] == "select-units" {
				return
			}
			if modifier, ok := v["modifier"].(map[string]any); ok && v["type"] == "designate" && v["target"] == selectedUnit {
				if tag, ok := modifier["tag"].(string); ok && modifier["clear"] != true {
					tags[tag] = true
				}
			}
			for _, child := range v {
				visit(child)
			}
		}
	}
	visit(node)
	return tags
}

// heldBySelection reports whether a condition holds once the player vouches that other is the
// selected enemy unit.
func heldBySelection(condition map[string]any, other string, tags map[string]bool) bool {
	params, ok := condition["parameters"].(map[string]any)
	if !ok || params["subject"] != other {
		return false
	}
	if condition["type"] == "same-unit" {
		return params["as"] == selectedUnit
	}
	filter, ok := params["filter"].(map[string]any)
	if condition["type"] != "matches" || !ok || len(filter) != 1 {
		return false
	}
	tag, ok := filter["designated"].(string)
	return ok && tags[tag]
}

// withoutHeld is the condition left once the selection's back-references hold, held when nothing
// is left, and changed when anything was dropped. An and keeps its other operands; any other
// operator is left whole.
func withoutHeld(condition any, other string, tags map[string]bool) (left any, held bool, changed bool) {
	node, ok := condition.(map[string]any)
	if !ok {
		return condition, false, false
	}
	if operands, ok := node["operands"].([]any); ok && node["operator"] == "and" {
		rest := []any{}
		for _, operand := range operands {
			if op, ok := operand.(map[string]any); ok && heldBySelection(op, other, tags) {
				continue
			}
			rest = append(rest, operand)
		}
		switch {
		case len(rest) == len(operands):
			return condition, false, false
		case len(rest) == 0:
			return nil, true, true
		case len(rest) == 1:
			return rest[0], false, true
		}
		kept := make(map[string]any, len(node))
		for k, v := range node {
			kept[k] = v
		}
		kept["operands"] = rest
		return kept, false, true
	}
	if heldBySelection(node, other, tags) {
		return nil, true, true
	}
	return condition, false, false
}

// selectionHolds is the lever's effect with every condition that only restates the selection
// settled: a conditional whose condition holds becomes its effect. Nested selections keep their
// own scope.
func selectionHolds(node any, other string, tags map[string]bool) any {
	switch n := node.(type) {
	case []any:
		out := make([]any, len(n))
		for i, child := range n {
			out[i] = selectionHolds(child, other, tags)
		}
		return out
	case map[string]any:
		if n["type"] == "select-units" {
			return n
		}
		if effect, has := n["effect"]; has && n["type"] == "conditional" {
			left, held, changed := withoutHeld(n["condition"], other, tags)
			if held {
				return selectionHolds(effect, other, tags)
			}
			if changed {
				next := make(map[string]any, len(n))
				for k, v := range n {
					next[k] = v
				}
				next["condition"] = left
				return selectionHolds(next, other, tags)
			}
		}
		out := make(map[string]any, len(n))
		for k, v := range n {
			out[k] = selectionHolds(v, other, tags)
		}
		return out
	}
	return node
}
