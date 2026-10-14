package wh40kdc

// Cruncher support for the phase-4 shapes: the `roll` allocation that stands in
// for dice-pool-allocation, and the diagnostics for values the buff engine
// cannot size. Mirror of the phase-4 additions to tools/src/cruncher/from-dsl.ts.

// enumerateRollAllocation handles a `roll` whose nested effect is a choice of
// dice gates on that roll (`from` + `requirement`): the general encoding of a
// dice-pool allocation. It emits the same levers enumerateDicePool does (ids
// `<ability>#<option name>`, one group capped by the choice's max_choices) and
// reports false when the roll is not such an allocation.
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
		from, _ := asMap(g["from"])
		if g == nil || g["type"] != "dice-gated" || g["requirement"] == nil || from == nil || !jsonEqual(from["roll_var"], node["roll_var"]) {
			return false
		}
		name := ""
		if part != nil {
			name, _ = part["name"].(string)
		}
		gates = append(gates, gate{name, g["on_success"]})
	}
	maxActivations := 1.0
	if isNumber(choice["max_choices"]) {
		maxActivations, _ = num(choice["max_choices"])
	}
	for _, g := range gates {
		var buffs []any
		collectGatedBuffs(g.effect, source, opts, map[string]any{}, &buffs)
		if len(buffs) == 0 {
			continue
		}
		name := g.name
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
