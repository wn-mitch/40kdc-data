package wh40kdc

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// NewRecruit wtc-compact / wtc-full text adapters. Go mirror of
// python .../imports/newrecruit_wtc.py.

const wtcHeaderPrefix = "+ FACTION KEYWORD:"

var wtcHeaderFaction = regexp.MustCompile(`(?i)^\+\s*FACTION KEYWORD:\s*(.+?)\s*$`)
var wtcHeaderDetachment = regexp.MustCompile(`(?i)^\+\s*DETACHMENT:\s*(.+?)\s*$`)
var wtcHeaderTotalPoints = regexp.MustCompile(`(?i)^\+\s*TOTAL ARMY POINTS:\s*(\d+)\s*pts?\s*$`)
var wtcHeaderPointsLimit = regexp.MustCompile(`(?i)^\+\s*POINTS LIMIT:\s*(\d+)\s*pts?\s*$`)
var wtcHeaderListName = regexp.MustCompile(`(?i)^\+\s*LIST NAME:\s*(.+?)\s*$`)
var fenceRe = regexp.MustCompile(`^\++\s*$`)

var unitHeaderCompact = regexp.MustCompile(`(?i)^(?:Char\d+:\s*)?(\d+)x\s+(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*:\s*(.*)$`)
var unitHeaderFull = regexp.MustCompile(`(?i)^(?:Char\d+:\s*)?(\d+)x\s+(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*$`)
var enhancementLineRe = regexp.MustCompile(`(?i)^Enhancement:\s*(.+?)\s*\(\+\s*(\d+)\s*pts?\s*\)\s*$`)
var withPrefixRe = regexp.MustCompile(`(?i)^(\d+)\s+with\s+(.*)$`)
var modelBreakdownRe = regexp.MustCompile(`^\s*•\s*(\d+)x\s+(.+?)(?:\s*\[[^\]]*\])?\s*$`)
var sectionHeaderRe = regexp.MustCompile(`^[A-Z][A-Z0-9 \-/&]+$`)
var headerLineRe = regexp.MustCompile(`^\+`)
var charPrefixRe = regexp.MustCompile(`(?i)^Char\d+:`)

type wtcHeader struct {
	name              string
	factionRawName    any
	detachmentRawName any
	declaredLimit     any
	totalReported     any
	battleSizeRaw     any
}

func parseWtcHeader(text string) (*wtcHeader, int, bool) {
	lines := splitLines(text)
	var factionRaw, detachmentRaw, totalReported, pointsLimit, listName any
	fenceIndices := []int{}
	for i, line := range lines {
		if len(fenceIndices) >= 2 {
			break
		}
		if fenceRe.MatchString(line) {
			fenceIndices = append(fenceIndices, i)
		}
	}
	sawFaction := false
	for _, line := range lines {
		if !strings.HasPrefix(line, "+") {
			continue
		}
		if m := wtcHeaderFaction.FindStringSubmatch(line); m != nil {
			factionRaw = factionFromKeyword(m[1])
			sawFaction = true
			continue
		}
		if m := wtcHeaderDetachment.FindStringSubmatch(line); m != nil {
			detachmentRaw = stripParenthetical(m[1])
			continue
		}
		if m := wtcHeaderTotalPoints.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			totalReported = float64(n)
			continue
		}
		if m := wtcHeaderPointsLimit.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			pointsLimit = float64(n)
			continue
		}
		if m := wtcHeaderListName.FindStringSubmatch(line); m != nil {
			listName = m[1]
		}
	}
	if !sawFaction {
		return nil, 0, false
	}
	bodyStart := 0
	if len(fenceIndices) >= 2 {
		bodyStart = fenceIndices[1] + 1
	}
	declaredLimit := pointsLimit
	if declaredLimit == nil {
		declaredLimit = totalReported
	}
	name := "Imported roster"
	if s, ok := listName.(string); ok {
		name = s
	}
	return &wtcHeader{
		name: name, factionRawName: factionRaw, detachmentRawName: detachmentRaw,
		declaredLimit: declaredLimit, totalReported: totalReported,
		battleSizeRaw: inferBattleSizeRaw(declaredLimit),
	}, bodyStart, true
}

type wtcUnit struct {
	rawName            string
	isCharacter        bool
	isWarlord          bool
	enhancementRawName any
	displayedPts       any
	enhancementPts     int
	modelCount         int
	wargear            *orderedCounter
}

func newWtcUnit(name string, displayedPts int, leadingCount int, isCharPrefix bool) *wtcUnit {
	mc := leadingCount
	if mc <= 0 {
		mc = 1
	}
	return &wtcUnit{rawName: name, isCharacter: isCharPrefix, displayedPts: float64(displayedPts), modelCount: mc, wargear: newOrderedCounter()}
}

func parseWithGroup(text string) (int, string) {
	if m := withPrefixRe.FindStringSubmatch(text); m != nil {
		n, _ := strconv.Atoi(m[1])
		if n <= 0 {
			n = 1
		}
		return n, m[2]
	}
	return 1, text
}

func applyWithGroup(unit *wtcUnit, listText string) {
	multiplier, wargearList := parseWithGroup(listText)
	cls := classifyWargearList(splitWargearList(wargearList))
	if cls.isWarlord {
		unit.isWarlord = true
	}
	if cls.isCharacter {
		unit.isCharacter = true
	}
	for _, wAny := range cls.wargear {
		w := wAny.(map[string]any)
		unit.wargear.add(getStr(w, "raw_name"), asInt(w["count"])*multiplier)
	}
}

func finishWtcUnit(unit *wtcUnit) map[string]any {
	var points any
	if unit.displayedPts != nil {
		points = float64(asInt(unit.displayedPts) - unit.enhancementPts)
	}
	var enhPts any
	if unit.enhancementRawName != nil {
		enhPts = float64(unit.enhancementPts)
	}
	return map[string]any{
		"raw_name":             unit.rawName,
		"is_character":         unit.isCharacter,
		"model_count":          float64(unit.modelCount),
		"points":               points,
		"is_warlord":           unit.isWarlord,
		"enhancement_raw_name": unit.enhancementRawName,
		"enhancement_points":   enhPts,
		"wargear":              unit.wargear.pairs(),
	}
}

func computeWtcTotal(units []map[string]any, enhPts []int) float64 {
	total := 0.0
	for i, u := range units {
		if p, ok := u["points"].(float64); ok {
			total += p
		}
		if i < len(enhPts) {
			total += float64(enhPts[i])
		}
	}
	return total
}

func parseCompactBody(body string) ([]map[string]any, []int) {
	lines := splitLines(body)
	var units []map[string]any
	var enhPts []int
	var current *wtcUnit
	finalize := func() {
		if current != nil {
			units = append(units, finishWtcUnit(current))
			enhPts = append(enhPts, current.enhancementPts)
			current = nil
		}
	}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || headerLineRe.MatchString(line) || fenceRe.MatchString(line) {
			continue
		}
		if enh := enhancementLineRe.FindStringSubmatch(line); enh != nil && current != nil {
			current.enhancementRawName = strings.TrimSpace(enh[1])
			current.enhancementPts, _ = strconv.Atoi(enh[2])
			finalize()
			continue
		}
		if m := unitHeaderCompact.FindStringSubmatch(line); m != nil {
			finalize()
			leadingCount, _ := strconv.Atoi(m[1])
			pts, _ := strconv.Atoi(m[3])
			current = newWtcUnit(strings.TrimSpace(m[2]), pts, leadingCount, charPrefixRe.MatchString(line))
			applyWithGroup(current, m[4])
			continue
		}
	}
	finalize()
	return units, enhPts
}

func parseFullBody(body string) ([]map[string]any, []int) {
	lines := splitLines(body)
	var units []map[string]any
	var enhPts []int
	var current *wtcUnit
	breakdownModels := 0
	finalize := func() {
		if current != nil {
			if breakdownModels > 0 {
				current.modelCount = breakdownModels
			}
			units = append(units, finishWtcUnit(current))
			enhPts = append(enhPts, current.enhancementPts)
			current = nil
			breakdownModels = 0
		}
	}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || headerLineRe.MatchString(line) || fenceRe.MatchString(line) {
			continue
		}
		if sectionHeaderRe.MatchString(line) && !unitHeaderFull.MatchString(line) {
			finalize()
			continue
		}
		if enh := enhancementLineRe.FindStringSubmatch(line); enh != nil && current != nil {
			current.enhancementRawName = strings.TrimSpace(enh[1])
			current.enhancementPts, _ = strconv.Atoi(enh[2])
			continue
		}
		if m := unitHeaderFull.FindStringSubmatch(line); m != nil {
			finalize()
			leadingCount, _ := strconv.Atoi(m[1])
			pts, _ := strconv.Atoi(m[3])
			current = newWtcUnit(strings.TrimSpace(m[2]), pts, leadingCount, charPrefixRe.MatchString(line))
			continue
		}
		if bd := modelBreakdownRe.FindStringSubmatch(raw); bd != nil && current != nil {
			n, _ := strconv.Atoi(bd[1])
			breakdownModels += n
			continue
		}
		if withPrefixRe.MatchString(line) && current != nil {
			applyWithGroup(current, line)
			continue
		}
	}
	finalize()
	return units, enhPts
}

var alliedUnitsRe = regexp.MustCompile(`(?im)^ALLIED UNITS\s*$`)

func detectMultiForce(text, format string) bool {
	if format == "wtc-full" {
		return alliedUnitsRe.MatchString(text)
	}
	return false
}

func isWtcText(decoded any) (string, bool) {
	s, ok := decoded.(string)
	if !ok {
		return "", false
	}
	if !strings.Contains(s, wtcHeaderPrefix) {
		return "", false
	}
	return s, true
}

var fullFormatRe = regexp.MustCompile(`(?m)^[\t ]*\d+\s+with\b`)
var bulletsRe = regexp.MustCompile(`(?m)^[\t ]*•`)

func isFullFormat(text string) bool { return fullFormatRe.MatchString(text) }
func hasBullets(text string) bool   { return bulletsRe.MatchString(text) }

func parseWtcWithFormat(text, format string) (map[string]any, error) {
	header, bodyStart, ok := parseWtcHeader(text)
	if !ok {
		return nil, errors.New(format + ": missing \"+ FACTION KEYWORD:\" header")
	}
	bodyLines := splitLines(text)[bodyStart:]
	body := strings.Join(bodyLines, "\n")
	var units []map[string]any
	var enhPts []int
	if format == "wtc-full" {
		units, enhPts = parseFullBody(body)
	} else {
		units, enhPts = parseCompactBody(body)
	}
	det := []any{}
	if s, ok := header.detachmentRawName.(string); ok && s != "" {
		det = []any{s}
	}
	return map[string]any{
		"name":                 header.name,
		"generated_by":         nil,
		"faction_raw_name":     header.factionRawName,
		"detachment_raw_names": det,
		"battle_size_raw":      header.battleSizeRaw,
		"declared_limit":       header.declaredLimit,
		"total_reported":       header.totalReported,
		"total_computed":       computeWtcTotal(units, enhPts),
		"units":                mapsToAny(units),
		"multi_force":          detectMultiForce(text, format),
	}, nil
}

func mapsToAny(units []map[string]any) []any {
	out := make([]any, len(units))
	for i, u := range units {
		out[i] = u
	}
	return out
}

var newrecruitWtcCompactAdapter = formatAdapter{
	id: "newrecruit-wtc-compact",
	matches: func(decoded any) bool {
		text, ok := isWtcText(decoded)
		if !ok {
			return false
		}
		return !isFullFormat(text) && !hasBullets(text)
	},
	parse: func(decoded any) (map[string]any, error) {
		text, ok := isWtcText(decoded)
		if !ok {
			return nil, errors.New("newrecruit-wtc-compact: input is not a string")
		}
		return parseWtcWithFormat(text, "wtc-compact")
	},
}

var newrecruitWtcFullAdapter = formatAdapter{
	id: "newrecruit-wtc-full",
	matches: func(decoded any) bool {
		text, ok := isWtcText(decoded)
		if !ok {
			return false
		}
		return isFullFormat(text)
	},
	parse: func(decoded any) (map[string]any, error) {
		text, ok := isWtcText(decoded)
		if !ok {
			return nil, errors.New("newrecruit-wtc-full: input is not a string")
		}
		return parseWtcWithFormat(text, "wtc-full")
	},
}
