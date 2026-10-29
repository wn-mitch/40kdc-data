package wh40kdc

import (
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

// Title / unit header: `Name (N pts|Points)` with an optional trailing comment.
// Event exports use commas, periods, apostrophes, ordinary spaces, NBSP, and
// narrow NBSP as thousands separators.
var gwhPtsLine = regexp.MustCompile(`(?i)^(.+?)\s*\(\s*([\d,.'’\x{00a0}\x{202f} ]+)\s*(?:pts?|points?)\s*\).*$`)

// `## Section [ (N pts) ]` markdown header.
var gwhMdSection = regexp.MustCompile(`^#{1,6}\s*(.+?)\s*$`)

// ALL-CAPS role section (`CHARACTERS`, `OTHER DATASHEETS`, …).
var gwhCapsSection = regexp.MustCompile(`^[A-Z][A-Z0-9 \-/&]+$`)

// `Title:` colon section (`Epic Hero:`, `Battleline:`).
var gwhColonSection = regexp.MustCompile(`^([A-Za-z][\w /&-]*):\s*$`)

// Bullet line: leading indent, a `•` or `◦` marker, then the body.
var gwhBulletLine = regexp.MustCompile(`^([\t \x{00a0}]*)([•◦*])\s*(.+?)\s*$`)

var gwhNxPrefix = regexp.MustCompile(`(?i)^(\d+)[x×]\s+(.+)$`)

// `N Model with w1, w2` (NewRecruit grouping inside a GW-shaped list).
var gwhModelWithWargear = regexp.MustCompile(`(?i)^(\d+)(?:[x×]\s+|\s+)(.+?)\s+with\s+(.+)$`)

// A title-less total line used by some event submissions: `(2000 points)`.
var gwhBarePointsLine = regexp.MustCompile(`(?i)^\(?\s*([\d,.'’\x{00a0}\x{202f} ]+)\s*(?:pts?|points?)\s*\)?$`)

// Inline enhancement annotation: `Name (+N pts)` or `Name [+N points]`.
var gwhEnhAnnot = regexp.MustCompile(`(?i)^(.+?)\s*(?:\(\+\s*(\d+)\s*pts?\s*\)|\[\+\s*(\d+)\s*(?:pts?|points?)\s*\])\s*$`)

// `Enhancements: X` / `E: X` and localized equivalents.
var gwhEnhLabel = regexp.MustCompile(`(?i)^(?:e|enh|enhancement|enhancements|verbesserung|verbesserungen)\s*:\s*(.+)$`)

// Attachment relationship annotations emitted by GW-family exports.
var gwhAttachment = regexp.MustCompile(`(?i)^(attached\s+as|leader|leading)\s*:\s*(.+)$`)

// `(Character)` inside an attachment role.
var gwhCharacterRole = regexp.MustCompile(`(?i)\(\s*Character\s*\)`)
var gwhCharacterAnnotation = regexp.MustCompile(`(?i)^(?:.+\s+keywords?\s*:\s*character|subterranean\s+assault\s+character)$`)

// `… Keywords: X` / `Mark of Chaos: X` / `Daemonic Allegiance: X` selections.
var gwhColonAnnotation = regexp.MustCompile(`(?i)^(?:.+\s+keywords?|mark of chaos|daemonic allegiance)\s*:`)
var gwhKeywordAnnotation = regexp.MustCompile(`(?i)^This Datasheet also has the (.+?) keyword$`)
var gwhPlainCount = regexp.MustCompile(`^(\d+)\s+(.+)$`)
var gwhAndBeforeLast = regexp.MustCompile(`(?i)\s+and\s+`)

// ListForge-text first line, used only to decline (that framed header belongs
// to listforgeTextAdapter).
var gwhListforgeFirstLine = regexp.MustCompile(`(?i)^(.+)\s\(\s*[\d,.'’\x{00a0}\x{202f} ]+\s*Points?\s*\)\s*$`)

var gwhBulletAnywhere = regexp.MustCompile(`(?m)^[\t \x{00a0}]*[•◦*]`)
var gwhDetachmentPtsSuffix = regexp.MustCompile(`(?i)\s*\(\s*\d*\s*(?:Detachment Points?|Detachementpoints?|DP|PD)\s*\)\s*$`)

// gwhHeaderlessText accepts bullet-bearing plain text that no framed adapter
// claims, returning the BCP-stripped body.
func gwhHeaderlessText(decoded any) (string, bool) {
	s, ok := decoded.(string)
	if !ok {
		return "", false
	}
	if strings.Contains(s, gwFactionKeywordPrefix) && strings.Contains(s, "+ NUMBER OF UNITS:") &&
		!gwEmbeddedAppBattleSize.MatchString(s) {
		return "", false // framed GW → gwAdapter
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
		if m := gwhListforgeFirstLine.FindStringSubmatch(strings.TrimSpace(fnb)); m != nil {
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

	// `Name (+N pts)` / `Name [+N points]` enhancement annotation.
	if m := gwhEnhAnnot.FindStringSubmatch(rest); m != nil {
		var pts any
		if n, err := strconv.Atoi(m[2] + m[3]); err == nil {
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

	// WTC submissions sometimes use NewRecruit's `N Model with w1, w2` grouping
	// inside an otherwise GW-shaped list. Lower it to the same model plus
	// inline-wargear representation as the colon dialect.
	if m := gwhModelWithWargear.FindStringSubmatch(rest); m != nil {
		n, _ := strconv.Atoi(m[1])
		return gwhBullet{
			indent: indent, count: n, name: strings.TrimSpace(m[2]),
			colonWargear: gwhJoinFinalAnd(m[3]), bulleted: bulleted,
		}
	}
	if count == nil {
		if m := gwhPlainCount.FindStringSubmatch(rest); m != nil {
			n, _ := strconv.Atoi(m[1])
			count = n
			rest = strings.TrimSpace(m[2])
		}
	}
	keyword := gwhKeywordAnnotation.FindStringSubmatch(rest)
	if character := gwhCharacterAnnotation.MatchString(rest); character || keyword != nil {
		override := "Character"
		if keyword != nil {
			override = strings.TrimSpace(keyword[1])
		}
		return gwhBullet{
			indent: indent, count: nil, colonWargear: nil, isAnnotation: true,
			bulleted: bulleted, setsCharacter: character, keywordOverride: override,
		}
	}
	if gwhColonAnnotation.MatchString(rest) {
		var override any
		if value := strings.TrimSpace(rest[strings.Index(rest, ":")+1:]); value != "" {
			override = value
		}
		return gwhBullet{
			indent: indent, count: nil, colonWargear: nil, isAnnotation: true,
			bulleted: bulleted, keywordOverride: override,
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
		if keyword, ok := b.keywordOverride.(string); ok && keyword != "" && !containsStr(keywordOverrides, keyword) {
			keywordOverrides = append(keywordOverrides, keyword)
		}

		// Character-promoting annotations carry no model or gear. Attachment
		// metadata is likewise skipped before model detection.
		if b.setsCharacter {
			isCharacter = true
			continue
		}
		if b.isAttachment {
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
			// Items carry their own per-model `Nx` count; markers such as
			// `Warlord` are not wargear.
			classified := classifyWargearList(splitWargearList(b.colonWargear.(string)))
			for _, itemAny := range classified.wargear {
				item, _ := itemAny.(map[string]any)
				wargear.add(getStr(item, "raw_name"), asInt(item["count"])*n)
			}
			candidateGroups = append(candidateGroups, gwhLoadoutGroup{modelName: b.name, count: n, wargear: classified.wargear})
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
