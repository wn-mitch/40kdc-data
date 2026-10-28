package wh40kdc

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// GW 40K app text export adapter. Go mirror of python .../imports/gw.py.

var gwHeaderFaction = regexp.MustCompile(`(?i)^\+\s*FACTION KEYWORD:\s*(.+?)\s*$`)
var gwHeaderDetachment = regexp.MustCompile(`(?i)^\+\s*DETACHMENT:\s*(.+?)\s*$`)
var gwHeaderForceDisposition = regexp.MustCompile(`(?i)^\+\s*(?:FORCE DISPOSITION|DISPO):\s*(.+?)\s*$`)
var gwHeaderTotalPoints = regexp.MustCompile(`(?i)^\+\s*TOTAL ARMY POINTS:\s*(\d+)\s*pts?\s*$`)
var gwSectionHeader = regexp.MustCompile(`^[A-Z][A-Z0-9 \-/&]+$`)
var gwUnitHeader = regexp.MustCompile(`(?i)^(.+?)\s*\(\s*(\d+)\s*(?:pts?|points?)\s*\)\s*$`)
var gwBulletLine = regexp.MustCompile(`^(\s*)([•◦])\s*(.+?)\s*$`)

// The "Attached Units" preamble groups a Leader/Support character with its
// bodyguard unit under `Attached Unit N` before the ALL-CAPS role sections
// begin. The marker is mixed case (never a section header) and has no
// `(N pts)` suffix (never a unit header): it is purely a pairing fence.
var gwAttachedUnitHeader = regexp.MustCompile(`(?i)^Attached Unit\s+\d+\s*$`)
var gwAttachedAsBullet = regexp.MustCompile(`(?i)^Attached as:\s*(Leader|Support|Bodyguard)\b`)
var gwNxPrefix = regexp.MustCompile(`^(\d+)x\s+(.+)$`)
var gwEnhancementAnnot = regexp.MustCompile(`(?i)^(.+?)\s*\(\+\s*(\d+)\s*pts?\s*\)\s*$`)
var gwWithLine = regexp.MustCompile(`(?m)^[\t ]*\d+\s+with\b`)
var gwBullet = regexp.MustCompile(`(?m)^[\t ]*•`)
var gwSerializedWtc = regexp.MustCompile(`(?im)^\+\s*LIST NAME:`)
var gwWtcCompactUnit = regexp.MustCompile(`(?im)^(?:Char\d+:\s*)?\d+x\s+.+?\(\s*\d+\s*pts?\s*\)\s*:`)
var gwEmbeddedAppBattleSize = regexp.MustCompile(`(?im)^\s*(?:Combat Patrol|Incursion|Strike Force|Onslaught)\s*\(\s*[\d.,]+\s*Points?\s*\)\s*$`)

const gwFactionKeywordPrefix = "+ FACTION KEYWORD:"
const gwAlliedSection = "ALLIED UNITS"
const gwCharactersSection = "CHARACTERS"

type gwUnit struct {
	rawName      string
	displayedPts any
	section      string
	bullets      []lftBulletEntry
}

func isGwText(decoded any) (string, bool) {
	s, ok := decoded.(string)
	if !ok {
		return "", false
	}
	if !strings.Contains(s, gwFactionKeywordPrefix) {
		return "", false
	}
	if !gwBullet.MatchString(s) {
		return "", false
	}
	if gwWithLine.MatchString(s) || gwWtcCompactUnit.MatchString(s) || gwSerializedWtc.MatchString(s) || gwEmbeddedAppBattleSize.MatchString(s) {
		return "", false
	}
	return s, true
}

func gwParseHeader(lines []string) (map[string]any, int, bool) {
	var factionRaw, detachmentRaw, forceDispositionRaw, totalReported any
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
		if m := gwHeaderFaction.FindStringSubmatch(line); m != nil {
			factionRaw = factionFromKeyword(m[1])
			sawFaction = true
			continue
		}
		if m := gwHeaderDetachment.FindStringSubmatch(line); m != nil {
			detachmentRaw = stripParenthetical(m[1])
			continue
		}
		if m := gwHeaderForceDisposition.FindStringSubmatch(line); m != nil {
			forceDispositionRaw = m[1]
			continue
		}
		if m := gwHeaderTotalPoints.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			totalReported = float64(n)
		}
	}
	if !sawFaction {
		return nil, 0, false
	}
	bodyStart := 0
	if len(fenceIndices) >= 2 {
		bodyStart = fenceIndices[1] + 1
	}
	declaredLimit := totalReported
	return map[string]any{
		"name":                       "Imported roster",
		"faction_raw_name":           factionRaw,
		"detachment_raw_name":        detachmentRaw,
		"force_disposition_raw_name": forceDispositionRaw,
		"total_reported":             totalReported,
		"declared_limit":             declaredLimit,
		"battle_size_raw":            inferBattleSizeRaw(declaredLimit),
	}, bodyStart, true
}

// finishGwUnit builds the parsed unit plus its `Attached as:` role ("" when
// the unit carries none).
func finishGwUnit(acc *gwUnit) (map[string]any, string) {
	topIndent := 0
	if len(acc.bullets) > 0 {
		topIndent = acc.bullets[0].indent
		for _, b := range acc.bullets {
			if b.indent < topIndent {
				topIndent = b.indent
			}
		}
	}
	wargear := newOrderedCounter()
	modelCount := 0
	isWarlord := false
	isCharacter := acc.section == gwCharactersSection
	var enhancementRawName, enhancementPoints any
	attachedRole := ""

	for i, b := range acc.bullets {
		if b.indent > topIndent {
			if b.count != nil {
				wargear.add(b.text, b.count.(int))
			}
			continue
		}
		if b.count == nil {
			if enh := gwEnhancementAnnot.FindStringSubmatch(b.text); enh != nil {
				if enhancementRawName == nil {
					enhancementRawName = strings.TrimSpace(enh[1])
					n, _ := strconv.Atoi(enh[2])
					enhancementPoints = float64(n)
				}
				continue
			}
			if am := gwAttachedAsBullet.FindStringSubmatch(b.text); am != nil {
				attachedRole = strings.ToLower(am[1])
				if attachedRole != "bodyguard" {
					isCharacter = true
				}
				continue
			}
			for _, tok := range strings.Split(b.text, ",") {
				token := strings.TrimSpace(tok)
				if token == "" {
					continue
				}
				if token == warlordMarker {
					isWarlord = true
				} else if strings.HasSuffix(token, characterSuffix) {
					isCharacter = true
				}
			}
			continue
		}
		var next *lftBulletEntry
		if i+1 < len(acc.bullets) {
			next = &acc.bullets[i+1]
		}
		if next != nil && next.indent > topIndent {
			modelCount += b.count.(int)
		} else {
			wargear.add(b.text, b.count.(int))
		}
	}
	if modelCount == 0 {
		modelCount = 1
	}
	var points any
	if acc.displayedPts != nil {
		if enhancementPoints != nil {
			points = float64(asInt(acc.displayedPts) - asInt(enhancementPoints))
		} else {
			points = acc.displayedPts
		}
	}
	return map[string]any{
		"raw_name":             acc.rawName,
		"is_character":         isCharacter,
		"model_count":          float64(modelCount),
		"points":               points,
		"is_warlord":           isWarlord,
		"enhancement_raw_name": enhancementRawName,
		"enhancement_points":   enhancementPoints,
		"wargear":              wargear.pairs(),
	}, attachedRole
}

var gwAdapter = formatAdapter{
	id: "gw",
	matches: func(decoded any) bool {
		_, ok := isGwText(decoded)
		return ok
	},
	parse: func(decoded any) (map[string]any, error) {
		text, ok := isGwText(decoded)
		if !ok {
			return nil, errors.New("gw: input is not a GW app text export")
		}
		lines := splitLines(text)
		header, bodyStart, ok := gwParseHeader(lines)
		if !ok {
			return nil, errors.New("gw: missing \"+ FACTION KEYWORD:\" header")
		}
		var units []map[string]any
		var current *gwUnit
		section := ""
		alliedUnits := 0
		// Units finished inside an "Attached Unit N" fence, paired once the fence
		// closes (a new `Attached Unit N`, a real section header, or end of input).
		type attachedEntry struct {
			unit map[string]any
			role string
		}
		var attachedGroup []attachedEntry
		resolveAttachedGroup := func() {
			var character, bodyguard *attachedEntry
			for i := range attachedGroup {
				e := &attachedGroup[i]
				if character == nil && (e.role == "leader" || e.role == "support") {
					character = e
				}
				if bodyguard == nil && e.role == "bodyguard" {
					bodyguard = e
				}
			}
			if character != nil && bodyguard != nil {
				character.unit["leader_attachment"] = map[string]any{
					"bodyguard_raw_name": bodyguard.unit["raw_name"],
					"role":               character.role,
					"provisional":        false,
				}
			}
			attachedGroup = nil
		}
		finalize := func() {
			if current != nil {
				unit, role := finishGwUnit(current)
				if role != "" {
					attachedGroup = append(attachedGroup, attachedEntry{unit, role})
				}
				units = append(units, unit)
				current = nil
			}
		}
		for _, raw := range lines[bodyStart:] {
			line := strings.TrimSpace(raw)
			if line == "" || fenceRe.MatchString(line) || headerLineRe.MatchString(line) {
				continue
			}
			if gwAttachedUnitHeader.MatchString(line) {
				finalize()
				resolveAttachedGroup()
				continue
			}
			if bm := gwBulletLine.FindStringSubmatch(raw); bm != nil {
				if current != nil {
					// A hollow `◦` bullet is one level deeper than a `•` at the
					// same indent, so it is a child even without leading whitespace.
					indent := len(bm[1])
					if bm[2] == "◦" {
						indent++
					}
					rest := bm[3]
					var count any
					txt := strings.TrimSpace(rest)
					if nx := gwNxPrefix.FindStringSubmatch(rest); nx != nil {
						n, _ := strconv.Atoi(nx[1])
						count = n
						txt = strings.TrimSpace(nx[2])
					}
					current.bullets = append(current.bullets, lftBulletEntry{indent: indent, count: count, text: txt})
				}
				continue
			}
			// A plain `Nx …` line with no `•` bullet is still that unit's wargear:
			// the GW app bullets only the first wargear entry per unit and emits the
			// rest unbulleted. Feed it through the same top-level-bullet path. A unit
			// header also lacks a bullet but carries a `(N pts)` parenthetical, so it
			// is excluded here and handled just below.
			if current != nil && !gwUnitHeader.MatchString(line) {
				if nx := gwNxPrefix.FindStringSubmatch(line); nx != nil {
					n, _ := strconv.Atoi(nx[1])
					current.bullets = append(current.bullets, lftBulletEntry{indent: 0, count: n, text: strings.TrimSpace(nx[2])})
					continue
				}
			}
			if m := gwUnitHeader.FindStringSubmatch(line); m != nil {
				finalize()
				pts, _ := strconv.Atoi(m[2])
				current = &gwUnit{rawName: strings.TrimSpace(m[1]), displayedPts: float64(pts), section: section}
				if section == gwAlliedSection {
					alliedUnits++
				}
				continue
			}
			if gwSectionHeader.MatchString(line) {
				finalize()
				resolveAttachedGroup()
				section = line
			}
		}
		finalize()
		resolveAttachedGroup()
		totalComputed := 0.0
		for _, u := range units {
			if p, ok := u["points"].(float64); ok {
				totalComputed += p
			}
			if p, ok := u["enhancement_points"].(float64); ok {
				totalComputed += p
			}
		}
		det := []any{}
		if s, ok := header["detachment_raw_name"].(string); ok && s != "" {
			det = []any{s}
		}
		return map[string]any{
			"name":                       header["name"],
			"generated_by":               nil,
			"faction_raw_name":           header["faction_raw_name"],
			"detachment_raw_names":       det,
			"force_disposition_raw_name": header["force_disposition_raw_name"],
			"battle_size_raw":            header["battle_size_raw"],
			"declared_limit":             header["declared_limit"],
			"total_reported":             header["total_reported"],
			"total_computed":             totalComputed,
			"units":                      mapsToAny(units),
			"multi_force":                alliedUnits > 0,
		}, nil
	},
}
