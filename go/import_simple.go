package wh40kdc

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// NewRecruit "simple" markdown-ish text adapter. Go mirror of
// python .../imports/newrecruit_simple.py.

var simpleFirstLine = regexp.MustCompile(`(?i)^(.+)\s-\s\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\]\s*$`)
var simpleRosterHeader = regexp.MustCompile(`(?i)^#\s*\+\+\s*Army Roster\s*\+\+\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\]\s*$`)
var simpleRosterHeaderAnywhere = regexp.MustCompile(`(?m)^#\s*\+\+\s*Army Roster\s*\+\+`)
var simpleSectionHeaderAnywhere = regexp.MustCompile(`(?m)^##\s+`)
var simpleSectionHeader = regexp.MustCompile(`^##\s*(.+?)(?:\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\])?\s*$`)
var simpleUnitLine = regexp.MustCompile(`(?i)^(.+?)\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\](?:\s*:\s*(.*))?$`)
var simpleBullet = regexp.MustCompile(`^\s*•\s*(\d+)x\s+(.+?)(?:\s*\[\s*(\d+)\s*pts?\s*(?:,[^\]]*)?\])?(?:\s*:\s*(.*))?\s*$`)

type simpleUnit struct {
	rawName            string
	isCharacter        bool
	isWarlord          bool
	enhancementRawName any
	enhancementPts     int
	displayedPts       any
	modelCount         int
	wargear            *orderedCounter
}

func simpleApplyTokens(u *simpleUnit, tokensCSV string, multiplier int) {
	cls := classifyWargearList(splitWargearList(tokensCSV))
	if cls.isWarlord {
		u.isWarlord = true
	}
	if cls.isCharacter {
		u.isCharacter = true
	}
	if cls.enhancementRawName != nil && u.enhancementRawName == nil {
		u.enhancementRawName = cls.enhancementRawName
		u.enhancementPts = asInt(cls.enhancementPoints)
	}
	for _, wAny := range cls.wargear {
		w := wAny.(map[string]any)
		u.wargear.add(getStr(w, "raw_name"), asInt(w["count"])*multiplier)
	}
}

func finishSimpleUnit(u *simpleUnit) map[string]any {
	var points any
	if u.displayedPts != nil {
		points = float64(asInt(u.displayedPts) - u.enhancementPts)
	}
	var enhPts any
	if u.enhancementRawName != nil {
		enhPts = float64(u.enhancementPts)
	}
	return map[string]any{
		"raw_name":             u.rawName,
		"is_character":         u.isCharacter,
		"model_count":          float64(u.modelCount),
		"points":               points,
		"is_warlord":           u.isWarlord,
		"enhancement_raw_name": u.enhancementRawName,
		"enhancement_points":   enhPts,
		"wargear":              u.wargear.pairs(),
	}
}

func firstNonBlank(lines []string) (string, bool) {
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			return l, true
		}
	}
	return "", false
}

var newrecruitSimpleAdapter = formatAdapter{
	id: "newrecruit-simple",
	matches: func(decoded any) bool {
		s, ok := decoded.(string)
		if !ok {
			return false
		}
		fnb, ok := firstNonBlank(splitLines(s))
		if !ok {
			return false
		}
		if !simpleFirstLine.MatchString(fnb) {
			return false
		}
		return simpleRosterHeaderAnywhere.MatchString(s) || simpleSectionHeaderAnywhere.MatchString(s)
	},
	parse: parseSimple,
}

func parseSimple(decoded any) (map[string]any, error) {
	text, ok := decoded.(string)
	if !ok {
		return nil, errors.New("newrecruit-simple: input is not a string")
	}
	lines := splitLines(text)
	name := "Imported roster"
	var factionRaw, declaredLimit, totalReported, detachmentRaw, battleSizeRaw any
	var units []map[string]any
	var current *simpleUnit
	multiForce := false
	section := "preamble"
	var enhPts []int

	finalize := func() {
		if current != nil {
			enhPts = append(enhPts, current.enhancementPts)
			units = append(units, finishSimpleUnit(current))
			current = nil
		}
	}

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if section == "preamble" && name == "Imported roster" {
			if m := simpleFirstLine.FindStringSubmatch(line); m != nil {
				dl, _ := strconv.Atoi(m[2])
				parts := splitDashParts(m[1])
				if len(parts) > 0 {
					name = parts[len(parts)-1]
					if len(parts) >= 2 {
						factionRaw = parts[len(parts)-2]
					}
					declaredLimit = float64(dl)
					continue
				}
			}
		}
		if m := simpleRosterHeader.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			totalReported = float64(n)
			continue
		}
		if m := simpleSectionHeader.FindStringSubmatch(line); m != nil {
			finalize()
			heading := strings.ToLower(strings.TrimSpace(m[1]))
			if heading == "configuration" {
				section = "configuration"
			} else {
				section = "units"
				if strings.Contains(heading, "allied") {
					multiForce = true
				}
			}
			continue
		}
		if section == "configuration" {
			if simpleUnitLine.MatchString(line) {
				section = "units"
			} else {
				if idx := strings.Index(line, ":"); idx > 0 {
					key := strings.ToLower(strings.TrimSpace(line[:idx]))
					value := strings.TrimSpace(line[idx+1:])
					if key == "battle size" {
						battleSizeRaw = value
					} else if key == "detachment" {
						detachmentRaw = value
					}
				}
				continue
			}
		}
		if bm := simpleBullet.FindStringSubmatch(raw); bm != nil && current != nil {
			count, _ := strconv.Atoi(bm[1])
			if current.wargear.empty() && current.modelCount == 1 {
				current.modelCount = count
			} else {
				current.modelCount += count
			}
			if bm[4] != "" {
				simpleApplyTokens(current, bm[4], count)
			}
			continue
		}
		if m := simpleUnitLine.FindStringSubmatch(line); m != nil {
			finalize()
			pts, _ := strconv.Atoi(m[2])
			current = &simpleUnit{rawName: strings.TrimSpace(m[1]), displayedPts: float64(pts), modelCount: 1, wargear: newOrderedCounter()}
			if inline := strings.TrimSpace(m[3]); inline != "" {
				simpleApplyTokens(current, inline, 1)
			}
			continue
		}
	}
	finalize()

	totalComputed := 0.0
	for i, u := range units {
		if p, ok := u["points"].(float64); ok {
			totalComputed += p
		}
		if i < len(enhPts) {
			totalComputed += float64(enhPts[i])
		}
	}
	det := []any{}
	if s, ok := detachmentRaw.(string); ok && s != "" {
		det = []any{s}
	}
	return map[string]any{
		"name":                 name,
		"generated_by":         nil,
		"faction_raw_name":     factionRaw,
		"detachment_raw_names": det,
		"battle_size_raw":      battleSizeRaw,
		"declared_limit":       declaredLimit,
		"total_reported":       totalReported,
		"total_computed":       totalComputed,
		"units":                mapsToAny(units),
		"multi_force":          multiForce,
	}, nil
}

func splitDashParts(s string) []string {
	var out []string
	for _, p := range strings.Split(s, " - ") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
