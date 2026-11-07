package wh40kdc

// Attack comparisons: the canonical `attack-compare` condition as a buff gate
// (`applicableWhen.attackComparisons`), read against the attack's Strength and
// the units' Toughness the engine puts on the context. Mirror of the
// attack-comparison parts of tools/src/cruncher/{buffs,from-dsl,engine}.ts.
//
//	attackStrength      the attack's modified Strength (engine-supplied)
//	targetToughness     the attacked profile's modified Toughness (engine-supplied)
//	targetToughnessMax  the highest modified Toughness over the target's profiles (engine-supplied)
//	targetToughnessMin  the lowest modified Toughness over the target's profiles (engine-supplied)
//	attackerToughness   the attacking unit's Toughness, its highest model's (caller-supplied)

// attackStat is the characteristic an attack-comparison operand names, or
// false when the context lacks it.
func attackStat(operand map[string]any, ctx map[string]any) (float64, bool) {
	if value, present := operand["value"]; present {
		return contextNumber(value)
	}
	reduce, reduced := operand["reduce"]
	stat := operand["stat"]
	key := ""
	switch operand["of"] {
	case "attacker":
		if stat == "S" && !reduced {
			key = "attackStrength"
		} else if stat == "T" && reduce != "min" {
			key = "attackerToughness"
		}
	case "defender":
		if stat == "T" {
			switch reduce {
			case "max":
				key = "targetToughnessMax"
			case "min":
				key = "targetToughnessMin"
			default:
				key = "targetToughness"
			}
		}
	}
	if key == "" {
		return 0, false
	}
	return contextNumber(ctx[key])
}

// attackComparisonHolds reports whether an attack comparison holds; a missing
// characteristic does not establish it.
func attackComparisonHolds(comparison map[string]any, ctx map[string]any) bool {
	left, leftOK := asMap(comparison["left"])
	right, rightOK := asMap(comparison["right"])
	if !leftOK || !rightOK {
		return false
	}
	l, lKnown := attackStat(left, ctx)
	r, rKnown := attackStat(right, ctx)
	if !lKnown || !rKnown {
		return false
	}
	return compareNumbers(l, comparison["comparison"], r) == true
}

// attackComparisonsHold reports whether every comparison of a gate holds; a
// gate without comparisons holds.
func attackComparisonsHold(gate map[string]any, ctx map[string]any) bool {
	for _, raw := range anyList(gate["attackComparisons"]) {
		comparison, _ := asMap(raw)
		if !attackComparisonHolds(comparison, ctx) {
			return false
		}
	}
	return true
}

// hasAttackComparison reports a gate, or one of its weapon requirements, that
// compares the attack's characteristics.
func hasAttackComparison(gate map[string]any) bool {
	if gate == nil {
		return false
	}
	if gate["attackComparisons"] != nil {
		return true
	}
	for _, raw := range anyList(gate["weaponRequirements"]) {
		if requirement, ok := asMap(raw); ok && hasAttackComparison(requirement) {
			return true
		}
	}
	return false
}

// attackOperand is a side of an attack comparison the engine supplies (the
// attack's S, or either unit's T, or a literal value), or nil.
func attackOperand(raw any) map[string]any {
	value, ok := asMap(raw)
	if !ok || value == nil {
		return nil
	}
	if literal, present := value["value"]; present && len(value) == 1 && isNumber(literal) {
		return map[string]any{"value": literal}
	}
	for key := range value {
		if key != "of" && key != "stat" && key != "reduce" {
			return nil
		}
	}
	reduce, reduced := value["reduce"]
	if reduced && reduce != "max" && reduce != "min" {
		return nil
	}
	of, stat := value["of"], value["stat"]
	supported := false
	switch of {
	case "attacker":
		supported = (stat == "S" && !reduced) || (stat == "T" && reduce != "min")
	case "defender":
		supported = stat == "T"
	}
	if !supported {
		return nil
	}
	out := map[string]any{"of": of, "stat": stat}
	if reduced {
		out["reduce"] = reduce
	}
	return out
}

// attackComparison is the canonical `attack-compare` parameters as a buff-gate
// comparison, or nil when the engine cannot evaluate them. ownToughness is the
// attacking unit's Toughness when the translation knows it (the ability
// belongs to the attacker), else nil: the gate then carries it as a value, so
// it holds on any crunch whatever context the caller passes.
func attackComparison(params map[string]any, ownToughness any) map[string]any {
	if params == nil {
		return nil
	}
	for key := range params {
		if key != "left" && key != "comparison" && key != "right" {
			return nil
		}
	}
	left := attackOperand(params["left"])
	right := attackOperand(params["right"])
	if left == nil || right == nil {
		return nil
	}
	if _, literal := left["value"]; literal {
		return nil
	}
	switch params["comparison"] {
	case "gt", "gte", "lt", "lte", "eq":
	default:
		return nil
	}
	bind := func(operand map[string]any) map[string]any {
		if _, literal := operand["value"]; ownToughness != nil && !literal && operand["of"] == "attacker" && operand["stat"] == "T" {
			return map[string]any{"value": ownToughness}
		}
		return operand
	}
	return map[string]any{"left": bind(left), "comparison": params["comparison"], "right": bind(right)}
}

// ownToughness is the attacking unit's Toughness on the context, or nil when
// the context does not carry one.
func ownToughness(ctx map[string]any) any {
	if t := ctx["attackerToughness"]; isNumber(t) {
		return t
	}
	return nil
}

// splitAttackScoped splits an `and` whose operands mix attack-scoped
// predicates (a weapon, the attack's Strength against the target's Toughness)
// with predicates on the units: the attack-scoped operands as one buff gate,
// and the rest to evaluate. Nested `and`s flatten. ok is false when no operand
// is attack-scoped, when every operand is, or when an attack-scoped operand
// has no gate.
func splitAttackScoped(condition map[string]any, perspective string, ownToughness any) (applicability, rest map[string]any, ok bool) {
	top, isList := asList(condition["operands"])
	if condition["operator"] != "and" || !isList {
		return nil, nil, false
	}
	operands := []any{}
	var flatten func([]any)
	flatten = func(list []any) {
		for _, operand := range list {
			if nested, isMap := asMap(operand); isMap && nested != nil && nested["operator"] == "and" {
				if inner, isList := asList(nested["operands"]); isList {
					flatten(inner)
					continue
				}
			}
			operands = append(operands, operand)
		}
	}
	flatten(top)
	applicability = map[string]any{}
	remaining := []any{}
	for _, operand := range operands {
		scoped, isMap := asMap(operand)
		if !isMap || scoped == nil || !isWeaponScopedCondition(scoped) {
			remaining = append(remaining, operand)
			continue
		}
		gate, isGate := conditionToApplicability(scoped, perspective, ownToughness).(map[string]any)
		if !isGate {
			return nil, nil, false
		}
		applicability = combineApplicability(applicability, gate)
	}
	if len(remaining) == 0 || len(remaining) == len(operands) {
		return nil, nil, false
	}
	if single, isMap := asMap(remaining[0]); len(remaining) == 1 && isMap && single != nil {
		return applicability, single, true
	}
	return applicability, map[string]any{"operator": "and", "operands": remaining}, true
}

// walkWithApplicability walks effect and attaches applicability to every
// buff it yields, applied and activatable.
func walkWithApplicability(effect any, source map[string]any, opts dslOpts, applicability map[string]any, out *effectTranslation) {
	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(effect, source, opts, sub)
	for _, raw := range sub.applied {
		if buff, ok := asMap(raw); ok {
			out.applied = append(out.applied, applyApplicability(buff, applicability))
		}
	}
	for _, raw := range sub.activatable {
		lever, ok := asMap(raw)
		if !ok {
			continue
		}
		buffs := getList(lever, "buffs")
		for i, buffRaw := range buffs {
			if buff, ok := asMap(buffRaw); ok {
				buffs[i] = applyApplicability(buff, applicability)
			}
		}
		lever["buffs"] = buffs
		out.activatable = append(out.activatable, lever)
	}
	out.unsupported = append(out.unsupported, sub.unsupported...)
}
