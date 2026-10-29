package wh40kdc

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Declared answers for leaf conditions the engine cannot evaluate from its context.
//
// A leaf condition the context does not decide evaluates to unknown (nil). The translator
// reports each such leaf as a need ({key, condition, perspective}); the caller answers it in
// the context's "conditionFacts" map under the need's key, and the leaf then evaluates to
// that answer. A compound (and/or/not) is never a need itself: it evaluates from its leaves.

// canonicalJSON renders value as JSON with object keys sorted (by UTF-16 code units, as JS
// sorts strings) at every depth and no whitespace, so equal conditions serialize to equal
// text in every port.
func canonicalJSON(value any) string {
	switch x := value.(type) {
	case nil:
		return "null"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return jsonString(x)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = canonicalJSON(e)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return utf16Less(keys[i], keys[j]) })
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = jsonString(k) + ":" + canonicalJSON(x[k])
		}
		return "{" + strings.Join(parts, ",") + "}"
	}
	if isNumber(value) {
		f, _ := num(value)
		return jsNumberText(f)
	}
	return "null"
}

// utf16Less orders strings by UTF-16 code units, the order JS `<` uses.
func utf16Less(a, b string) bool {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}

// jsNumberText formats a finite number as JS JSON.stringify does: shortest round-trip digits,
// exponent form only below 1e-6 or from 1e21, and non-finite values as null.
func jsNumberText(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null"
	}
	if f == 0 {
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	// d.ddddde±x: digits and the decimal exponent of the leading digit.
	sci := strconv.FormatFloat(f, 'e', -1, 64)
	mantissa, expText, _ := strings.Cut(sci, "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	exp, _ := strconv.Atoi(expText)
	n := exp + 1 // position of the decimal point relative to the digits
	switch {
	case n >= len(digits) && n <= 21:
		return sign + digits + strings.Repeat("0", n-len(digits))
	case n > 0 && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case n > -6 && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	expSign := "+"
	if exp < 0 {
		expSign = "-"
		exp = -exp
	}
	if len(digits) == 1 {
		return sign + digits + "e" + expSign + strconv.Itoa(exp)
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + expSign + strconv.Itoa(exp)
}

// conditionFactKey is the key a leaf condition's declared answer goes under: the perspective,
// then the leaf's canonical JSON. Unit references such as `this-unit` name a different unit
// from each perspective, so the perspective is part of the key.
func conditionFactKey(condition map[string]any, perspective string) string {
	return perspective + ":" + canonicalJSON(condition)
}

// conditionNeeds returns the leaves of condition that leave it undecided, deduplicated by key
// in first-seen order. evaluate is the engine's evaluator; a compound recurses into each
// operand that evaluates unknown, so an `and` already decided by a false operand contributes
// nothing.
func conditionNeeds(condition map[string]any, perspective string, evaluate func(map[string]any) any) []any {
	out := []any{}
	seen := map[string]bool{}
	var visit func(node map[string]any)
	visit = func(node map[string]any) {
		if evaluate(node) != nil {
			return
		}
		if _, isOp := node["operator"].(string); isOp {
			if operands, ok := node["operands"].([]any); ok {
				for _, operand := range operands {
					if m, ok := operand.(map[string]any); ok && m != nil {
						visit(m)
					}
				}
				return
			}
		}
		key := conditionFactKey(node, perspective)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, map[string]any{"key": key, "condition": node, "perspective": perspective})
	}
	visit(condition)
	return out
}

// undecidedNeeds lists the leaves of an undecided condition for an unsupported entry's
// "needs". A `timing-is` leaf is the activation's own moment, which the player opts into as a
// lever, so it is never a need.
func undecidedNeeds(condition, ctx map[string]any, perspective string, source map[string]any) []any {
	needs := []any{}
	for _, need := range conditionNeeds(condition, perspective, func(node map[string]any) any {
		return evaluateCondition(node, ctx, perspective, source)
	}) {
		leaf, _ := need.(map[string]any)["condition"].(map[string]any)
		if getStr(leaf, "type") != "timing-is" {
			needs = append(needs, need)
		}
	}
	return needs
}
