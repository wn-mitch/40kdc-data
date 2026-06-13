package wh40kdc

import "math"

// Per-stage buff attribution by leave-one-out (LOO) recompute. Go mirror of
// python .../cruncher/attribution.py. Lift order (first-seen group order) is a
// conformance contract.

func isGroupable(source map[string]any) bool {
	k := getStr(source, "kind")
	return k == "ability" || k == "manual"
}

func groupKey(source map[string]any) string {
	switch getStr(source, "kind") {
	case "ability":
		return "a:" + getStr(source, "abilityId") + ":" + getStr(source, "sourceUnitId")
	case "manual":
		return "m:" + getStr(source, "label")
	}
	return "w:" + getStr(source, "weaponId") + ":" + getStr(source, "keywordId")
}

func attributeStages(input map[string]any, ds *Dataset, epsilon float64) ([]map[string]any, error) {
	fullStages, fullRes, err := crunch(input, ds)
	if err != nil {
		return nil, err
	}
	buffs := getList(input, "buffs")

	var order []string
	repSource := map[string]map[string]any{}
	for _, bAny := range buffs {
		b, _ := asMap(bAny)
		source, _ := getMap(b, "source")
		if !isGroupable(source) {
			continue
		}
		key := groupKey(source)
		if _, seen := repSource[key]; !seen {
			repSource[key] = source
			order = append(order, key)
		}
	}

	withBuffs := func(filter func(source map[string]any) bool) map[string]any {
		var kept []any
		for _, bAny := range buffs {
			b, _ := asMap(bAny)
			source, _ := getMap(b, "source")
			if filter(source) {
				kept = append(kept, bAny)
			}
		}
		ni := cloneMap(input)
		ni["buffs"] = toAnySlice(kept)
		return ni
	}

	baselineStages, _, err := crunch(withBuffs(func(s map[string]any) bool { return !isGroupable(s) }), ds)
	if err != nil {
		return nil, err
	}

	loo := map[string][]map[string]any{}
	for _, key := range order {
		k := key
		stages, _, err := crunch(withBuffs(func(s map[string]any) bool {
			return !isGroupable(s) || groupKey(s) != k
		}), ds)
		if err != nil {
			return nil, err
		}
		loo[key] = stages
	}

	intrinsics := []any{}
	for _, e := range fullRes.extraKeywords {
		intrinsics = append(intrinsics, getStr(e.keywordRef, "keyword_id"))
	}

	out := make([]map[string]any, 0, len(fullStages))
	for i, st := range fullStages {
		expected, _ := num(st["expected"])
		baseExpected, _ := num(baselineStages[i]["expected"])
		totalLift := 0.0
		lifts := []any{}
		for _, key := range order {
			looExpected, _ := num(loo[key][i]["expected"])
			delta := expected - looExpected
			totalLift += delta
			if math.Abs(delta) > epsilon {
				lifts = append(lifts, map[string]any{"source": repSource[key], "delta": delta})
			}
		}
		residual := expected - baseExpected - totalLift
		if math.Abs(residual) <= epsilon {
			residual = 0
		}
		out = append(out, map[string]any{
			"name":       st["name"],
			"expected":   expected,
			"baseline":   baseExpected,
			"lifts":      lifts,
			"residual":   residual,
			"intrinsics": intrinsics,
		})
	}
	return out, nil
}
