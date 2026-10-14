package wh40kdc

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// The shared words of the effect describer: the rendering context, subject
// phrases for effect targets, verb agreement, and the name tables for
// characteristics, rolls, tests and pools. ASCII-only; pinned byte-for-byte
// across the ports by conformance/effect-translation. Mirror of
// tools/src/translate/effect-words.ts.

// effCtx is the rendering context threaded down from the containers to the leaves.
type effCtx struct {
	// selectedUnit: inside a select-units / for-each-unit, the selected unit reads "that unit".
	selectedUnit bool
	// selectedModel: inside a model-level selection, the selected model reads "that model".
	selectedModel bool
	// unitSubject: an explicit beneficiary binding inside a designated attack ("" when unset).
	unitSubject string
	// auraRecipient: inside an aura, the recipient reads "that unit".
	auraRecipient bool
	// destroyedTrigger: the ability's trigger already says a unit or model is destroyed; leaves must not repeat it.
	destroyedTrigger bool
}

// ejstr is JS-template stringification: null -> "?", arrays join with ", ",
// numbers print without a trailing ".0".
func ejstr(v any) string {
	switch x := v.(type) {
	case nil:
		return "?"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			parts[i] = ejstr(e)
		}
		return strings.Join(parts, ", ")
	case bool:
		if x {
			return "true"
		}
		return "false"
	case string:
		return x
	case float64:
		return numStr(x)
	case map[string]any:
		return "[object Object]"
	}
	return numStr(v)
}

// parseNumber mirrors TS Number()/Python float(): a JSON number, or a numeric
// string. Returns (value, true) only when the value parses cleanly.
func parseNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

// mod returns an effect's `modifier` object (empty when absent).
func mod(e map[string]any) map[string]any {
	m, _ := getMap(e, "modifier")
	if m == nil {
		return map[string]any{}
	}
	return m
}

// jstrList maps a JSON array through ejstr (nil when v is not an array).
func jstrList(v any) []string {
	l, ok := asList(v)
	if !ok {
		return nil
	}
	out := make([]string, len(l))
	for i, e := range l {
		out[i] = ejstr(e)
	}
	return out
}

var titleSmall = map[string]bool{
	"of": true, "or": true, "and": true, "the": true, "a": true, "an": true,
	"to": true, "in": true, "on": true, "for": true, "with": true,
}

// titleCase turns a kebab-case identifier into a display name with lowercase linking words.
func titleCase(s string) string {
	words := strings.Split(dekebab(s), " ")
	out := make([]string, len(words))
	for i, w := range words {
		if w == "" {
			out[i] = w
		} else if i > 0 && titleSmall[strings.ToLower(w)] {
			out[i] = strings.ToLower(w)
		} else {
			out[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(out, " ")
}

// capWord capitalizes the first character and lowercases the rest (MONSTER -> Monster).
func capWord(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + strings.ToLower(s[1:])
}

// andList renders an Oxford-free conjunction list ("a", "a and b", "a, b and c").
func andList(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	case 2:
		return items[0] + " and " + items[1]
	}
	return strings.Join(items[:len(items)-1], ", ") + " and " + items[len(items)-1]
}

// orList renders an Oxford-free disjunction list ("a", "a or b", "a, b or c").
func orList(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	case 2:
		return items[0] + " or " + items[1]
	}
	return strings.Join(items[:len(items)-1], ", ") + " or " + items[len(items)-1]
}

var dRe = regexp.MustCompile(`[dD]`)

// diceCase prints dice tokens with a capital D (d3 -> D3, 2d6 -> 2D6); a bound
// or counted quantity prints its phrase.
func diceCase(v any) string {
	if q, ok := v.(map[string]any); ok {
		return quantityPhrase(q)
	}
	return dRe.ReplaceAllString(ejstr(v), "D")
}

var antiRe = regexp.MustCompile(`(?i)^anti[\s-]+(.*)$`)
var antiRatedRe = regexp.MustCompile(`(?i)^(.*?)[\s-]*(\d+)\s*(?:\+|plus)?$`)

// bracketKeyword renders a GW weapon keyword token as bracketed caps
// (lethal-hits -> [LETHAL HITS]); Anti-X keeps its hyphen and normalizes to N+.
func bracketKeyword(k any) string {
	raw := strings.TrimSpace(ejstr(k))
	if a := antiRe.FindStringSubmatch(raw); a != nil {
		if m := antiRatedRe.FindStringSubmatch(a[1]); m != nil {
			return "[ANTI-" + strings.ToUpper(strings.TrimSpace(dekebab(m[1]))) + " " + m[2] + "+]"
		}
		return "[ANTI-" + strings.ToUpper(strings.TrimSpace(dekebab(a[1]))) + "]"
	}
	return "[" + strings.ToUpper(dekebab(raw)) + "]"
}

var testNames = map[string]string{"battle-shock": "Battle-shock", "desperate-escape": "Desperate Escape"}

func testName(test any) string {
	t := ejstr(test)
	if n, ok := testNames[t]; ok {
		return n
	}
	return titleCase(t)
}

var pluralUnitsRe = regexp.MustCompile(` (units|models)\b`)
var unitsWordRe = regexp.MustCompile(` units\b`)

// isPlural reports whether a subject noun phrase takes a plural verb.
func isPlural(subj string) bool {
	return pluralUnitsRe.MatchString(subj) || strings.HasPrefix(subj, "all ") || strings.HasPrefix(subj, "targets ")
}

var pluralVerbs = map[string]string{
	"has": "have", "is": "are", "gets": "get", "gains": "gain", "suffers": "suffer", "retains": "retain", "makes": "make",
	"passes": "pass", "fails": "fail", "treats": "treat", "regains": "regain", "counts": "count", "ignores": "ignore", "loses": "lose",
	"scores": "score", "takes": "take", "resolves": "resolve", "does": "do", "controls": "control",
	"receives": "receive", "keeps": "keep",
}

// ev is subject-verb agreement: the plural form of a present-tense verb when the subject is plural.
func ev(subj, singular string) string {
	if !isPlural(subj) {
		return singular
	}
	if p, ok := pluralVerbs[singular]; ok {
		return p
	}
	return strings.TrimSuffix(singular, "s")
}

var statNames = map[string]string{
	"M": "Move", "T": "Toughness", "Sv": "Save", "W": "Wounds", "A": "Attacks", "Ld": "Leadership", "OC": "Objective Control",
	"S": "Strength", "WS": "Weapon Skill", "BS": "Ballistic Skill", "AP": "Armour Penetration", "D": "Damage", "Range": "Range",
	"detection-range": "detection range",
}

func statName(stat any) string {
	s := ejstr(stat)
	if n, ok := statNames[s]; ok {
		return n
	}
	return titleCase(s)
}

// poolName renders a resource-pool token (cp -> CP, otherwise Title Case).
func poolName(pool any) string {
	p := ejstr(pool)
	if strings.ToLower(p) == "cp" {
		return "CP"
	}
	return titleCase(p)
}

// poolUnits is the unit of resource a pool holds, singular, for pools whose id does not name it.
var poolUnits = map[string]string{"blood-tithe": "Blood Tithe point", "battle-focus": "Battle Focus token", "yp": "YP"}

// poolNouns are the countable nouns a pool id can end in: singular, plural.
var poolNouns = map[string][2]string{
	"dice": {"die", "dice"}, "die": {"die", "dice"}, "token": {"token", "tokens"}, "tokens": {"token", "tokens"},
	"point": {"point", "points"}, "points": {"point", "points"}, "marker": {"marker", "markers"},
}

// resourceNoun is a pool's noun: its author label (pluralized by count), else
// the resource the pool holds ("1 Miracle die", "2 Pain tokens").
func resourceNoun(pool, label, count any) string {
	one := jsNumber(ejstr(count)) == 1
	if l, ok := label.(string); ok && l != "" {
		if one {
			return l
		}
		return l + "s"
	}
	id := strings.ToLower(ejstr(pool))
	if id == "cp" {
		return "CP"
	}
	base := strings.TrimSuffix(id, "-pool")
	if unit, ok := poolUnits[base]; ok {
		if unit == "YP" || one {
			return unit
		}
		return unit + "s"
	}
	words := strings.Split(base, "-")
	noun, ok := poolNouns[words[len(words)-1]]
	if !ok {
		return titleCase(base)
	}
	head := titleCase(strings.Join(words[:len(words)-1], "-"))
	if head != "" {
		head += " "
	}
	if one {
		return head + noun[0]
	}
	return head + noun[1]
}

var rollNames = map[string]string{
	"hit": "Hit", "wound": "Wound", "charge": "Charge", "damage": "Damage", "advance": "Advance", "save": "saving throw",
	"leadership": "Leadership", "battle-shock": "Battle-shock", "desperate-escape": "Desperate Escape", "normal-move": "Normal move",
	"deadly-demise": "Deadly Demise", "dark-pact": "Dark Pact", "blessings-of-khorne": "Blessings of Khorne", "resource-die": "pool die",
	"manoeuvre": "Agile Manoeuvre", "channelling": "Channel the Warp",
}

func rollName(roll any) string {
	// The dice a named ability rolls: "Reanimation Protocols".
	if r, ok := roll.(map[string]any); ok && r["of_ability"] != nil {
		return abilityLabel(r["of_ability"])
	}
	r := ejstr(roll)
	if n, ok := rollNames[r]; ok {
		return n
	}
	return titleCase(r)
}

// esigned renders +1 / -1 from an operation + value (a negative value flips the sign, never +-1).
func esigned(operation, value any) string {
	sign := -1
	if operation == "add" || operation == "improve" {
		sign = 1
	}
	if n := jsNumber(value); !math.IsNaN(n) && n < 0 {
		sign = -sign
		value = math.Abs(n)
	}
	if sign > 0 {
		return "+" + diceCase(value)
	}
	return "-" + diceCase(value)
}

// formatComparison renders a dice comparison ("a 4+", "a 3 or less", ...).
func formatComparison(comp string, threshold any) string {
	th := ejstr(threshold)
	switch comp {
	case "lte":
		return "a " + th + " or less"
	case "gt":
		return "greater than " + th
	case "lt":
		return "less than " + th
	case "eq":
		return "exactly " + th
	}
	return "a " + th + "+"
}

// possessive renders the possessive form of a subject (the unit -> the unit's).
func possessive(s string) string {
	if strings.HasSuffix(s, "s") {
		return s + "'"
	}
	return s + "'s"
}

var clauseSubjectRe = regexp.MustCompile(` (within|other than|that|with) `)

// ofOrPossessive renders "<subj>'s <rest>", or "the <rest> of <subj>" when the
// subject is a clause ending in a range.
func ofOrPossessive(subj, rest string) string {
	if clauseSubjectRe.MatchString(subj) || strings.HasSuffix(subj, "\"") {
		return "the " + rest + " of " + subj
	}
	return possessive(subj) + " " + rest
}

// noneOf is the subject of a "cannot" clause: "all enemy units cannot ..." reads "enemy units cannot ...".
func noneOf(subj string) string {
	return strings.TrimPrefix(subj, "all ")
}

// pronoun is the possessive pronoun agreeing with the subject (its / their).
func pronoun(subj string) string {
	if isPlural(subj) {
		return "their"
	}
	return "its"
}

var abilityLabels = map[string]string{
	"nurgles-gift-death-guard": "Nurgle's Gift (Aura)",
	"fights-first":             "Fights First",
}

// abilityLabel is the display label for an ability id: a curated override, else Title Case.
func abilityLabel(id any) string {
	if l, ok := abilityLabels[ejstr(id)]; ok {
		return l
	}
	return idLabel(ejstr(id))
}

var weaponLabels = map[string]string{"imperiums-sword": "Imperium's Sword"}

// weaponLabel is the display name for a granted weapon id: a curated override, else Title Case.
func weaponLabel(id any) string {
	if l, ok := weaponLabels[ejstr(id)]; ok {
		return l
	}
	return titleCase(ejstr(id))
}

var trailingWeaponsRe = regexp.MustCompile(`(?i)\s+weapons?$`)
var kebabSlugRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)+$`)

// weaponNoun renders a weapon filter as a noun ("ranged Bolt Rifle weapons with [PISTOL]").
func weaponNoun(m map[string]any) string {
	kind, keyword := "", ""
	if jsTruthy(m["weapon_type"]) {
		kind = ejstr(m["weapon_type"]) + " "
	}
	if jsTruthy(m["weapon_keyword"]) {
		keyword = " with [" + strings.ToUpper(ejstr(m["weapon_keyword"])) + "]"
	}
	// A name that already carries the noun ("hellforged weapons") must not read "weapons weapons".
	raw := ""
	if jsTruthy(m["weapon_name"]) {
		raw = replaceFirst(trailingWeaponsRe, ejstr(m["weapon_name"]), "")
	}
	named := raw
	if kebabSlugRe.MatchString(raw) {
		named = titleCase(raw)
	}
	if ref, ok := asMap(m["weapon_ref"]); ok && ref != nil {
		// A bound weapon ("the selected weapon") or the weapons picked for a named ability.
		if sel, ok := asMap(ref["selected_by"]); ok && sel != nil {
			return "the " + kind + "weapons selected for " + abilityLabel(sel["ability"]) + keyword
		}
		return "the selected " + kind + "weapon" + keyword
	}
	if named != "" {
		named += " "
	}
	return kind + named + "weapons" + keyword
}

// hasWeapon reports whether a modifier carries a weapon filter.
func hasWeapon(m map[string]any) bool {
	return m["weapon_type"] != nil || m["weapon_name"] != nil || m["weapon_keyword"] != nil || m["weapon_ref"] != nil
}

// weaponRollScope is " with melee weapons" for a roll scoped to a weapon filter, else "".
func weaponRollScope(m map[string]any) string {
	if hasWeapon(m) {
		return " with " + weaponNoun(m)
	}
	return ""
}

var roleSubjects = map[string]string{
	"this-model":         "this model",
	"model-in-this-unit": "a model in this unit",
	"defender":           "the target",
	"event-subject":      "the triggering unit",
	"event-object":       "that unit",
	"stratagem-target":   "that unit",
	"bearer-transport":   "the Transport this unit is embarked within",
	"ability-unit":       "this unit",
}

// filterSubject renders a unit filter as the plural subject of an effect
// (friendly INFANTRY units within 6").
func filterSubject(f map[string]any, ctx effCtx) string {
	owner := ""
	switch f["owner"] {
	case "friendly":
		owner = "friendly "
	case "enemy":
		owner = "enemy "
	}
	all := ""
	if l, ok := asList(f["all_of"]); ok {
		all = strings.Join(jstrList(l), " ") + " "
	}
	noun := "units"
	if f["level"] == "model" {
		noun = "models"
	}
	s := owner + all + noun
	if l, ok := asList(f["any_of"]); ok {
		s += " with the " + orList(jstrList(l)) + " keyword"
	}
	if l, ok := asList(f["none_of"]); ok {
		s += " (excluding " + orList(jstrList(l)) + " " + noun + ")"
	}
	within, hasWithin := asMap(f["within"])
	if hasWithin && within != nil {
		s += " "
		if within["wholly"] == true {
			s += "wholly "
		}
		s += "within " + rangePhrase(within["range"])
		if within["of"] != nil {
			s += " of " + effectSubject(within["of"], ctx)
		}
	} else {
		hasWithin = false
	}
	s += filterRelations(f, ctx)
	if f["visible"] == true {
		s += " that are visible"
	}
	if f["designated"] != nil {
		s += " that are " + designationPhrase(ejstr(f["designated"]), true)
		if f["designated_by"] != nil {
			s += " by " + effectSubject(f["designated_by"], ctx)
		}
	}
	if f["not_designated"] != nil {
		s += " that are not " + designationPhrase(ejstr(f["not_designated"]), true)
	}
	if f["state"] != nil {
		s += " that are " + statePhrase(ejstr(f["state"]), false)
	}
	if f["excluding"] != nil {
		s += " other than " + effectSubject(f["excluding"], ctx)
	}
	bounded := hasWithin || f["visible"] == true || f["designated"] != nil || f["not_designated"] != nil || f["state"] != nil ||
		f["embarked_in"] != nil || f["member_of"] != nil || f["engaged_with"] != nil || f["not_engaged_with"] != nil
	if bounded {
		return s
	}
	return "all " + s
}

// effectSubject renders an effect target (a unit-ref) as the effect's subject.
func effectSubject(target any, ctx effCtx) string {
	if target == nil || target == "this-unit" {
		if ctx.unitSubject != "" {
			return ctx.unitSubject
		}
		if ctx.selectedUnit || ctx.selectedModel {
			return "this unit"
		}
		return "the unit"
	}
	switch target {
	case "selected-unit":
		if ctx.selectedModel {
			return "that model"
		}
		if ctx.selectedUnit {
			return "that unit"
		}
		return "the selected unit"
	case "recipient":
		if ctx.auraRecipient {
			return "that unit"
		}
		return "the unit"
	case "attacker":
		if ctx.unitSubject != "" {
			return ctx.unitSubject
		}
		return "the attacking unit"
	}
	if s, ok := target.(string); ok {
		if p, ok := roleSubjects[s]; ok {
			return p
		}
		return dekebab(s)
	}
	r := mapOr(target)
	if _, ok := r["event_var"].(string); ok {
		return "that unit"
	}
	if sv, ok := r["selection_var"].(string); ok {
		return "the bound " + strings.ReplaceAll(sv, "_", " ")
	}
	if st, ok := r["stratagem_target"].(string); ok {
		return "the " + dekebab(strings.TrimPrefix(st, "the-")) + " target"
	}
	return filterSubject(r, ctx)
}

// weaponHolder names who carries a weapon filter's weapons ("this model", "models in this unit").
func weaponHolder(target any, ctx effCtx) string {
	if target == "this-model" {
		return "this model"
	}
	if ctx.unitSubject != "" && (target == nil || target == "this-unit" || target == "attacker") {
		return "models in " + ctx.unitSubject
	}
	if target == "selected-unit" && ctx.selectedModel {
		return "that model"
	}
	if target == nil || target == "this-unit" {
		return "models in this unit"
	}
	if target == "selected-unit" {
		if ctx.selectedUnit {
			return "models in that unit"
		}
		return "models in the selected unit"
	}
	return effectSubject(target, ctx)
}

// regionPhrase renders a region-ref as a place ("enemy territory", "the Ruins terrain area").
func regionPhrase(r map[string]any) string {
	if jsTruthy(r["rule_region"]) {
		return titleCase(ejstr(mapOr(r["rule_region"])["region_id"]))
	}
	if jsTruthy(r["territory"]) {
		return dekebab(ejstr(r["territory"]))
	}
	area := mapOr(r["terrain_area"])
	where := "a terrain area"
	if area["footprint"] != nil {
		where = "the " + dekebab(ejstr(area["footprint"])) + " terrain area"
	}
	if area["designated"] != nil {
		where += " tagged " + dekebab(ejstr(area["designated"]))
	}
	return where
}

// designationFor renders a tag an effect applies: GW-printed tags stay as
// printed, internal ones read "marked as ...".
func designationFor(tag string) string {
	if label, ok := designationTerm(tag, false); ok {
		return label
	}
	if tag == strings.ToUpper(tag) {
		return tag
	}
	return "marked as " + dekebab(tag)
}

// replaceFirst mirrors JS String.replace with a non-global regex: only the
// first match is replaced (repl is literal).
func replaceFirst(re *regexp.Regexp, s, repl string) string {
	loc := re.FindStringIndex(s)
	if loc == nil {
		return s
	}
	return s[:loc[0]] + repl + s[loc[1]:]
}
