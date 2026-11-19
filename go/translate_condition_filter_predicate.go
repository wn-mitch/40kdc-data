package wh40kdc

import (
	"regexp"
	"strings"
)

var filterClauseLead = regexp.MustCompile(`^(?:wholly within|within|not within|embarked within|in) `)

// filterPredicate renders a one-clause filter as the predicate of a subject that
// is already a unit or model: "the triggering unit is within Engagement Range of
// ..." and "the unit is enfeebled by this model", not "is a unit within ...". A
// noun the filter qualifies ("a friendly INFANTRY unit", "a unit with the X
// keyword") stays, as does one with several clauses (each keeps qualifying the
// noun), one whose clause is a noun phrase of its own ("a unit that is a PSYKER
// unit or ..."), or one whose clause is itself negative when the predicate is
// negated.
// Mirror of filterPredicate in tools/src/translate/condition.ts.
func filterPredicate(f map[string]any, noun string, negated bool) string {
	phrase := unitFilterPhrase(f)
	clauses := 0
	for k, v := range f {
		if v != nil && k != "level" && k != "designated_by" && k != "has_ability_models" {
			clauses++
		}
	}
	bare := "a " + noun + " "
	if clauses != 1 || !strings.HasPrefix(phrase, bare) {
		return phrase
	}
	rest := phrase[len(bare):]
	var clause string
	switch {
	case strings.HasPrefix(rest, "that is "):
		clause = rest[len("that is "):]
	case filterClauseLead.MatchString(rest):
		clause = rest
	default:
		return phrase
	}
	if strings.HasPrefix(clause, "a ") || strings.HasPrefix(clause, "an ") || (negated && strings.HasPrefix(clause, "not ")) {
		return phrase
	}
	return clause
}
