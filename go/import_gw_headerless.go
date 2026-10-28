package wh40kdc

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// Headerless plain-text adapter: the GW 40K app's *exported* list (no
// `++…++` / `+ FACTION KEYWORD:` summary fence), the NewRecruit "copy as text"
// dialect, and the markdown-ish `## Section (N pts)` shape hand-authored lists
// use. All three share one body grammar; they differ only in cosmetic framing,
// so a single lenient parser covers them. Go mirror of TS
// tools/src/import/gw-headerless.ts (authoritative) and Rust
// crates/wh40kdc/src/import/gw_headerless.rs; unlike the Rust mirror this port
// also strips the BCP summary block (see gwhStripBcpSummary).

// Title / unit header: `Name (N pts|Points)` with an optional trailing comment
// (the GW export sometimes appends TO notes). Points may carry thousands commas.
var gwhPtsLine = regexp.MustCompile(`(?i)^(.+?)\s*\(\s*([\d,]+)\s*(?:pts?|points?)\s*\).*$`)

// `## Section [ (N pts) ]` markdown header.
var gwhMdSection = regexp.MustCompile(`^#{1,6}\s*(.+?)\s*$`)

// ALL-CAPS role section (`CHARACTERS`, `OTHER DATASHEETS`, …).
var gwhCapsSection = regexp.MustCompile(`^[A-Z][A-Z0-9 \-/&]+$`)

// `Title:` colon section (`Epic Hero:`, `Battleline:`).
var gwhColonSection = regexp.MustCompile(`^([A-Za-z][\w /&-]*):\s*$`)

// Bullet line: leading indent, a `•` or `◦` marker, then the body.
var gwhBulletLine = regexp.MustCompile(`^([\t ]*)[•◦]\s*(.+?)\s*$`)

var gwhNxPrefix = regexp.MustCompile(`(?i)^(\d+)x\s+(.+)$`)

// Inline enhancement annotation: `Name (+N pts)`.
var gwhEnhAnnot = regexp.MustCompile(`(?i)^(.+?)\s*\(\+\s*(\d+)\s*pts?\s*\)\s*$`)

// `Enhancements: X` / `E: X` enhancement bullet.
var gwhEnhLabel = regexp.MustCompile(`(?i)^(?:e|enh|enhancement|enhancements)\s*:\s*(.+)$`)

// Attachment relationship annotations emitted by GW-family exports.
var gwhAttachment = regexp.MustCompile(`(?i)^(attached\s+as|leader|leading)\s*:\s*(.+)$`)

// `(Character)` inside an attachment role.
var gwhCharacterRole = regexp.MustCompile(`(?i)\(\s*Character\s*\)`)
var gwhCharacterAnnotation = regexp.MustCompile(`(?i)^(?:.+\s+keywords?\s*:\s*character|subterranean\s+assault\s+character)$`)
var gwhKeywordAnnotation = regexp.MustCompile(`(?i)^(?:40kdc\s+)?(?:detachment\s+)?keywords?\s*:\s*(.+)$`)

var gwhBulletAnywhere = regexp.MustCompile(`(?m)^[\t ]*[•◦]`)
var gwhDetachmentPtsSuffix = regexp.MustCompile(`(?i)\s*\(\s*\d*\s*(?:Detachment Points?|Detachementpoints?|DP|PD)\s*\)\s*$`)

// gwhHeaderlessText accepts bullet-bearing plain text that no framed adapter
// claims, returning the BCP-stripped body.
func gwhHeaderlessText(decoded any) (string, bool) {
	s, ok := decoded.(string)
	if !ok {
		return "", false
	}
	text := gwhStripBcpSummary(s)
	if !gwhBulletAnywhere.MatchString(text) {
		return "", false // need a bullet
	}
	if strings.Contains(text, gwFactionKeywordPrefix) && !gwEmbeddedAppBattleSize.MatchString(text) {
		return "", false // framed GW → gwAdapter
	}
	if gwWithLine.MatchString(text) {
		return "", false // WTC-full
	}
	lines := splitLines(text)
	// ListForge-text's `name - faction - detachment (N Points)` header → defer to
	// listforgeTextAdapter (registered ahead of us). Mirrors its own matcher so
	// the two stay disjoint.
	if fnb, ok := firstNonBlank(lines); ok {
		if m := lftFirstLine.FindStringSubmatch(strings.TrimSpace(fnb)); m != nil {
			if len(strings.Split(m[1], " - ")) >= 3 {
				return "", false
			}
		}
	}
	// NewRecruit `# ++ Army Roster ++` → newrecruitSimpleAdapter.
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if strings.HasPrefix(t, "# ++") && strings.Contains(t, "Army Roster") {
			return "", false
		}
	}
	// Require a `Name (N pts|Points)` line somewhere — the unit/title signature.
	for _, l := range lines {
		if gwhPtsLine.MatchString(strings.TrimSpace(l)) {
			return text, true
		}
	}
	return "", false
}

type gwhBullet struct {
	indent int
	count  any // int or nil
	// name is the model/wargear name (after any `Nx` and before any `: wargear`).
	name string
	// colonWargear is the comma-separated wargear listed after a `:` on a model
	// bullet (string, or nil when absent).
	colonWargear any
	// isAnnotation is true for `Warlord` / `… Character` / `Enhancements:` /
	// `Attached as:` annotations.
	isAnnotation bool
	// hasEnhancement/enhName/enhPoints capture `[name, points]` when this bullet
	// declares an enhancement.
	hasEnhancement bool
	enhName        string
	enhPoints      any // int or nil
	// bulleted is true when the source line carried a `•`/`◦` marker; false for
	// the GW app's unbulleted continuation wargear lines. Model detection keys on
	// this: a model is an entry followed by a *deeper bulleted* line.
	bulleted bool
	// isAttachment is true for an `Attached as: …` v2.0.5 annotation — never a
	// model or wargear, even though it sits (bulleted) shallower than the models.
	isAttachment bool
	// setsCharacter: an `Attached as: … (Character)` annotation flags the unit.
	setsCharacter bool
	// attachmentRole is the role named by an `Attached as: …` annotation
	// ("leader", "support", "bodyguard"), or "".
	attachmentRole string
	// keywordOverride is an explicitly selected/granted keyword annotation.
	keywordOverride any
}

type gwhUnit struct {
	rawName            string
	displayedPts       any // float64 or nil
	isCharacterSection bool
	bullets            []gwhBullet
	// attachmentGroup is the `Attached Unit N` group number, or 0 outside one.
	attachmentGroup int
	// attachmentRole is the unit's role in that group (first `Attached as:`
	// bullet, or a preceding `Attached as Support:` line).
	attachmentRole string
}

func gwhParseBullet(indent int, body string, bulleted bool) gwhBullet {
	// Attachment relationship metadata is never a model or wargear. Catch it
	// before the generic colon split: otherwise `Leader: Character Name`
	// becomes an inline model and inflates the bodyguard's model count by one.
	if m := gwhAttachment.FindStringSubmatch(body); m != nil {
		isAttachedAs := strings.EqualFold(strings.Join(strings.Fields(m[1]), " "), "attached as")
		attachedRole := ""
		if isAttachedAs {
			attachedRole = attachedAsRole(m[2])
		}
		return gwhBullet{
			indent:       indent,
			count:        nil,
			colonWargear: nil,
			isAnnotation: true,
			bulleted:     bulleted,
			isAttachment: true,
			setsCharacter: isAttachedAs &&
				gwhCharacterRole.MatchString(m[2]),
			attachmentRole: attachedRole,
		}
	}

	if gwhCharacterAnnotation.MatchString(strings.TrimSpace(body)) {
		return gwhBullet{
			indent: indent, count: nil, colonWargear: nil, isAnnotation: true,
			bulleted: bulleted, setsCharacter: true, keywordOverride: "Character",
		}
	}

	// Enhancement label first — `Enhancements: X` must not read as a model.
	if m := gwhEnhLabel.FindStringSubmatch(body); m != nil {
		return gwhBullet{
			indent:         indent,
			count:          nil,
			colonWargear:   nil,
			isAnnotation:   true,
			hasEnhancement: true,
			enhName:        strings.TrimSpace(m[1]),
			enhPoints:      nil,
			bulleted:       bulleted,
		}
	}

	var count any
	rest := strings.TrimSpace(body)
	if nx := gwhNxPrefix.FindStringSubmatch(body); nx != nil {
		n, _ := strconv.Atoi(nx[1])
		count = n
		rest = strings.TrimSpace(nx[2])
	}

	// `Name (+N pts)` enhancement annotation.
	if m := gwhEnhAnnot.FindStringSubmatch(rest); m != nil {
		var pts any
		if n, err := strconv.Atoi(m[2]); err == nil {
			pts = n
		}
		return gwhBullet{
			indent:         indent,
			count:          count,
			name:           rest,
			colonWargear:   nil,
			isAnnotation:   true,
			hasEnhancement: true,
			enhName:        strings.TrimSpace(m[1]),
			enhPoints:      pts,
			bulleted:       bulleted,
		}
	}

	if m := gwhKeywordAnnotation.FindStringSubmatch(rest); m != nil {
		keyword := strings.TrimSpace(m[1])
		return gwhBullet{
			indent: indent, count: nil, colonWargear: nil, isAnnotation: true,
			bulleted: bulleted, setsCharacter: strings.EqualFold(keyword, "Character"),
			keywordOverride: keyword,
		}
	}
	// `ModelType: w1, w2` — a model bullet with inline wargear.
	if idx := strings.Index(rest, ":"); idx >= 0 {
		wargear := strings.TrimSpace(rest[idx+1:])
		var cw any
		if wargear != "" {
			cw = wargear
		}
		return gwhBullet{
			indent:       indent,
			count:        count,
			name:         strings.TrimSpace(rest[:idx]),
			colonWargear: cw,
			isAnnotation: false,
			bulleted:     bulleted,
		}
	}

	// Bare token: annotation iff it has no count (Warlord / Character / wargear).
	return gwhBullet{
		indent:       indent,
		count:        count,
		name:         rest,
		colonWargear: nil,
		isAnnotation: count == nil,
		bulleted:     bulleted,
	}
}

func gwhBulletCount(b gwhBullet) int {
	if b.count == nil {
		return 1
	}
	return b.count.(int)
}

func finishGwhUnit(acc *gwhUnit) map[string]any {
	// Models live at the shallowest *bulleted* indent that isn't an attachment,
	// enhancement, or colon-wargear line. The GW v2.0.5 export prefixes each unit
	// with an `Attached as:` bullet shallower than the models, so a plain
	// "min of all indents" would misplace the model level — filter those out.
	modelIndent := 0
	haveModelIndent := false
	for _, b := range acc.bullets {
		if b.bulleted && !b.isAttachment && !b.hasEnhancement && !b.setsCharacter && b.name != warlordMarker && b.colonWargear == nil {
			if !haveModelIndent || b.indent < modelIndent {
				modelIndent = b.indent
				haveModelIndent = true
			}
		}
	}

	// A model group: a bulleted entry at the model indent followed by a *deeper
	// bulleted* line (its squad-wide wargear). Keying on the child being bulleted
	// keeps a lone bulleted weapon trailed by plain continuation lines (Fire
	// Prism's Prism cannon) as wargear, not a model.
	isModelGroup := func(b gwhBullet, next *gwhBullet) bool {
		return b.bulleted &&
			b.colonWargear == nil &&
			!b.hasEnhancement &&
			!b.isAttachment &&
			!b.setsCharacter &&
			b.name != warlordMarker &&
			b.indent == modelIndent &&
			next != nil &&
			next.bulleted &&
			next.indent > b.indent
	}

	wargear := newOrderedCounter()
	modelCount := 0
	isWarlord := false
	isCharacter := acc.isCharacterSection
	var enhancementRawName, enhancementPoints any
	keywordOverrides := []string{}
	// Per-model groups as the source lists them; kept only if exact.
	var candidateGroups []gwhLoadoutGroup

	for i := range acc.bullets {
		b := acc.bullets[i]
		if keyword, ok := b.keywordOverride.(string); ok && keyword != "" {
			keywordOverrides = append(keywordOverrides, keyword)
		}

		// `Attached as: …` carries no model or gear; a `(Character)` role flags
		// the unit. Skip before model detection.
		if b.isAttachment {
			if b.setsCharacter {
				isCharacter = true
			}
			continue
		}

		// Enhancement annotation (`Enhancements: X` or `X (+N pts)`).
		if b.hasEnhancement {
			if enhancementRawName == nil {
				enhancementRawName = b.enhName
				if b.enhPoints != nil {
					enhancementPoints = float64(b.enhPoints.(int))
				}
			}
			continue
		}

		// Model with inline `: wargear` (the `##`/fixture dialect).
		if b.colonWargear != nil {
			n := gwhBulletCount(b)
			modelCount += n
			group := gwhLoadoutGroup{modelName: b.name, count: n, wargear: newOrderedCounter()}
			for _, item := range strings.Split(b.colonWargear.(string), ",") {
				if s := strings.TrimSpace(item); s != "" {
					wargear.add(s, n)
					group.wargear.add(s, 1)
				}
			}
			candidateGroups = append(candidateGroups, group)
			continue
		}

		// Model group: counted bullet at the model indent with a deeper bulleted child.
		var next *gwhBullet
		if i+1 < len(acc.bullets) {
			next = &acc.bullets[i+1]
		}
		if isModelGroup(b, next) {
			n := gwhBulletCount(b)
			modelCount += n
			if group, ok := gwhModelGroupLoadout(acc.bullets, i, n); ok {
				candidateGroups = append(candidateGroups, group)
			}
			continue
		}

		if b.isAnnotation {
			if b.setsCharacter {
				isCharacter = true
				continue
			}
			var leftover []string
			for _, tok := range strings.Split(b.name, ",") {
				token := strings.TrimSpace(tok)
				if token == "" {
					continue
				}
				if token == warlordMarker {
					isWarlord = true
				} else if strings.HasSuffix(token, characterSuffix) {
					isCharacter = true
				} else {
					leftover = append(leftover, token)
				}
			}
			for _, token := range leftover {
				wargear.add(token, 1)
			}
			continue
		}

		// Everything else is wargear — a bulleted weapon under a model or an
		// unbulleted continuation line, at any depth.
		if name := strings.TrimSpace(b.name); name != "" {
			wargear.add(name, gwhBulletCount(b))
		}
	}

	if modelCount == 0 {
		modelCount = 1
	}

	var points any
	if acc.displayedPts != nil {
		if enhancementPoints != nil {
			net := asInt(acc.displayedPts) - asInt(enhancementPoints)
			if net < 0 {
				net = 0
			}
			points = float64(net)
		} else {
			points = acc.displayedPts
		}
	}

	result := map[string]any{
		"raw_name":             acc.rawName,
		"is_character":         isCharacter,
		"model_count":          float64(modelCount),
		"points":               points,
		"is_warlord":           isWarlord,
		"enhancement_raw_name": enhancementRawName,
		"enhancement_points":   enhancementPoints,
		"wargear":              wargear.pairs(),
	}
	if len(keywordOverrides) > 0 {
		result["keyword_overrides"] = strSliceToAny(keywordOverrides)
	}
	if groups, ok := gwhExactLoadoutGroups(candidateGroups, modelCount, wargear); ok {
		result["loadout_groups"] = groups
	}
	return result
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

		name := "Imported roster"
		var declaredLimit any
		// totalReported is the army total printed on the roster title line.
		var totalReported any
		var battleSizeRaw any
		var units []map[string]any
		var current *gwhUnit
		section := ""
		haveSection := false
		allied := 0
		consumedTitle := false
		// The GW app export lists faction then detachment as bare lines between
		// the title and the first section. Capture the first two so resolve can
		// scope to them; later bare lines are ignored.
		var factionRawName any
		detachmentRawNames := []any{}

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

		for _, rawLine := range strings.Split(text, "\n") {
			raw := strings.TrimRight(rawLine, "\r")
			line := strings.TrimSpace(raw)
			if line == "" {
				continue
			}

			// Bullets attach to the open unit.
			if bm := gwhBulletLine.FindStringSubmatch(raw); bm != nil {
				if current != nil {
					bullet := gwhParseBullet(len(bm[1]), bm[2], true)
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

			// The GW app bullets only the first wargear line under a model and
			// emits the rest unbulleted, one indent deeper. Capture those `Nx …`
			// continuation lines as the open unit's wargear at their real indent.
			// A unit header also lacks a bullet but carries a `(N pts)`
			// parenthetical, so it is excluded here and handled just below.
			if current != nil && gwhNxPrefix.MatchString(line) && !gwhPtsLine.MatchString(line) {
				current.bullets = append(current.bullets, gwhParseBullet(gwhIndent(raw), line, false))
				continue
			}

			// `## Section` markdown header (strip an optional `(N pts)` tail).
			if md := gwhMdSection.FindStringSubmatch(line); md != nil {
				flush()
				if pts := gwhPtsLine.FindStringSubmatch(md[1]); pts != nil {
					section = strings.TrimSpace(pts[1])
				} else {
					section = strings.TrimSpace(md[1])
				}
				haveSection = true
				continue
			}

			// First `Name (N pts|Points)` line is the roster title, not a unit.
			if pts := gwhPtsLine.FindStringSubmatch(line); pts != nil {
				headerName := strings.TrimSpace(pts[1])
				points := gwhParsePts(pts[2])
				if !consumedTitle && current == nil && len(units) == 0 {
					consumedTitle = true
					name = headerName
					declaredLimit = points
					totalReported = points
					continue
				}
				// Some event exports prepend participant/team/faction lines
				// without a fence. Recover their actual high-point roster title
				// instead of emitting it as a phantom unit.
				pointValue, hasPoints := points.(float64)
				if declaredLimit == nil && current == nil && len(units) == 0 &&
					len(detachmentRawNames) == 1 && hasPoints && pointValue >= 1000 {
					name = headerName
					declaredLimit = points
					totalReported = points
					factionRawName = detachmentRawNames[0]
					detachmentRawNames = detachmentRawNames[:0]
					continue
				}
				// Battle-size metadata (`Strike Force (2,000 Points)`).
				if gwhIsBattleSize(headerName) {
					battleSizeRaw = line
					if declaredLimit == nil {
						declaredLimit = points
					}
					continue
				}
				// A real unit header.
				flush()
				inChars := haveSection && strings.EqualFold(section, gwCharactersSection)
				if haveSection && section == gwAlliedSection {
					allied++
				}
				current = &gwhUnit{
					rawName:            headerName,
					displayedPts:       points,
					isCharacterSection: inChars,
					attachmentGroup:    attachmentGroup,
				}
				if pendingSupport {
					current.attachmentRole = "support"
				}
				pendingSupport = false
				continue
			}

			if group, ok := attachedUnitNumber(line); ok {
				flush()
				section = "ATTACHED UNITS"
				haveSection = true
				attachmentGroup = group
				continue
			}

			if attachedAsSupportRe.MatchString(line) {
				flush()
				pendingSupport = true
				continue
			}

			// `Attached Units` is a body section even when it isn't uppercased.
			if attachedSectionRe.MatchString(line) {
				flush()
				section = "ATTACHED UNITS"
				haveSection = true
				attachmentGroup = 0
				continue
			}

			// Section headers without points (ALL-CAPS role, `Title:` colon).
			if gwhCapsSection.MatchString(line) || gwhColonSection.MatchString(line) {
				flush()
				section = strings.TrimSpace(strings.TrimRight(line, ":"))
				haveSection = true
				attachmentGroup = 0
				continue
			}

			// Anything else (faction/detachment preamble, stray notes).
			if !consumedTitle && current == nil && len(units) == 0 {
				// Very first content line with no `(N pts)` title → use as name.
				consumedTitle = true
				name = line
			} else if current == nil && len(units) == 0 {
				// Preamble after the title, before the first unit: faction then
				// detachment. The GW app (v2.0.4+) suffixes the detachment line
				// with its cost — "Awakened Dynasty (3 Detachment Points)" —
				// which is presentation, not part of the name; strip it.
				if factionRawName == nil {
					factionRawName = line
				} else if len(detachmentRawNames) == 0 {
					detachmentRawNames = append(detachmentRawNames, gwhDetachmentPtsSuffix.ReplaceAllString(line, ""))
				}
			}
		}
		flush()
		pairAttachedGroups(units, attachmentMembers)

		totalComputed := 0.0
		for _, u := range units {
			if p, ok := u["points"].(float64); ok {
				totalComputed += p
			}
			if p, ok := u["enhancement_points"].(float64); ok {
				totalComputed += p
			}
		}

		if battleSizeRaw == nil {
			battleSizeRaw = inferBattleSizeRaw(declaredLimit)
		}

		return map[string]any{
			"name":                 name,
			"generated_by":         nil,
			"faction_raw_name":     factionRawName,
			"detachment_raw_names": detachmentRawNames,
			"battle_size_raw":      battleSizeRaw,
			// Always present (null here), as in TS: resolve only infers a
			// detachment's sole disposition when the key is present and null.
			"force_disposition_raw_name": nil,
			"declared_limit":             declaredLimit,
			"total_reported":             totalReported,
			"total_computed":             totalComputed,
			"units":                      mapsToAny(units),
			"multi_force":                allied > 0,
		}, nil
	},
}
