package wh40kdc

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The parse loop of the headerless plain-text adapter (import_gw_headerless.go).
// Mirror of the TS gwHeaderlessAdapter.parse in tools/src/import/gw-headerless.ts.

var (
	// ALL-CAPS headings that open the roster body; other ALL-CAPS lines before
	// the first unit are preamble metadata (faction, detachment).
	gwhBodySection      = regexp.MustCompile(`(?i)^(?:CHARACTERS|BATTLELINE|DEDICATED TRANSPORTS|OTHER DATASHEETS|ALLIED UNITS|FORTIFICATIONS)$`)
	gwhPreambleMetadata = regexp.MustCompile(`^([^:]{1,32}):\s*(.+)$`)
	gwhDetachmentKey    = regexp.MustCompile(`^det(?:a|at)chments?$`)
	gwhDispositionKey   = regexp.MustCompile(`^force dispositions?$`)
	gwhSelectedSuffix   = regexp.MustCompile(`(?i)\s*\(selected\)\.?\s*$`)
	gwhLooseBattleSize  = regexp.MustCompile(`(?i)^(Combat Patrol|Incursion|Strike Force|Onslaught)\b`)
	gwhDetachmentPoints = regexp.MustCompile(`(?i)\bDetachment Points?\b`)
	gwhURL              = regexp.MustCompile(`(?i)https?://`)
)

// gwhPreamble collects the metadata lines between the title and the first body
// section or unit, and classifies them once that body opens.
type gwhPreamble struct {
	open             bool
	lines            []string
	factionRawName   any
	detachments      []any
	forceDisposition any
}

func (p *gwhPreamble) hasDispositionLine() bool {
	for _, line := range p.lines {
		if gwhForceDispositionNames[strings.ToLower(line)] {
			return true
		}
	}
	return false
}

// close classifies the collected lines: a force-disposition line, then the
// faction (skipping a super-faction breadcrumb when more lines follow), then
// every remaining line as a detachment with its `(N Detachment Points)` cost
// stripped. Values already set from `key: value` metadata are kept.
func (p *gwhPreamble) close() {
	if !p.open {
		return
	}
	p.open = false
	parts := append([]string{}, p.lines...)
	for i, part := range parts {
		if gwhForceDispositionNames[strings.ToLower(part)] {
			if p.forceDisposition == nil {
				p.forceDisposition = part
			}
			parts = append(parts[:i], parts[i+1:]...)
			break
		}
	}
	if p.factionRawName == nil && len(parts) > 0 {
		faction := parts[0]
		parts = parts[1:]
		if len(parts) > 1 && gwhGenericFactionBreadcrumbs[strings.ToLower(faction)] {
			faction = parts[0]
			parts = parts[1:]
		}
		p.factionRawName = faction
	}
	if len(p.detachments) == 0 {
		for _, part := range parts {
			// Preserve logical preamble lines separately: the resolver has the
			// dataset needed to tell detachment metadata from event comments.
			if name := gwhDetachmentPtsSuffix.ReplaceAllString(part, ""); name != "" {
				p.detachments = append(p.detachments, name)
			}
		}
	}
}

// metadata applies a preamble `key: value` line (`Faction: Orks`, `Battle
// size: Strike Force (2000 points)`), reporting whether it was consumed.
func (s *gwhParseState) metadata(line string) bool {
	m := gwhPreambleMetadata.FindStringSubmatch(line)
	if m == nil {
		return false
	}
	key := strings.ToLower(strings.TrimSpace(m[1]))
	value := strings.TrimSpace(m[2])
	switch {
	case key == "player" || key == "team":
		return true
	case key == "list name":
		s.name = value
	case key == "faction" || key == "factions" || key == "faction keyword":
		s.pre.factionRawName = value
	case gwhDetachmentKey.MatchString(key):
		s.pre.detachments = append(s.pre.detachments, gwhDetachmentPtsSuffix.ReplaceAllString(value, ""))
	case gwhDispositionKey.MatchString(key):
		first := strings.Split(gwhSelectedSuffix.ReplaceAllString(value, ""), ",")[0]
		s.pre.forceDisposition = strings.TrimSpace(first)
	case key == "battle size":
		s.battleSizeRaw = value
		if pts := gwhPtsLine.FindStringSubmatch(value); pts != nil {
			s.declaredLimit = gwhParsePts(pts[2])
		}
	default:
		return false
	}
	s.consumedTitle = true
	return true
}

type gwhParseState struct {
	name          string
	declaredLimit any
	totalReported any
	battleSizeRaw any
	consumedTitle bool
	pre           gwhPreamble
}

var gwHeaderlessAdapter = formatAdapter{
	// Provenance: a GW-family plain-text export. Reuses the `gw` id so no schema
	// churn is needed for a new label (mirrors the TS/Rust adapters).
	id: "gw",
	matches: func(decoded any) bool {
		_, ok := gwhHeaderlessText(decoded)
		return ok
	},
	parse: func(decoded any) (map[string]any, error) {
		text, ok := gwhHeaderlessText(decoded)
		if !ok {
			return nil, errors.New("gw-headerless: not a headerless plain-text list")
		}
		summaryWarlord := ""
		if m := gwhBcpWarlord.FindStringSubmatch(decoded.(string)); m != nil {
			summaryWarlord = strings.TrimSpace(m[1])
		}

		st := &gwhParseState{name: "Imported roster", pre: gwhPreamble{open: true, detachments: []any{}}}
		var units []map[string]any
		var current *gwhUnit
		section := ""
		haveSection := false
		allied := 0
		var attachmentMembers []attachedGroupMember
		attachmentGroup := 0
		pendingSupport := false
		flush := func() {
			if current != nil {
				if current.attachmentGroup != 0 && current.attachmentRole != "" {
					attachmentMembers = append(attachmentMembers, attachedGroupMember{
						unitIndex: len(units), group: current.attachmentGroup, role: current.attachmentRole,
					})
				}
				units = append(units, finishGwhUnit(current))
				current = nil
			}
		}
		// beforeBody: no unit has opened yet and the preamble is still open.
		beforeBody := func() bool { return st.pre.open && current == nil && len(units) == 0 }

		for _, rawLine := range gwhExpandDenseLines(text) {
			raw := strings.TrimRight(rawLine, "\r")
			line := strings.TrimSpace(raw)
			if line == "" {
				continue
			}

			// Bullets attach to the open unit.
			if bm := gwhBulletLine.FindStringSubmatch(raw); bm != nil {
				if current != nil {
					// A hollow `◦` is one level deeper than a `•` at the same indent.
					markerDepth := 0
					if bm[2] == "◦" {
						markerDepth = 1
					}
					bullet := gwhParseBullet(utf8.RuneCountInString(bm[1])+markerDepth, bm[3], true)
					if current.attachmentRole == "" {
						current.attachmentRole = bullet.attachmentRole
					}
					current.bullets = append(current.bullets, bullet)
				}
				continue
			}

			// GW export footer.
			if strings.HasPrefix(line, "Exported with") {
				continue
			}

			if beforeBody() && st.metadata(line) {
				continue
			}
			// A battle-size line in the preamble (`Strike Force (2,000 Points)`
			// or a bare `Strike Force`). It closes the preamble once a force
			// disposition has been seen, since the app prints it last.
			if beforeBody() && gwhLooseBattleSize.MatchString(line) {
				st.battleSizeRaw = line
				st.declaredLimit = gwhParsePts(line)
				if st.pre.forceDisposition != nil || st.pre.hasDispositionLine() {
					st.pre.close()
				}
				continue
			}

			// The GW app bullets only the first wargear line under a model and
			// emits the rest unbulleted, one indent deeper. Capture those `Nx …`
			// continuation lines as the open unit's wargear at their real indent.
			// A unit header also lacks a bullet but carries a `(N pts)`
			// parenthetical, so it is excluded here and handled below.
			if current != nil && gwhNxPrefix.MatchString(line) && !gwhPtsLine.MatchString(line) {
				current.bullets = append(current.bullets, gwhParseBullet(gwhIndent(raw), line, false))
				continue
			}

			// `## Section` markdown header (strip an optional `(N pts)` tail).
			if md := gwhMdSection.FindStringSubmatch(line); md != nil {
				st.pre.close()
				flush()
				if pts := gwhPtsLine.FindStringSubmatch(md[1]); pts != nil {
					section = strings.TrimSpace(pts[1])
				} else {
					section = strings.TrimSpace(md[1])
				}
				haveSection = true
				continue
			}

			// A bare points line is the roster total when no title was
			// supplied. It is metadata, never a unit or faction token.
			if bare := gwhBarePointsLine.FindStringSubmatch(line); bare != nil {
				if st.totalReported == nil {
					st.totalReported = gwhParsePts(bare[1])
				}
				st.consumedTitle = true
				continue
			}

			if pts := gwhPtsLine.FindStringSubmatch(line); pts != nil {
				headerName := strings.TrimSpace(pts[1])
				points := gwhParsePts(pts[2])
				// Battle-size metadata may appear before or after the
				// detachment and disposition; it does not close the preamble.
				if gwhIsBattleSize(headerName) {
					st.battleSizeRaw = line
					if points != nil {
						st.declaredLimit = points
					}
					continue
				}
				if current == nil && len(units) == 0 && gwhDetachmentPoints.MatchString(line) {
					st.pre.lines = append(st.pre.lines, line)
					continue
				}
				// First `Name (N pts|Points)` line is the roster title, not a
				// unit. Its number is the army total; a battle-size line is the
				// limit.
				if !st.consumedTitle && current == nil && len(units) == 0 {
					st.consumedTitle = true
					st.name = headerName
					st.totalReported = points
					continue
				}
				// Some event exports prepend participant/team lines without a
				// fence; the real high-point roster title arrives afterwards. No
				// unit costs 1,000+ points, so this stays unambiguous.
				if pointValue, isNum := points.(float64); st.declaredLimit == nil && current == nil &&
					len(units) == 0 && isNum && pointValue >= 1000 {
					st.name = headerName
					st.totalReported = points
					if n := len(st.pre.lines); n >= 2 {
						st.pre.lines = st.pre.lines[n-1:]
					} else {
						st.pre.lines = nil
					}
					continue
				}
				// A real unit header.
				st.pre.close()
				flush()
				if haveSection && section == gwAlliedSection {
					allied++
				}
				current = &gwhUnit{
					rawName:            headerName,
					displayedPts:       points,
					isCharacterSection: haveSection && strings.EqualFold(section, gwCharactersSection),
					attachmentGroup:    attachmentGroup,
				}
				if pendingSupport {
					current.attachmentRole = "support"
				}
				pendingSupport = false
				continue
			}

			if group, ok := attachedUnitNumber(line); ok {
				st.pre.close()
				flush()
				section = "ATTACHED UNITS"
				haveSection = true
				attachmentGroup = group
				continue
			}

			if attachedAsSupportRe.MatchString(line) {
				st.pre.close()
				flush()
				pendingSupport = true
				continue
			}

			// `Attached Units` is a body section even when it isn't uppercased.
			if attachedSectionRe.MatchString(line) {
				st.pre.close()
				flush()
				section = "ATTACHED UNITS"
				haveSection = true
				attachmentGroup = 0
				continue
			}

			// An ALL-CAPS line before the body that is not a role heading is
			// preamble metadata (an upper-cased faction or detachment).
			if beforeBody() && gwhCapsSection.MatchString(line) && !gwhBodySection.MatchString(line) {
				st.pre.lines = append(st.pre.lines, line)
				continue
			}
			// Section headers without points (ALL-CAPS role, `Title:` colon).
			if gwhCapsSection.MatchString(line) || gwhColonSection.MatchString(line) {
				st.pre.close()
				flush()
				section = strings.TrimSpace(strings.TrimRight(line, ":"))
				haveSection = true
				attachmentGroup = 0
				continue
			}

			// Anything else before the body is title/preamble metadata. A URL
			// on a leading note line is event commentary, not a roster name.
			if st.pre.open && gwhURL.MatchString(line) {
				continue
			}
			if !st.consumedTitle && current == nil && len(units) == 0 {
				st.consumedTitle = true
				st.name = line
			} else if beforeBody() {
				st.pre.lines = append(st.pre.lines, line)
			}
		}
		st.pre.close()
		flush()
		pairAttachedGroups(units, attachmentMembers)
		gwhApplySummaryWarlord(units, summaryWarlord)

		totalComputed := 0.0
		for _, u := range units {
			if p, ok := u["points"].(float64); ok {
				totalComputed += p
			}
			if p, ok := u["enhancement_points"].(float64); ok {
				totalComputed += p
			}
		}
		effectiveLimit := st.declaredLimit
		if effectiveLimit == nil {
			effectiveLimit = st.totalReported
		}
		battleSizeRaw := st.battleSizeRaw
		if battleSizeRaw == nil {
			battleSizeRaw = inferBattleSizeRaw(effectiveLimit)
		}

		return map[string]any{
			"name":                       st.name,
			"generated_by":               nil,
			"faction_raw_name":           st.pre.factionRawName,
			"detachment_raw_names":       st.pre.detachments,
			"battle_size_raw":            battleSizeRaw,
			"force_disposition_raw_name": st.pre.forceDisposition,
			"declared_limit":             effectiveLimit,
			"total_reported":             st.totalReported,
			"total_computed":             totalComputed,
			"units":                      mapsToAny(units),
			"multi_force":                allied > 0,
		}, nil
	},
}

// gwhApplySummaryWarlord makes the one unit whose name starts with the BCP
// summary's `WARLORD:` value the warlord, clearing the flag elsewhere. An
// absent, unmatched, or ambiguous value leaves the units unchanged.
func gwhApplySummaryWarlord(units []map[string]any, warlord string) {
	if warlord == "" {
		return
	}
	key := strings.ToLower(warlord)
	match := -1
	for i, u := range units {
		if strings.HasPrefix(strings.ToLower(getStr(u, "raw_name")), key) {
			if match >= 0 {
				return
			}
			match = i
		}
	}
	if match < 0 {
		return
	}
	for _, u := range units {
		u["is_warlord"] = false
	}
	units[match]["is_warlord"] = true
}
