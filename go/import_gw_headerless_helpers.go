package wh40kdc

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Helpers for the headerless plain-text adapter (import_gw_headerless.go):
// BCP summary stripping, points and battle-size parsing, and the exact
// per-model loadout groups. Mirror of tools/src/import/gw-headerless.ts.

// A line of only `+` characters — the BCP summary block's fence.
var gwhPlusFence = regexp.MustCompile(`^\++$`)

// A line inside that block identifying it as BCP's (not GW's own `+ …` fence).
var gwhBcpSummaryMarker = regexp.MustCompile(`(?im)^\s*\+?\s*(?:Player Name|Team Name|Factions? Used|Army Points)\s*:`)

// The BCP summary's `WARLORD:` line, which names the warlord unit by prefix.
var gwhBcpWarlord = regexp.MustCompile(`(?im)^\s*\+?\s*WARLORD:\s*(.+?)\s*$`)

// Battle-size labels that look like unit headers (`Strike Force (2,000 Points)`)
// but are army metadata, not datasheets.
var gwhBattleSizeNames = map[string]bool{
	"combat patrol": true,
	"incursion":     true,
	"strike force":  true,
	"onslaught":     true,
	"strikeforce":   true,
}

// Force dispositions printed as a bare preamble line.
var gwhForceDispositionNames = map[string]bool{
	"disruption":      true,
	"priority assets": true,
	"purge the foe":   true,
	"reconnaissance":  true,
	"recon":           true,
	"take and hold":   true,
}

// Super-faction breadcrumbs the GW app prints before the real faction.
var gwhGenericFactionBreadcrumbs = map[string]bool{
	"chaos":         true,
	"imperium":      true,
	"space marines": true,
	"xenos":         true,
}

var gwhNonDigits = regexp.MustCompile(`\D`)

// gwhParsePts reads the digits of a points string ("2,000", "1.995", "2 000"),
// ignoring every separator; nil when there are none.
func gwhParsePts(raw string) any {
	n, err := strconv.Atoi(gwhNonDigits.ReplaceAllString(raw, ""))
	if err != nil {
		return nil
	}
	return float64(n)
}

func gwhIsBattleSize(name string) bool {
	return gwhBattleSizeNames[strings.ToLower(strings.TrimSpace(name))]
}

// gwhIndent counts leading whitespace characters (not bytes), as TS's
// `raw.length - raw.trimStart().length` does for a non-breaking space.
func gwhIndent(raw string) int {
	return utf8.RuneCountInString(raw) - utf8.RuneCountInString(strings.TrimLeftFunc(raw, unicode.IsSpace))
}

// gwhJoinFinalAnd rewrites the ` and ` after the last comma of a wargear list
// to `, ` (`a, b and c` → `a, b, c`); a list without a comma is only trimmed.
// Mirror of TS `replace(/\s+and\s+(?=[^,]+$)/i, ", ")`.
func gwhJoinFinalAnd(list string) string {
	lastComma := strings.LastIndex(list, ",")
	if lastComma < 0 {
		return strings.TrimSpace(list)
	}
	tail := list[lastComma+1:]
	for _, loc := range gwhAndBeforeLast.FindAllStringIndex(tail, -1) {
		if loc[1] < len(tail) {
			return strings.TrimSpace(list[:lastComma+1] + tail[:loc[0]] + ", " + tail[loc[1]:])
		}
	}
	return strings.TrimSpace(list)
}

// gwhStripBcpSummary drops a `++…++`-fenced BCP summary block (`Player Name:` /
// `Factions Used:` / `Army Points: N` / …), keeping the lines around it. It is
// BCP metadata, not part of the pasted roster, and would otherwise be consumed
// as the roster title, turning the real title line into a phantom unit. Only
// the first fence pair is considered, and only when it wraps a BCP marker or
// the text after it carries the GW app's battle-size line, so a framed GW
// export's own `+ FACTION KEYWORD:` fence is left intact.
func gwhStripBcpSummary(text string) string {
	lines := splitLines(text)
	open := -1
	for i, line := range lines {
		if gwhPlusFence.MatchString(strings.TrimSpace(line)) {
			open = i
			break
		}
	}
	if open < 0 {
		return text
	}
	closeIdx := -1
	for j := open + 1; j < len(lines); j++ {
		if gwhPlusFence.MatchString(strings.TrimSpace(lines[j])) {
			closeIdx = j
			break
		}
	}
	if closeIdx == -1 {
		return text
	}
	block := strings.Join(lines[open+1:closeIdx], "\n")
	remainder := strings.Join(lines[closeIdx+1:], "\n")
	if !gwhBcpSummaryMarker.MatchString(block) && !gwEmbeddedAppBattleSize.MatchString(remainder) {
		return text
	}
	kept := append(append([]string{}, lines[:open]...), lines[closeIdx+1:]...)
	return strings.Join(kept, "\n")
}

// gwhLoadoutGroup is one model group as the source lists it: the model name,
// how many models carry it, and its items ({raw_name, count per model}) in
// source order. A repeated name stays a separate item, as in TS.
type gwhLoadoutGroup struct {
	modelName string
	count     int
	wargear   []any
}

// gwhModelGroupLoadout reads the per-model loadout of the model group bullet
// at index i (n models). Each child's count is the squad-wide total, so it
// must divide evenly by n. Returns false when any child is an annotation or
// does not divide, or when the group has no wargear.
func gwhModelGroupLoadout(bullets []gwhBullet, i, n int) (gwhLoadoutGroup, bool) {
	group := gwhLoadoutGroup{modelName: bullets[i].name, count: n, wargear: []any{}}
	exact := true
	for _, child := range bullets[i+1:] {
		if child.indent <= bullets[i].indent {
			break
		}
		total := gwhBulletCount(child)
		if child.isAttachment || child.setsCharacter || child.hasEnhancement ||
			child.isAnnotation || child.colonWargear != nil || n == 0 || total%n != 0 {
			exact = false
			continue
		}
		group.wargear = append(group.wargear, map[string]any{"raw_name": child.name, "count": float64(total / n)})
	}
	return group, exact && len(group.wargear) > 0
}

// gwhExactLoadoutGroups returns the candidate groups as parsed loadout_groups
// when they cover modelCount models and reproduce the unit's wargear totals
// exactly; otherwise false, and resolve rebuilds groups from composition.
func gwhExactLoadoutGroups(candidates []gwhLoadoutGroup, modelCount int, wargear *orderedCounter) ([]any, bool) {
	groupedModels := 0
	grouped := map[string]int{}
	for _, g := range candidates {
		groupedModels += g.count
		for _, itemAny := range g.wargear {
			item, _ := itemAny.(map[string]any)
			grouped[getStr(item, "raw_name")] += asInt(item["count"]) * g.count
		}
	}
	if groupedModels != modelCount || len(grouped) != len(wargear.keys) {
		return nil, false
	}
	for _, name := range wargear.keys {
		if grouped[name] != wargear.m[name] {
			return nil, false
		}
	}
	out := make([]any, 0, len(candidates))
	for _, g := range candidates {
		out = append(out, map[string]any{
			"model_name": g.modelName,
			"count":      float64(g.count),
			"wargear":    g.wargear,
		})
	}
	return out, true
}

var (
	gwhDenseAttachedHeadings = regexp.MustCompile(`(?i)^(Attached Units)\s+(Attached Unit\s+\d+)$`)
	gwhDenseMetadata         = regexp.MustCompile(`(?i)^(.+?\(\s*\d+\s+Detachment Points?\s*\))\s+(Disruption|Priority Assets|Purge the Foe|Reconnaissance|Take and Hold)\s+((?:Combat Patrol|Incursion|Strike Force|Onslaught)\s*\(.+\))$`)
	gwhDenseCountStart       = regexp.MustCompile(`^\d+[x×]\s`)
	gwhDenseLeadingBullet    = regexp.MustCompile(`^[•◦]\s*(.+)$`)
)

// gwhSplitBeforeRuns splits s at each run of tab/space/NBSP whose preceding
// rune passes before and whose remainder passes after, dropping the run.
// Mirror of the TS lookbehind/lookahead splits in expandDenseLines.
func gwhSplitBeforeRuns(s string, before func(rune) bool, after func(string) bool) []string {
	runes := []rune(s)
	isRun := func(r rune) bool { return r == ' ' || r == '\t' || r == ' ' }
	var parts []string
	start := 0
	for i := 0; i < len(runes); {
		if !isRun(runes[i]) || i == 0 {
			i++
			continue
		}
		end := i
		for end < len(runes) && isRun(runes[end]) {
			end++
		}
		if !unicode.IsSpace(runes[i-1]) && before(runes[i-1]) && after(string(runes[end:])) {
			parts = append(parts, string(runes[start:i]))
			start = end
		}
		i = end
	}
	return append(parts, string(runes[start:]))
}

// gwhExpandDenseLines recovers line breaks that spreadsheet/copy-paste
// pipelines strip: a `•`/`◦` bullet or an `Nx ` count after other text on the
// same line starts a new logical line. A count right after "," or ":" stays
// in its `Model: a, 2x b` list. Mirror of TS expandDenseLines.
func gwhExpandDenseLines(text string) []string {
	var out []string
	for _, rawLine := range splitLines(text) {
		bulletParts := gwhSplitBeforeRuns(rawLine,
			func(rune) bool { return true },
			func(rest string) bool { return strings.HasPrefix(rest, "•") || strings.HasPrefix(rest, "◦") })
		for _, bulletPart := range bulletParts {
			trimmed := strings.TrimSpace(bulletPart)
			if m := gwhDenseAttachedHeadings.FindStringSubmatch(trimmed); m != nil {
				out = append(out, m[1], m[2])
				continue
			}
			if m := gwhDenseMetadata.FindStringSubmatch(trimmed); m != nil {
				out = append(out, m[1], m[2], m[3])
				continue
			}
			countParts := gwhSplitBeforeRuns(bulletPart,
				func(r rune) bool { return !strings.ContainsRune("•◦*,:", r) },
				gwhDenseCountStart.MatchString)
			for _, part := range countParts {
				if m := gwhDenseLeadingBullet.FindStringSubmatch(strings.TrimSpace(part)); m != nil && gwhPtsLine.MatchString(m[1]) {
					part = m[1]
				}
				out = append(out, part)
			}
		}
	}
	return out
}
