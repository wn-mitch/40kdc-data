package wh40kdc

import "strconv"

// encodeBase is the canonical string encoding of a base size for cross-impl
// comparison (mirrors maximalLoadout's string encoding). Returns "" for an
// absent base. Go mirror of python .../data/base.py.
//
//   - round 32     -> "round:32"
//   - oval 75x42   -> "oval:75x42"
//   - small flyer  -> "flying-base:small:draft"
//   - hull (draft) -> "hull:draft"
func encodeBase(b map[string]any) (string, bool) {
	if len(b) == 0 {
		return "", false
	}
	shape := getStr(b, "shape")
	parts := []string{shape}
	switch {
	case shape == "round" && b["diameter"] != nil:
		parts = append(parts, numStr(b["diameter"]))
	case shape == "oval" && b["width"] != nil && b["length"] != nil:
		parts = append(parts, numStr(b["width"])+"x"+numStr(b["length"]))
	case shape == "flying-base" && getStr(b, "size") != "":
		parts = append(parts, getStr(b, "size"))
	}
	if truthy(b["draft"]) {
		parts = append(parts, "draft")
	}
	out := parts[0]
	for _, p := range parts[1:] {
		out += ":" + p
	}
	return out, true
}

// numStr formats a number the way JS String() does: integral floats lose the
// ".0" (32.0 -> "32").
func numStr(v any) string {
	if f, ok := v.(float64); ok {
		if f == float64(int64(f)) {
			return strconv.FormatInt(int64(f), 10)
		}
		return strconv.FormatFloat(f, 'g', -1, 64)
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
