package wh40kdc

import (
	"regexp"
	"strings"
)

// Words shared by the phase-4 shapes: the designation terms, the one expiry
// vocabulary, quantities (battle size, a bound roll, a count), roll kinds and
// moves. ASCII-only; pinned byte-for-byte across the ports. Mirror of
// tools/src/translate/{designations,expiry}.ts and the helpers added to
// condition-refs.ts / effect-words.ts.

// designationTerms is the rules' term for a registered designation: an
// adjective ("Spotted") or a noun ("Observer" -> "an Observer", "Observers").
var designationTerms = map[string]struct{ adjective, noun string }{
	"afflicted":                  {adjective: "Afflicted"},
	"spotted":                    {adjective: "Spotted"},
	"guided":                     {adjective: "Guided"},
	"riled-up":                   {adjective: "riled up"},
	"empowered":                  {adjective: "Empowered"},
	"observer":                   {noun: "Observer"},
	"blessed":                    {adjective: "blessed"},
	"bondsman-affected":          {adjective: "Bondsman-affected"},
	"detected":                   {adjective: "detected"},
	"disrupted":                  {adjective: "disrupted"},
	"enfeebled":                  {adjective: "enfeebled"},
	"ensnared":                   {adjective: "ensnared"},
	"grav-pinned":                {adjective: "grav-pinned"},
	"grounded":                   {adjective: "grounded"},
	"infested-with-snotlings":    {adjective: "infested with Snotlings"},
	"malevolent":                 {adjective: "malevolent"},
	"mutated":                    {adjective: "mutated"},
	"nulled":                     {adjective: "nulled"},
	"overlapping-fire":           {adjective: "caught in overlapping fire"},
	"poisoned":                   {adjective: "poisoned"},
	"riven":                      {adjective: "riven"},
	"scanned":                    {adjective: "scanned"},
	"scattered":                  {adjective: "scattered"},
	"shaken":                     {adjective: "shaken"},
	"slowed":                     {adjective: "slowed"},
	"smashed":                    {adjective: "smashed"},
	"snared":                     {adjective: "snared"},
	"struck-by-arcing-energies":  {adjective: "struck by arcing energies"},
	"struck-by-concussive-wave":  {adjective: "struck by concussive wave"},
	"struck-by-explosive-debris": {adjective: "struck by explosive debris"},
	"struck-by-spores":           {adjective: "struck by spores"},
	"stunned":                    {adjective: "stunned"},
	"wobbled":                    {adjective: "wobbled"},
	"wracked-with-agonies":       {adjective: "wracked with agonies"},
	"zapped":                     {adjective: "zapped"},
	"yp-spent-this-use":          {adjective: "YP-spent this use"},
	"unravelling":                {adjective: "unravelling"},
	"prey":                       {noun: "prey"},
	"slayers-oath":               {noun: "Slayer's Oath"},
	"vendetta-target":            {noun: "Vendetta target"},
	"victim":                     {noun: "victim"},
	"sabotaged":                  {adjective: "Sabotaged"},
	"warded":                     {adjective: "Warded"},
	"corrupted":                  {adjective: "Corrupted"},
	"warlord":                    {adjective: "the Warlord"},
}

// designationTerm is the printed term for a registered id after "is"/"are",
// and whether the id has one.
func designationTerm(id string, plural bool) (string, bool) {
	term, ok := designationTerms[id]
	if !ok {
		return "", false
	}
	if term.adjective != "" {
		return term.adjective, true
	}
	noun := term.noun
	if plural {
		return noun + "s", true
	}
	if startsVowel(noun) {
		return "an " + noun, true
	}
	return "a " + noun, true
}

var expiryTrails = map[string]string{
	"attack-sequence":                            "until that unit finishes resolving its attacks",
	"resolution":                                 "when resolving this use",
	"while-leading":                              "while this model is leading a unit",
	"after-resolving":                            "after resolving this use",
	"phase":                                      "until the end of the phase",
	"turn":                                       "until the end of the turn",
	"battle":                                     "for the rest of the battle",
	"battle-round":                               "until the end of the battle round",
	"until-next-command-phase":                   "until the start of your next Command phase",
	"until-next-movement-phase":                  "until the start of your next Movement phase",
	"until-next-shooting-phase":                  "until the start of your next Shooting phase",
	"until-next-battle-round":                    "until the start of the next battle round",
	"until-start-next-turn":                      "until the start of your next turn",
	"until-end-of-your-next-turn":                "until the end of your next turn",
	"until-end-of-opponent-next-turn":            "until the end of your opponent's next turn",
	"until-this-unit-has-shot":                   "until this unit has resolved its ranged attacks",
	"control-lost":                               "until you no longer control it",
	"until-end-of-your-next-fight-phase":         "until the end of your next Fight phase",
	"until-end-of-your-next-shooting-phase":      "until the end of your next Shooting phase",
	"until-end-of-your-next-movement-phase":      "until the end of your next Movement phase",
	"until-end-of-opponent-next-movement-phase":  "until the end of your opponent's next Movement phase",
	"until-start-of-opponent-next-command-phase": "until the start of your opponent's next Command phase",
}

// expiryTrail is the trailing clause for an expiry ("until the start of your
// next Shooting phase"), or "" when it adds none (permanent, one-use, unknown).
func expiryTrail(duration any) string {
	if s, ok := duration.(string); ok {
		return expiryTrails[s]
	}
	return ""
}

// rollWord is a roll kind as words for the condition describers: "hit", or the
// dice a named ability rolls ("Reanimation Protocols").
func rollWord(roll any) string {
	if r, ok := roll.(map[string]any); ok && r["of_ability"] != nil {
		return idLabel(r["of_ability"])
	}
	return dekebab(cstr(roll))
}

// usedAbilityPhrase names which ability a `used` filter means: every ability
// with a bracketed keyword, or the same one as a bound use; "" otherwise.
// namedUsePhrase is one named rule a used filter names by id ("Reanimation Protocols", "the
// Swift as the Wind Agile Manoeuvre"), or "". An ability is its name alone; the other kinds add
// their noun.
func namedUsePhrase(f map[string]any) string {
	if f["id"] == nil {
		return ""
	}
	if f["kind"] == "ability" {
		return idLabel(f["id"])
	}
	noun, ok := map[string]string{"manoeuvre": "Agile Manoeuvre", "stratagem": "Stratagem", "action": "action"}[cstr(f["kind"])]
	if !ok {
		return ""
	}
	return "the " + idLabel(f["id"]) + " " + noun
}

// inProgressPhrases is a rule of one kind being used now, when the filter names none.
var inProgressPhrases = map[string]string{
	"ability": "an ability", "stratagem": "a Stratagem", "manoeuvre": "an Agile Manoeuvre", "action": "an action", "order": "an Order",
	"ritual": "a Ritual", "dark-pact": "a Dark Pact", "act-of-faith": "an Act of Faith", "doctrine": "a Combat Doctrine", "contract": "a contract",
}

func usedAbilityPhrase(f map[string]any) string {
	var phrase string
	if f["ability_keyword"] != nil {
		phrase = "a " + titleCase(strings.ToLower(cstr(f["ability_keyword"]))) + " ability"
	} else if f["same_rule_as"] != nil {
		if f["kind"] == "stratagem" {
			phrase = "that same Stratagem"
		} else {
			phrase = "that same ability"
		}
	} else if f["source"] != nil || f["usage"] != nil {
		phrase = namedUsePhrase(f)
		if phrase == "" {
			phrase = "an ability"
		}
	}
	if phrase == "" {
		return ""
	}
	if sources := cstrList(f["source"]); len(sources) > 0 {
		rendered := make([]string, len(sources))
		for i, source := range sources {
			switch source {
			case "unit":
				rendered[i] = "its datasheet"
			case "enhancement":
				rendered[i] = "an Enhancement"
			default:
				rendered[i] = dekebab(source)
			}
		}
		phrase += " from " + orList(rendered)
	}
	if f["usage"] != nil {
		phrase += " that can be used " + usageClause(f["usage"])
	}
	return phrase
}

var battleSizeKeys = []string{"incursion", "strike-force", "onslaught"}

// isBattleSizeValue reports whether q names a value for every battle size.
func isBattleSizeValue(q map[string]any) bool {
	for _, k := range battleSizeKeys {
		if q[k] == nil {
			return false
		}
	}
	return true
}

func battleSizeValues(q map[string]any) string {
	parts := make([]string, len(battleSizeKeys))
	for i, k := range battleSizeKeys {
		parts[i] = ejstr(q[k])
	}
	return strings.Join(parts, "/")
}

// scaleOf is what a count-of / scaling source counts, as a noun phrase.
var scaleOf = map[string]string{
	"enemy-models-in-range":           "enemy models",
	"friendly-models-in-range":        "friendly models",
	"models-in-bearer-unit":           "models in this unit",
	"models-in-or-embarked-in-bearer": "models in or embarked within this model",
	"models-embarked-in-bearer":       "models embarked within this model",
	"embarked-models-oc":              "Objective Control of the models embarked within this model",
	"models-equipped-with":            "models in this unit equipped with",
	"enemy-units-in-range":            "enemy units",
	"wounds-lost":                     "wounds lost",
	"battle-round":                    "battle round",
}

var leadingModelsRe = regexp.MustCompile(`^models\b`)

// scaleSource is a count source with its keyword / wargear qualifier
// ("SPYDER models in this unit").
func scaleSource(q map[string]any) string {
	ofV := q["count_of"]
	if ofV == nil {
		ofV = q["of"]
	}
	of := ejstr(ofV)
	s, ok := scaleOf[of]
	if !ok {
		s = dekebab(of)
	}
	if of == "models-equipped-with" {
		s += " " + titleCase(ejstr(q["wargear"]))
	}
	if q["keyword"] != nil {
		s = replaceFirst(leadingModelsRe, s, ejstr(q["keyword"])+" models")
	}
	if q["within"] != nil {
		s += " within " + rangePhrase(q["within"])
	}
	return s
}

// quantityPhrase renders a non-literal quantity as a noun phrase: one value per
// battle size, a bound roll's result, or a count.
func quantityPhrase(q map[string]any) string {
	if describerRatingRef(q) {
		return "its rating"
	}
	if isBattleSizeValue(q) {
		return battleSizeValues(q) + " (Incursion/Strike Force/Onslaught)"
	}
	if _, ok := q["roll_var"].(string); ok {
		if q["successes_on"] != nil {
			return "the number of those dice that rolled a " + ejstr(q["successes_on"]) + "+"
		}
		return "the result of that roll"
	}
	if q["count_of"] == "battle-round" {
		return "the battle round number"
	}
	if q["count_of"] == "embarked-models-oc" {
		return "the total " + scaleSource(q)
	}
	if q["count_of"] != nil {
		return "the number of " + scaleSource(q)
	}
	return "?"
}

// isLiteral reports whether a quantity is a literal number or dice expression
// (JS: null or not an object).
func isLiteral(q any) bool {
	switch q.(type) {
	case map[string]any, []any:
		return false
	}
	return true
}

// amountOf renders "D3 mortal wounds", or "a number of mortal wounds equal to
// the result of that roll".
func amountOf(q any, one, many string) string {
	if isLiteral(q) {
		n := diceCase(q)
		if n == "1" {
			return n + " " + one
		}
		return n + " " + many
	}
	p := mapOr(q)
	if isBattleSizeValue(p) {
		return battleSizeValues(p) + " " + many + " (Incursion/Strike Force/Onslaught)"
	}
	return "a number of " + many + " equal to " + quantityPhrase(p)
}

var movedPhrases = map[string]string{
	"normal": "a Normal move", "advance": "an Advance move", "fall-back": "a Fall Back move", "charge": "a Charge move",
	"remain-stationary": "no move (it Remained Stationary)",
}

// movedPhrase is the move a counts_as_move names ("a Normal move").
func movedPhrase(move any) string {
	if p, ok := movedPhrases[ejstr(move)]; ok {
		return p
	}
	return article(ejstr(move)) + " " + titleCase(ejstr(move)) + " move"
}

// requirementPhrase renders a dice requirement: "pair of 4+", or alternatives
// "pair of 6+ or triple of 3+".
func requirementPhrase(req any) string {
	one := func(r any) string {
		m := mapOr(r)
		return ejstr(m["type"]) + " of " + ejstr(m["min_value"]) + "+"
	}
	if anyOf, ok := asList(mapOr(req)["any_of"]); ok {
		parts := make([]string, len(anyOf))
		for i, r := range anyOf {
			parts[i] = one(r)
		}
		return strings.Join(parts, " or ")
	}
	return one(req)
}

var testRollKinds = map[string]bool{"psychic": true, "battle-shock": true, "leadership": true, "desperate-escape": true, "hazard": true}

// rollKindNoun names what kind of roll a gate or a roll step is: "a Psychic
// test", "a Blessings of Khorne roll".
func rollKindNoun(kind any) string {
	name := rollName(kind)
	noun := "roll"
	if s, ok := kind.(string); ok && testRollKinds[s] {
		noun = "test"
	}
	return article(name) + " " + name + " " + noun
}

var (
	unitsWordFirstRe  = regexp.MustCompile(` units\b`)
	modelsWordFirstRe = regexp.MustCompile(` models\b`)
	unitsWholeWordRe  = regexp.MustCompile(`\bunits\b`)
	anOtherRe         = regexp.MustCompile(`^an? other `)
)

// filterRelations renders a unit filter's relations to other units and
// abilities: " embarked within this model", " with the Deep Strike ability".
func filterRelations(f map[string]any, ctx effCtx) string {
	s := ""
	labels := func(v any) []string {
		l, _ := asList(v)
		out := make([]string, len(l))
		for i, a := range l {
			out[i] = abilityLabel(a)
		}
		return out
	}
	if isList(f["has_ability"]) {
		s += " with the " + andList(labels(f["has_ability"])) + " ability"
	}
	if isList(f["lacks_ability"]) {
		s += " without the " + orList(labels(f["lacks_ability"])) + " ability"
	}
	if f["embarked_in"] != nil {
		s += " embarked within " + effectSubject(f["embarked_in"], ctx)
	}
	if f["member_of"] != nil {
		member := effectSubject(f["member_of"], ctx)
		if value, ok := f["member_of"].(string); ok && value == "this-unit" {
			member = "the unit"
		}
		s += " in " + member
	}
	// "any other friendly unit": a filter excluding the unit with the ability reads "other".
	exactReference := func(ref any) bool {
		if _, ok := ref.(string); ok {
			return true
		}
		r, ok := asMap(ref)
		return ok && r != nil && (r["selection_var"] != nil || r["event_var"] != nil || r["stratagem_target"] != nil)
	}
	engagedWith := func(g any) string {
		if exactReference(g) {
			return effectSubject(g, ctx)
		}
		x := map[string]any{}
		for k, v := range mapOr(g) {
			x[k] = v
		}
		other := x["excluding"] == "this-unit" || x["excluding"] == "this-model"
		if other {
			delete(x, "excluding")
		}
		phrase := strings.TrimPrefix(filterSubject(x, ctx), "all ")
		phrase = replaceFirst(modelsWordFirstRe, replaceFirst(unitsWordFirstRe, phrase, " unit"), " model")
		if other {
			return "other " + phrase
		}
		return phrase
	}
	if f["engaged_with"] != nil {
		w := engagedWith(f["engaged_with"])
		if exactReference(f["engaged_with"]) {
			s += " within Engagement Range of " + w
		} else {
			s += " within Engagement Range of " + replaceFirst(anOtherRe, article(w)+" "+w, "another ")
		}
	}
	if f["not_engaged_with"] != nil {
		any := "any "
		if exactReference(f["not_engaged_with"]) {
			any = ""
		}
		s += " that are not within Engagement Range of " + any + engagedWith(f["not_engaged_with"])
	}
	return s
}

// factionSuffixes are the faction dir slugs an ability or Stratagem id ends
// with (`<name>-<faction>`), longest first. The suffix is identity, not name,
// so it never reaches the English.
var factionSuffixes = []string{"agents-of-the-imperium", "chaos-space-marines", "adeptus-mechanicus", "leagues-of-votann", "emperors-children",
	"genestealer-cults", "adepta-sororitas", "imperial-knights", "adeptus-custodes", "adeptus-astartes", "astra-militarum", "black-templars",
	"imperial-fists", "chaos-knights", "thousand-sons", "chaos-daemons", "blood-angels", "ultramarines", "space-wolves",
	"grey-knights", "world-eaters", "white-scars", "raven-guard", "dark-angels", "salamanders", "death-guard", "iron-hands", "tau-empire",
	"deathwatch", "drukhari", "tyranids", "aeldari", "necrons", "orks"}

// withoutFactionSuffix drops an id's faction suffix ("acts-of-faith-adepta-sororitas" -> "acts-of-faith").
func withoutFactionSuffix(id string) string {
	for _, f := range factionSuffixes {
		if strings.HasSuffix(id, "-"+f) && len(id) > len(f)+1 {
			return id[:len(id)-len(f)-1]
		}
	}
	return id
}

// wholeNames are ids whose name itself ends with the faction (the suffix was never added).
var wholeNames = map[string]string{"lord-of-the-death-guard": "Lord of the Death Guard"}

// idLabel renders an ability or Stratagem id as a name: its name part in Title Case.
func idLabel(id any) string {
	s := cstr(id)
	if n, ok := wholeNames[s]; ok {
		return n
	}
	return titleCase(withoutFactionSuffix(s))
}

// describerRatingRef is the describer's `{rating: true}` test: any object
// whose rating is true (the substitution in withRating needs the exact form).
func describerRatingRef(v any) bool {
	m, ok := v.(map[string]any)
	return ok && m["rating"] == true
}
