package wh40kdc

import (
	"strconv"
	"strings"
)

// Ordered JSON value + pretty-printer that reproduces JS
// JSON.stringify(value, null, 2) + "\n" byte-for-byte (2-space indent,
// insertion-order keys, raw non-ASCII, no HTML escaping). The JSON roster
// exporters build omap trees so their key order matches the TS/Rust/Python
// output exactly (Go's encoding/json sorts map keys, which would diverge).

type omap struct {
	keys []string
	m    map[string]any
}

func newOmap() *omap { return &omap{m: map[string]any{}} }

func (o *omap) set(k string, v any) *omap {
	if _, ok := o.m[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.m[k] = v
	return o
}

// prettyJSON renders an ordered JSON value as JS JSON.stringify(v, null, 2)+"\n".
func prettyJSON(v any) string { return renderJSON(v, 0) + "\n" }

func renderJSON(v any, ind int) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return jsonString(x)
	case float64:
		return numberJSON(x)
	case int:
		return strconv.Itoa(x)
	case *omap:
		if len(x.keys) == 0 {
			return "{}"
		}
		pad := strings.Repeat("  ", ind+1)
		parts := make([]string, len(x.keys))
		for i, k := range x.keys {
			parts[i] = pad + jsonString(k) + ": " + renderJSON(x.m[k], ind+1)
		}
		return "{\n" + strings.Join(parts, ",\n") + "\n" + strings.Repeat("  ", ind) + "}"
	case []any:
		if len(x) == 0 {
			return "[]"
		}
		pad := strings.Repeat("  ", ind+1)
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = pad + renderJSON(e, ind+1)
		}
		return "[\n" + strings.Join(parts, ",\n") + "\n" + strings.Repeat("  ", ind) + "]"
	}
	return "null"
}

func numberJSON(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

// jsonString matches JSON.stringify string escaping: ", \, and control chars
// (\b \t \n \f \r short forms, else \u00XX); non-ASCII passes through raw.
func jsonString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				const hex = "0123456789abcdef"
				b.WriteByte(hex[(r>>4)&0xf])
				b.WriteByte(hex[r&0xf])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}
