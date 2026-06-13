package wh40kdc

import "math"

// Translate a weapon-keyword catalog entry into the Buff stack it contributes.
// Go mirror of python .../cruncher/from_keyword.py.

var engineDispatchKeywords = map[string]bool{
	"lethal-hits": true, "sustained-hits": true, "devastating-wounds": true,
	"anti": true, "melta": true, "rapid-fire": true, "torrent": true,
	"ignores-cover": true,
}

func buffsFromKeyword(keywordID, weaponID string, effect any, parameters map[string]any, ctx map[string]any) []any {
	source := map[string]any{"kind": "weapon-keyword", "weaponId": weaponID, "keywordId": keywordID}
	if engineDispatchKeywords[keywordID] {
		ref := map[string]any{"keyword_id": keywordID}
		if parameters != nil {
			ref["parameters"] = parameters
		}
		return []any{map[string]any{"source": source, "contribution": map[string]any{"type": "extra-keyword", "keywordRef": ref}}}
	}
	if effect == nil {
		return nil
	}
	return kwWalk(effect, source, ctx)
}

func kwWalk(node any, source map[string]any, ctx map[string]any) []any {
	n, ok := asMap(node)
	if !ok {
		return nil
	}
	switch getStr(n, "type") {
	case "re-roll":
		return kwReroll(n, source)
	case "roll-modifier":
		return kwRollModifier(n, source)
	case "feel-no-pain":
		return kwFeelNoPain(n, source)
	case "keyword-grant":
		return kwKeywordGrant(n, source)
	case "conditional":
		return kwConditional(n, source, ctx)
	case "sequence":
		return kwWalkChildren(getList(n, "steps"), source, ctx)
	}
	return nil
}

func kwWalkChildren(children []any, source map[string]any, ctx map[string]any) []any {
	var out []any
	for _, child := range children {
		out = append(out, kwWalk(child, source, ctx)...)
	}
	return out
}

func kwReroll(node, source map[string]any) []any {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return nil
	}
	roll := getStr(modifier, "roll")
	subset := getStr(modifier, "subset")
	if (roll == "hit" || roll == "wound" || roll == "save" || roll == "damage") &&
		(subset == "ones" || subset == "all-failures") {
		return []any{map[string]any{"source": source, "contribution": map[string]any{"type": "reroll", "roll": roll, "subset": subset}}}
	}
	return nil
}

func kwRollModifier(node, source map[string]any) []any {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return nil
	}
	if getStr(modifier, "operation") != "add" {
		return nil
	}
	value, isNum := num(modifier["value"])
	if !isNum || math.IsInf(value, 0) || math.IsNaN(value) {
		return nil
	}
	ct := rollToContribType(getStr(modifier, "roll"))
	if ct == "" {
		return nil
	}
	return []any{map[string]any{"source": source, "contribution": map[string]any{"type": ct, "value": value}}}
}

func rollToContribType(roll string) string {
	switch roll {
	case "hit":
		return "hit-mod"
	case "wound":
		return "wound-mod"
	case "save":
		return "save-mod"
	case "damage":
		return "damage-mod"
	}
	return ""
}

func kwFeelNoPain(node, source map[string]any) []any {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return nil
	}
	threshold, isNum := num(modifier["threshold"])
	if !isNum || math.IsInf(threshold, 0) || math.IsNaN(threshold) {
		return nil
	}
	return []any{map[string]any{"source": source, "contribution": map[string]any{"type": "feel-no-pain", "threshold": threshold}}}
}

func kwKeywordGrant(node, source map[string]any) []any {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return nil
	}
	id := getStr(modifier, "keyword_id")
	if id == "" {
		id = getStr(modifier, "id")
	}
	if id == "" {
		return nil
	}
	ref := map[string]any{"keyword_id": id}
	if params, ok := getMap(modifier, "parameters"); ok {
		ref["parameters"] = params
	}
	return []any{map[string]any{"source": source, "contribution": map[string]any{"type": "extra-keyword", "keywordRef": ref}}}
}

func kwConditional(node, source map[string]any, ctx map[string]any) []any {
	condition, ok := getMap(node, "condition")
	if !ok {
		return nil
	}
	negated := condition["negated"] == true
	verdict := kwEvaluateCondition(condition, ctx)
	if verdict == nil { // unknown
		return nil
	}
	v := verdict.(bool)
	active := v
	if negated {
		active = !v
	}
	if !active {
		return nil
	}
	return kwWalk(node["effect"], source, ctx)
}

// kwEvaluateCondition returns bool, or nil for "unknown".
func kwEvaluateCondition(condition, ctx map[string]any) any {
	switch getStr(condition, "type") {
	case "remained-stationary":
		return ctx["attackerStationary"] == true
	case "target-has-keyword":
		params, _ := getMap(condition, "parameters")
		kw, ok := params["keyword"].(string)
		if !ok {
			return nil
		}
		return containsAny(getList(ctx, "targetKeywords"), lower(kw))
	}
	return nil
}
