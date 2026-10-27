package wh40kdc

import "math"

// Cruncher support for the phase-4 shapes: the `roll` allocation that stands in
// for dice-pool-allocation, and the diagnostics for values the buff engine
// cannot size. Mirror of the phase-4 additions to tools/src/cruncher/from-dsl.ts.

// enumerateRollAllocation handles a `roll` whose nested effect is a choice of
// dice gates on that roll (`from` + `requirement`). Roll allocations retain
// their historical label-based lever identity, matching the reference port.
func enumerateRollAllocation(node, source map[string]any, opts dslOpts, out *effectTranslation) bool {
	choice, ok := asMap(node["effect"])
	if !ok || choice == nil || choice["type"] != "choice" {
		return false
	}
	options, ok := asList(choice["options"])
	if !ok {
		return false
	}
	type gate struct {
		name   string
		effect any
	}
	gates := make([]gate, 0, len(options))
	for _, optAny := range options {
		opt, _ := asMap(optAny)
		var part map[string]any
		g := opt
		if opt != nil && opt["type"] == "ability-part" {
			part = opt
			g, _ = asMap(opt["effect"])
		}
		if g == nil {
			return false
		}
		from, _ := asMap(g["from"])
		if g["type"] != "dice-gated" || g["requirement"] == nil || from == nil || !jsonEqual(from["roll_var"], node["roll_var"]) {
			return false
		}
		name := ""
		if part != nil {
			name = getStr(part, "name")
		}
		gates = append(gates, gate{name: name, effect: g["on_success"]})
	}
	maxActivations := 1.0
	if isNumber(choice["max_choices"]) {
		maxActivations, _ = num(choice["max_choices"])
	}
	for _, g := range gates {
		buffs, requiresOption := collectOptionBuffs(g.effect, source, opts, &out.unsupported)
		if len(buffs) == 0 {
			continue
		}
		name := g.name
		if name == "" {
			name = labelForBuffs(buffs)
		}
		out.activatable = append(out.activatable, withRequiresOption(map[string]any{
			"id": opts.abilityID + "#" + name, "label": name, "buffs": buffs,
			"group": map[string]any{"id": opts.abilityID, "maxActivations": maxActivations},
		}, requiresOption))
	}
	return true
}

// rollLabel names a roll kind for a diagnostic: "hit", or the ability whose dice it is.
func rollLabel(roll any) string {
	if r, ok := roll.(map[string]any); ok {
		if a, ok := r["of_ability"].(string); ok {
			return a + " roll"
		}
	}
	return jsStr(roll)
}

// sizedFields are the numeric modifier fields whose size a buff reads.
var sizedFields = []string{"value", "count", "amount"}

// unsizedValueReason says why a leaf's size cannot be read here, or "": a
// `scaling` block (the size depends on the board) or a value bound to the
// battle size, a roll or a count.
func unsizedValueReason(node map[string]any) string {
	m, ok := node["modifier"].(map[string]any)
	t, isStr := node["type"].(string)
	if !ok || !isStr {
		return ""
	}
	if sc, ok := node["scaling"].(map[string]any); ok {
		return t + ": the value scales with " + jsStr(sc["of"]) + "; not resolved by the buff engine"
	}
	for _, field := range sizedFields {
		v, ok := m[field].(map[string]any)
		if !ok {
			continue
		}
		what := "the battle size"
		if _, ok := v["roll_var"].(string); ok {
			what = "a bound roll"
		} else if c, ok := v["count_of"].(string); ok {
			what = "the number of " + c
		}
		return t + ": its " + field + " is set by " + what + "; not resolved by the buff engine"
	}
	return ""
}

// scaledToCap is a scaled leaf with a cap, as the leaf at that cap: the scaled
// field set to max_value and the scaling removed. nil when the scaling has no
// positive integer cap, the scaled field is not a plain number, or another size
// is bound.
func scaledToCap(node map[string]any) map[string]any {
	scaling, ok := node["scaling"].(map[string]any)
	if !ok {
		return nil
	}
	modifier, ok := node["modifier"].(map[string]any)
	if !ok {
		return nil
	}
	capValue, ok := scaling["max_value"].(float64)
	if !ok || capValue != math.Trunc(capValue) || math.IsInf(capValue, 0) || capValue <= 0 {
		return nil
	}
	field := "value"
	if raw, has := scaling["field"]; has {
		s, isStr := raw.(string)
		if !isStr {
			return nil
		}
		field = s
	}
	known := false
	for _, f := range sizedFields {
		if f == field {
			known = true
		}
	}
	if _, isNum := modifier[field].(float64); !known || !isNum {
		return nil
	}
	for _, other := range sizedFields {
		if _, bound := modifier[other].(map[string]any); bound {
			return nil
		}
	}
	rest := make(map[string]any, len(node))
	for k, v := range node {
		if k != "scaling" {
			rest[k] = v
		}
	}
	capped := cloneMap(modifier)
	capped[field] = capValue
	rest["modifier"] = capped
	return rest
}
