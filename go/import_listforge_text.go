package wh40kdc

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// ListForge plain-text adapter. Go mirror of python .../imports/listforge_text.py.

var lftFirstLine = regexp.MustCompile(`(?i)^(.+)\s\(\s*(\d+)\s*Points?\s*\)\s*$`)
var lftSectionHeader = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 /&'-]*:$`)
var lftUnitHeader = regexp.MustCompile(`(?i)^(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*$`)
var lftBulletLine = regexp.MustCompile(`^(\s*)•\s*(.+?)\s*$`)
var lftNxPrefix = regexp.MustCompile(`^(\d+)x\s+(.+)$`)
var lftBullet = regexp.MustCompile(`(?m)^[\t ]*•`)
var lftWithLine = regexp.MustCompile(`(?m)^[\t ]*\d+\s+with\b`)

const enhancementPrefix = "E: "

var characterSections = map[string]bool{"epic hero": true, "character": true}

type lftBulletEntry struct {
	indent int
	count  any // int or nil
	text   string
}

type lftUnit struct {
	rawName      string
	displayedPts any
	isCharacter  bool
	bullets      []lftBulletEntry
}

func isListforgeText(decoded any) (string, bool) {
	s, ok := decoded.(string)
	if !ok {
		return "", false
	}
	fnb, ok := firstNonBlank(splitLines(s))
	if !ok {
		return "", false
	}
	first := lftFirstLine.FindStringSubmatch(strings.TrimSpace(fnb))
	if first == nil || len(strings.Split(first[1], " - ")) < 3 {
		return "", false
	}
	if !lftBullet.MatchString(s) {
		return "", false
	}
	if lftWithLine.MatchString(s) {
		return "", false
	}
	return s, true
}

func lftParseFirstLine(line string) map[string]any {
	m := lftFirstLine.FindStringSubmatch(strings.TrimSpace(line))
	if m == nil {
		return nil
	}
	parts := splitDashParts(m[1])
	if len(parts) < 3 {
		return nil
	}
	n, _ := strconv.Atoi(m[2])
	return map[string]any{
		"name":                strings.Join(parts[:len(parts)-2], " - "),
		"faction_raw_name":    parts[len(parts)-2],
		"detachment_raw_name": parts[len(parts)-1],
		"total_reported":      float64(n),
	}
}

func finishLftUnit(acc *lftUnit) map[string]any {
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
	var enhancementRawName any

	for i, b := range acc.bullets {
		if b.indent > topIndent {
			c := 1
			if b.count != nil {
				c = b.count.(int)
			}
			wargear.add(b.text, c)
			continue
		}
		if b.count == nil {
			if b.text == warlordMarker {
				isWarlord = true
				continue
			}
			if strings.HasPrefix(b.text, enhancementPrefix) {
				if enhancementRawName == nil {
					enhancementRawName = strings.TrimSpace(b.text[len(enhancementPrefix):])
				}
				continue
			}
		}
		var next *lftBulletEntry
		if i+1 < len(acc.bullets) {
			next = &acc.bullets[i+1]
		}
		if next != nil && next.indent > b.indent {
			c := 1
			if b.count != nil {
				c = b.count.(int)
			}
			modelCount += c
		} else {
			c := 1
			if b.count != nil {
				c = b.count.(int)
			}
			wargear.add(b.text, c)
		}
	}
	if modelCount == 0 {
		modelCount = 1
	}
	return map[string]any{
		"raw_name":             acc.rawName,
		"is_character":         acc.isCharacter,
		"model_count":          float64(modelCount),
		"points":               acc.displayedPts,
		"is_warlord":           isWarlord,
		"enhancement_raw_name": enhancementRawName,
		"enhancement_points":   nil,
		"wargear":              wargear.pairs(),
	}
}

var listforgeTextAdapter = formatAdapter{
	id: "listforge-text",
	matches: func(decoded any) bool {
		_, ok := isListforgeText(decoded)
		return ok
	},
	parse: func(decoded any) (map[string]any, error) {
		text, ok := isListforgeText(decoded)
		if !ok {
			return nil, errors.New("listforge-text: input is not a ListForge text export")
		}
		lines := splitLines(text)
		var header map[string]any
		var units []map[string]any
		var current *lftUnit
		sectionIsCharacter := false
		finalize := func() {
			if current != nil {
				units = append(units, finishLftUnit(current))
				current = nil
			}
		}
		for _, raw := range lines {
			line := strings.TrimSpace(raw)
			if line == "" {
				continue
			}
			if header == nil {
				header = lftParseFirstLine(line)
				if header != nil {
					continue
				}
			}
			if bm := lftBulletLine.FindStringSubmatch(raw); bm != nil {
				if current != nil {
					rest := bm[2]
					var count any
					text := strings.TrimSpace(rest)
					if nx := lftNxPrefix.FindStringSubmatch(rest); nx != nil {
						n, _ := strconv.Atoi(nx[1])
						count = n
						text = strings.TrimSpace(nx[2])
					}
					current.bullets = append(current.bullets, lftBulletEntry{indent: len(bm[1]), count: count, text: text})
				}
				continue
			}
			if lftSectionHeader.MatchString(line) {
				finalize()
				sectionIsCharacter = characterSections[strings.ToLower(strings.TrimSpace(line[:len(line)-1]))]
				continue
			}
			if m := lftUnitHeader.FindStringSubmatch(line); m != nil {
				finalize()
				pts, _ := strconv.Atoi(m[2])
				current = &lftUnit{rawName: strings.TrimSpace(m[1]), displayedPts: float64(pts), isCharacter: sectionIsCharacter}
			}
		}
		finalize()
		if header == nil {
			return nil, errors.New("listforge-text: missing ListForge header line")
		}
		totalComputed := 0.0
		for _, u := range units {
			if p, ok := u["points"].(float64); ok {
				totalComputed += p
			}
		}
		declaredLimit := header["total_reported"]
		det := []any{}
		if s, ok := header["detachment_raw_name"].(string); ok && s != "" {
			det = []any{s}
		}
		return map[string]any{
			"name":                 header["name"],
			"generated_by":         "List Forge",
			"faction_raw_name":     header["faction_raw_name"],
			"detachment_raw_names": det,
			"battle_size_raw":      inferBattleSizeRaw(declaredLimit),
			"declared_limit":       declaredLimit,
			"total_reported":       header["total_reported"],
			"total_computed":       totalComputed,
			"units":                mapsToAny(units),
			"multi_force":          false,
		}, nil
	},
}
