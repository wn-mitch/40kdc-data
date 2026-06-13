package wh40kdc

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Name normalization for diacritic- and punctuation-insensitive lookup.
//
// Go mirror of the TypeScript normalizeName (tools/src/data/normalize.ts),
// the Rust normalize_name, and the Python normalize_name; pinned together by
// the shared conformance/normalize.json corpus.

// quotesRe matches the apostrophe and quote variants stripped during
// normalization: ' U+0027, ’ U+2019, ‘ U+2018, ` U+0060, " U+0022, “ U+201C,
// ” U+201D. (Deliberately the same seven the other ports strip — e.g. ‛ U+201B
// is NOT included, so it passes through.)
var quotesRe = regexp.MustCompile("['’‘`\"“”]")

// spaceHyphenRe collapses any run of whitespace or ASCII hyphen to a single
// space. \s + \p{Z} + vertical tab covers the Unicode whitespace the corpus
// and fuzz pool exercise (incl. NBSP U+00A0 and ideographic space U+3000);
// only the ASCII hyphen-minus is treated as a hyphen (other hyphen variants
// pass through, matching the reference impls).
var spaceHyphenRe = regexp.MustCompile(`[\s\p{Z}\x{000b}-]+`)

// NormalizeName reduces a display name to a canonical lookup key. The
// transform, in order: NFD-decompose → strip combining marks → lowercase →
// remove quote variants → collapse whitespace/hyphen runs to a single space →
// trim. The result is for comparison only, not display.
func NormalizeName(input string) string {
	decomposed := norm.NFD.String(input)
	// Strip marks *before* lowercasing — load-bearing for İ (U+0130), whose
	// lowercase form introduces a combining dot that must survive.
	var b strings.Builder
	b.Grow(len(decomposed))
	for _, r := range decomposed {
		if !unicode.Is(unicode.M, r) {
			b.WriteRune(r)
		}
	}
	lowered := strings.ToLower(b.String())
	noQuotes := quotesRe.ReplaceAllString(lowered, "")
	collapsed := spaceHyphenRe.ReplaceAllString(noQuotes, " ")
	return strings.TrimSpace(collapsed)
}
