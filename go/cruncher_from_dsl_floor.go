package wh40kdc

import (
	"encoding/json"
	"sort"
	"strings"
)

// complementReason is the reason the stronger of a complementary re-roll pair is reported under
// while its condition is undecided.
const complementReason = "conditional: the stronger re-roll of a complementary pair needs its undecided condition; the weaker applies"

// stableJSON renders a value as JSON with object keys sorted, so equal values compare equal
// whatever their key order.
func stableJSON(value any) string {
	switch v := value.(type) {
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			parts[i] = stableJSON(item)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for i, key := range keys {
			encoded, _ := json.Marshal(key)
			parts[i] = string(encoded) + ":" + stableJSON(v[key])
		}
		return "{" + strings.Join(parts, ",") + "}"
	default:
		encoded, err := json.Marshal(v)
		if err != nil {
			return "null"
		}
		return string(encoded)
	}
}

// rerollRank is how much of a roll a re-roll covers: a re-roll of a higher rank re-rolls every
// die a lower one does. Zero means the modifier is not a ranked re-roll.
func rerollRank(modifier map[string]any) int {
	if modifier["result_scope"] == "any-result" {
		return 4
	}
	switch modifier["subset"] {
	case "ones":
		return 1
	case "ones-and-twos":
		return 2
	case "all-failures":
		return 3
	}
	return 0
}

// rerollIdentity is the re-roll effect's target and modifier without its coverage, which two
// comparable re-rolls share; empty when the effect is not a ranked re-roll.
func rerollIdentity(effect any) string {
	node, ok := asMap(effect)
	if !ok || getStr(node, "type") != "re-roll" {
		return ""
	}
	modifier, ok := getMap(node, "modifier")
	if !ok || rerollRank(modifier) == 0 {
		return ""
	}
	rest := map[string]any{}
	for key, value := range modifier {
		if key != "subset" && key != "result_scope" {
			rest[key] = value
		}
	}
	return stableJSON(map[string]any{"target": node["target"], "modifier": rest})
}

// complementaryFloors marks the steps of a sequence that form complementary conditionals
// ("C: A", "not C: B") whose condition is undecided and whose effects are re-rolls of the same
// roll, one covering the other. Exactly one of them applies, so the weaker always does: it is
// marked "weaker" (applied without its condition) and the stronger "stronger" (reported as
// needing the condition).
func complementaryFloors(steps []any, source map[string]any, opts dslOpts) map[int]string {
	floors := map[int]string{}
	negationOf := func(condition any) any {
		node, ok := asMap(condition)
		if !ok || node["operator"] != "not" {
			return nil
		}
		operands, ok := asList(node["operands"])
		if !ok || len(operands) != 1 {
			return nil
		}
		return operands[0]
	}
	same := func(left, right any) bool { return left != nil && stableJSON(left) == stableJSON(right) }
	var evalSource map[string]any
	if !opts.grantedHolder {
		evalSource = source
	}
	for left := 0; left < len(steps); left++ {
		for right := left + 1; right < len(steps); right++ {
			if _, ok := floors[left]; ok {
				continue
			}
			if _, ok := floors[right]; ok {
				continue
			}
			a, okA := asMap(steps[left])
			b, okB := asMap(steps[right])
			if !okA || !okB || getStr(a, "type") != "conditional" || getStr(b, "type") != "conditional" {
				continue
			}
			var positive any
			if same(negationOf(a["condition"]), b["condition"]) {
				positive = b["condition"]
			} else if same(negationOf(b["condition"]), a["condition"]) {
				positive = a["condition"]
			}
			condition, ok := asMap(positive)
			if !ok {
				continue
			}
			if evaluateCondition(condition, opts.context, opts.perspective, evalSource) != nil {
				continue
			}
			identity := rerollIdentity(a["effect"])
			if identity == "" || identity != rerollIdentity(b["effect"]) {
				continue
			}
			effectA, _ := asMap(a["effect"])
			effectB, _ := asMap(b["effect"])
			modifierA, _ := getMap(effectA, "modifier")
			modifierB, _ := getMap(effectB, "modifier")
			if rerollRank(modifierA) <= rerollRank(modifierB) {
				floors[left], floors[right] = "weaker", "stronger"
			} else {
				floors[left], floors[right] = "stronger", "weaker"
			}
		}
	}
	return floors
}

// walkSequence walks a sequence's steps, applying the weaker of each complementary re-roll pair
// and reporting the stronger as needing its condition.
func walkSequence(steps []any, source map[string]any, opts dslOpts, out *effectTranslation) {
	floors := complementaryFloors(steps, source, opts)
	var evalSource map[string]any
	if !opts.grantedHolder {
		evalSource = source
	}
	for index, step := range steps {
		switch floors[index] {
		case "weaker":
			node, _ := asMap(step)
			dslWalk(node["effect"], source, opts, out)
		case "stronger":
			node, _ := asMap(step)
			condition, _ := getMap(node, "condition")
			entry := unsup(complementReason, step)
			entry["needs"] = undecidedNeeds(condition, opts.context, opts.perspective, evalSource)
			out.unsupported = append(out.unsupported, entry)
		default:
			dslWalk(step, source, opts, out)
		}
	}
}
