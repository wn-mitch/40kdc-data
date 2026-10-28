package wh40kdc

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Mortal wounds an ability inflicts on an enemy unit outside an attack: after a Charge move, at
// the start of a phase, when a unit is selected. Go mirror of tools/src/cruncher/mortal-sources.ts.

// MortalWoundSource is the mortal wounds one ability inflicts on the target at one moment.
type MortalWoundSource struct {
	// ID is the ability id, then "?<option index>" for each enclosing choice option.
	ID string
	// Moment is the trigger's event and its distinguishing filter value ("move-ended:charge"),
	// or nil for an ability with no trigger.
	Moment *string
	// Expected is the expected mortal wounds the target suffers each time the moment comes,
	// before Feel No Pain, when every condition in Needs holds.
	Expected float64
	// Needs are the leaf conditions the context leaves undecided (condition-need records).
	Needs []any
}

// MortalWoundTranslation is the sources found in one effect and the fragments not modelled.
type MortalWoundTranslation struct {
	Sources     []*MortalWoundSource
	Unsupported []map[string]any
}

type tri int

const (
	triUnknown tri = iota
	triTrue
	triFalse
)

func triOf(owner any) tri {
	switch owner {
	case "enemy":
		return triTrue
	case "friendly":
		return triFalse
	}
	return triUnknown
}

type mortalState struct {
	probability float64
	moment      *string
	needs       []any
	id          string
	// selectedEnemy: whether the nearest enclosing select-units selects enemy units.
	selectedEnemy tri
	// subjectEnemy: whether the nearest trigger's subject is an enemy unit.
	subjectEnemy tri
	// recipientEnemy: whether the nearest for-each-unit reaches enemy units.
	recipientEnemy tri
}

var mortalSelfTargets = map[string]bool{"this-unit": true, "this-model": true, "bearer": true, "self": true, "attacker": true}

// mortalWoundSources returns the mortal wounds effect (with the record's own trigger) inflicts on
// an enemy unit outside an attack. A condition the context leaves undecided is a need and assumed
// to hold; one it decides false removes what it gates. phase-is conditions never gate a source.
// rating is the ability's printed rating, or nil.
func mortalWoundSources(abilityID string, effect, trigger any, context map[string]any, rating any) MortalWoundTranslation {
	ctx := cloneMap(context)
	delete(ctx, "phase")
	var sources []*MortalWoundSource
	unsupported := []map[string]any{}

	report := func(node any, reason string) {
		unsupported = append(unsupported, unsup(reason, node))
	}

	decide := func(raw any, state mortalState) (mortalState, bool) {
		condition := withoutPhase(raw)
		if condition == nil {
			return state, true
		}
		switch evaluateCondition(condition, ctx, "attacker") {
		case false:
			return state, false
		case true:
			return state, true
		}
		state.needs = mergeNeeds(state.needs, undecidedNeeds(condition, ctx, "attacker", nil))
		return state, true
	}

	enterTrigger := func(value any, state mortalState) (mortalState, bool) {
		var triggers []map[string]any
		if list, ok := asList(value); ok {
			for _, item := range list {
				if m, ok := asMap(item); ok && m != nil {
					triggers = append(triggers, m)
				}
			}
		} else if m, ok := asMap(value); ok && m != nil {
			triggers = append(triggers, m)
		}
		if len(triggers) == 0 {
			return state, true
		}
		moments := make([]string, len(triggers))
		for i, t := range triggers {
			moments[i] = momentOf(t)
		}
		moment := strings.Join(moments, "|")
		state.moment = &moment
		anyOwner, allEnemy, allFriendly := false, true, true
		for _, t := range triggers {
			subject, _ := asMap(t["subject"])
			owner, has := subject["owner"]
			if has {
				anyOwner = true
			}
			if !has || owner != "enemy" {
				allEnemy = false
			}
			if !has || owner != "friendly" {
				allFriendly = false
			}
		}
		// A nested moment with no subject of its own keeps the enclosing one.
		if anyOwner {
			switch {
			case allEnemy:
				state.subjectEnemy = triTrue
			case allFriendly:
				state.subjectEnemy = triFalse
			default:
				state.subjectEnemy = triUnknown
			}
		}
		// Alternative moments are each enough on their own; only a single trigger's condition gates.
		if len(triggers) == 1 {
			return decide(triggers[0]["condition"], state)
		}
		return state, true
	}

	// reaches is the state once the target is one of the units filter reaches, or false when the
	// context rules it out. Its range and other unit facts are needs on the target.
	reaches := func(filter map[string]any, state mortalState) (mortalState, bool) {
		rest := map[string]any{}
		for key, value := range filter {
			if key != "owner" {
				rest[key] = value
			}
		}
		if len(rest) == 0 {
			return state, true
		}
		return decide(map[string]any{"type": "matches", "parameters": map[string]any{"subject": "target", "filter": rest}}, state)
	}

	// modelsRolling is how many models roll dice for a per-model roll, or why that is not known.
	modelsRolling := func(roll map[string]any, state mortalState) (float64, mortalState, bool, string) {
		own, hasOwn := num(ctx["attackerModelCount"])
		target, hasTarget := num(ctx["targetModelCount"])
		if ref, present := roll["per_model"]; present {
			onTarget := triUnknown
			if s, ok := ref.(string); ok {
				onTarget = targetIsEnemy(s, state)
			}
			if ref != "this-unit" && onTarget != triTrue {
				return 0, state, false, "dice rolled for each model of " + jsonStringify(ref) + " are not modelled"
			}
			count, has := target, hasTarget
			if ref == "this-unit" {
				count, has = own, hasOwn
			}
			if !has {
				return 0, state, false, "the number of models rolling is not in the context"
			}
			return count, state, true, ""
		}
		each, _ := asMap(roll["for_each"])
		filter, _ := asMap(each["filter"])
		ownModels := filter["level"] == "model" && filter["member_of"] == "this-unit"
		for key := range filter {
			if key != "level" && key != "member_of" && key != "owner" {
				ownModels = false
			}
		}
		if !ownModels {
			return 0, state, false, "dice rolled for each of a subset of models are not modelled"
		}
		if !hasOwn {
			return 0, state, false, "the number of models rolling is not in the context"
		}
		// Which of the unit's models meet the eligibility is a fact about all of them: answered
		// yes, every model rolls.
		next, ok := decide(each["eligibility"], state)
		return own, next, ok, ""
	}

	var walk func(node any, state mortalState)

	var inflict func(node map[string]any, state mortalState)
	inflict = func(node map[string]any, state mortalState) {
		if target, ok := asMap(node["target"]); ok && target != nil && (target["owner"] == "enemy" || target["owner"] == "any") {
			_, selection := target["selection_var"]
			_, event := target["event_var"]
			if !selection && !event {
				if next, ok := reaches(target, state); ok {
					rewritten := cloneMap(node)
					rewritten["target"] = "defender"
					inflict(rewritten, next)
				}
				return
			}
		}
		switch targetIsEnemyValue(node["target"], state) {
		case triFalse:
			return
		case triUnknown:
			report(node, "mortal-wounds: cannot tell whether "+jsonStringify(node["target"])+" is the target")
			return
		}
		modifier, _ := asMap(node["modifier"])
		roll, _ := asMap(modifier["roll"])
		var models *float64
		_, perModel := roll["per_model"]
		_, forEach := roll["for_each"]
		if perModel || forEach {
			count, next, ok, reason := modelsRolling(roll, state)
			if reason != "" {
				report(node, "mortal-wounds: "+reason)
				return
			}
			if !ok {
				return
			}
			models = &count
			state = next
		}
		expected, reason := expectedMortalWounds(modifier, rating, models)
		if reason != "" {
			report(node, "mortal-wounds: "+reason)
			return
		}
		for _, existing := range sources {
			if existing.ID == state.id && equalMoment(existing.Moment, state.moment) {
				existing.Expected += state.probability * expected
				existing.Needs = mergeNeeds(existing.Needs, state.needs)
				return
			}
		}
		sources = append(sources, &MortalWoundSource{ID: state.id, Moment: state.moment, Expected: state.probability * expected, Needs: append([]any{}, state.needs...)})
	}

	walk = func(nodeAny any, state mortalState) {
		node, ok := asMap(nodeAny)
		if !ok || node == nil || state.probability == 0 {
			return
		}
		switch getStr(node, "type") {
		case "sequence", "rules-bundle":
			for _, step := range getList(node, "steps") {
				walk(step, state)
			}
		case "ability-part":
			next, ok := state, true
			if node["trigger"] != nil {
				next, ok = enterTrigger(node["trigger"], state)
			}
			if ok {
				walk(node["effect"], next)
			}
		case "conditional":
			if next, ok := decide(node["condition"], state); ok {
				walk(node["effect"], next)
			}
		case "select-units":
			selector, _ := asMap(node["selector"])
			filter, _ := asMap(selector["filter"])
			state.selectedEnemy = triOf(filter["owner"])
			if next, ok := decide(selector["eligibility"], state); ok {
				walk(node["effect"], next)
			}
		case "for-each-unit":
			selector, _ := asMap(node["selector"])
			filter, _ := asMap(selector["filter"])
			if filter["owner"] != "enemy" {
				if filter["owner"] != "friendly" && containsMortalWounds(node["effect"]) {
					report(node, "mortal-wounds: for-each-unit reaches units of either side")
				}
				return
			}
			if next, ok := reaches(filter, state); ok {
				next.recipientEnemy = triTrue
				walk(node["effect"], next)
			}
		case "roll":
			walk(node["effect"], state)
		case "choice":
			for index, option := range getList(node, "options") {
				next := state
				next.id = state.id + "?" + strconv.Itoa(index)
				walk(option, next)
			}
		case "dice-gated":
			success, ok := gateProbability(node)
			if !ok {
				report(node, "dice-gated: only a fixed threshold on rolled dice is modelled")
				return
			}
			passed, failed := state, state
			passed.probability = state.probability * success
			failed.probability = state.probability * (1 - success)
			walk(node["on_success"], passed)
			walk(node["on_fail"], failed)
		case "dice-table":
			if node["distinct"] == true {
				report(node, "dice-table: distinct results are not modelled")
				return
			}
			faces := 6.0
			if node["dice"] == "D3" {
				faces = 3
			}
			dice := 1.0
			if n, ok := node["count"].(float64); ok {
				dice = n
			}
			for _, outcomeAny := range getList(node, "outcomes") {
				outcome, ok := asMap(outcomeAny)
				results, isList := asList(outcome["results"])
				if !ok || !isList {
					continue
				}
				hits := 0.0
				for _, face := range results {
					if f, ok := face.(float64); ok && f >= 1 && f <= faces {
						hits++
					}
				}
				next := state
				next.probability = state.probability * dice * (hits / faces)
				walk(outcome["effect"], next)
			}
		case "mortal-wounds":
			inflict(node, state)
		default:
			if containsMortalWounds(node) {
				report(node, fmt.Sprintf("mortal-wounds inside \"%s\" are not modelled", jsStr(node["type"])))
			}
		}
	}

	if start, ok := enterTrigger(trigger, mortalState{probability: 1, id: abilityID}); ok {
		walk(effect, start)
	}
	kept := []*MortalWoundSource{}
	for _, source := range sources {
		if source.Expected > 0 {
			kept = append(kept, source)
		}
	}
	return MortalWoundTranslation{Sources: kept, Unsupported: unsupported}
}

func equalMoment(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// withoutPhase is condition with its phase-is leaves taken as satisfied (a compound keeps its
// other operands), or nil when nothing else remains. A negated phase-is is satisfied too.
func withoutPhase(raw any) map[string]any {
	condition, ok := asMap(raw)
	if !ok || condition == nil || condition["type"] == "phase-is" {
		return nil
	}
	operator, isOp := condition["operator"].(string)
	operands, isList := asList(condition["operands"])
	if !isOp || !isList {
		return condition
	}
	kept := []any{}
	for _, operand := range operands {
		if m := withoutPhase(operand); m != nil {
			kept = append(kept, m)
		}
	}
	if len(kept) == 0 {
		return nil
	}
	if operator == "not" && len(kept) != len(operands) {
		return nil
	}
	if operator != "not" && len(kept) == 1 {
		return kept[0].(map[string]any)
	}
	rewritten := cloneMap(condition)
	rewritten["operands"] = kept
	return rewritten
}

// momentOf is the trigger's event and the filter value that tells its moments apart.
func momentOf(trigger map[string]any) string {
	filter, _ := asMap(trigger["filter"])
	candidates := []any{filter["phase"], filter["to"], filter["kind"], filter["roll"], nil, filter["from"]}
	if moves, ok := asList(filter["move_types"]); ok {
		parts := make([]string, len(moves))
		for i, move := range moves {
			parts[i] = jsStr(move)
		}
		candidates[4] = strings.Join(parts, "+")
	}
	event := jsStr(trigger["event"])
	for _, candidate := range candidates {
		if s, ok := candidate.(string); ok && s != "" {
			return event + ":" + s
		}
	}
	return event
}

func targetIsEnemy(target string, state mortalState) tri {
	if mortalSelfTargets[target] {
		return triFalse
	}
	switch target {
	case "defender":
		return triTrue
	case "selected-unit":
		return state.selectedEnemy
	case "event-subject":
		return state.subjectEnemy
	case "recipient":
		return state.recipientEnemy
	}
	return triUnknown
}

// targetIsEnemyValue is true when the mortal wounds land on an enemy unit, false on the
// ability's own side, unknown otherwise.
func targetIsEnemyValue(target any, state mortalState) tri {
	if s, ok := target.(string); ok {
		return targetIsEnemy(s, state)
	}
	if m, ok := asMap(target); ok && m != nil && m["owner"] == "friendly" {
		return triFalse
	}
	return triUnknown
}

// expectedMortalWounds is the expected mortal wounds from a mortal-wounds modifier, or the reason
// it cannot be computed.
func expectedMortalWounds(modifier map[string]any, rating any, models *float64) (float64, string) {
	keys := make([]string, 0, len(modifier))
	for key := range modifier {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		switch key {
		case "count", "max", "per", "roll", "psychic":
		default:
			return 0, key + " is not modelled"
		}
	}
	count := modifier["count"]
	var perWound []DamageOutcome
	var err error
	if m, ok := asMap(count); ok && m["rating"] == true {
		if rating != nil {
			perWound, err = quantityDistribution(rating)
		}
	} else {
		perWound, err = quantityDistribution(count)
	}
	if err != nil {
		return 0, "count " + jsonStringify(count) + " is not a fixed or dice quantity"
	}
	if len(perWound) == 0 {
		return 0, "count follows the ability's rating, which is not given"
	}
	total := perWound
	_, hasRoll := modifier["roll"]
	_, hasPer := modifier["per"]
	if hasRoll || hasPer {
		roll, isObj := asMap(modifier["roll"])
		if modifier["per"] != "success" || !isObj || roll == nil {
			return 0, "per " + jsStr(modifier["per"]) + " is not modelled"
		}
		dice, err := quantityDistribution(roll["dice"])
		if err != nil {
			return 0, "dice " + jsonStringify(roll["dice"]) + " is not a fixed or dice quantity"
		}
		// Dice for each model: the per-model dice, rolled once for every model.
		if models != nil {
			dice = sumDistribution(dice, *models)
		}
		comparison := "gte"
		if s, ok := roll["comparison"].(string); ok {
			comparison = s
		}
		success, ok := faceProbability(roll["threshold"], comparison)
		if !ok {
			return 0, "threshold " + jsonStringify(roll["threshold"]) + " is not modelled"
		}
		total = successTotals(dice, success, perWound)
	}
	maxMortal := math.Inf(1)
	if m, ok := modifier["max"].(float64); ok {
		maxMortal = m
	}
	sum := 0.0
	for _, outcome := range total {
		sum += math.Min(outcome.Value, maxMortal) * outcome.Probability
	}
	return sum, ""
}

// successTotals is the distribution of the summed counts over the dice that succeed.
func successTotals(dice []DamageOutcome, success float64, count []DamageOutcome) []DamageOutcome {
	out := map[float64]float64{}
	for _, d := range dice {
		sums := map[float64]float64{0: 1}
		for k := 0.0; k <= d.Value; k++ {
			pk := binomialCoefficient(d.Value, k) * math.Pow(success, k) * math.Pow(1-success, d.Value-k)
			for value, probability := range sums {
				out[value] += d.Probability * pk * probability
			}
			sums = convolve(sums, count)
		}
	}
	return sortedOutcomes(out)
}

// sumDistribution is the distribution of the sum of times independent draws.
func sumDistribution(draw []DamageOutcome, times float64) []DamageOutcome {
	sums := map[float64]float64{0: 1}
	for index := 0.0; index < times; index++ {
		sums = convolve(sums, draw)
	}
	return sortedOutcomes(sums)
}

func sortedOutcomes(m map[float64]float64) []DamageOutcome {
	out := make([]DamageOutcome, 0, len(m))
	for value, probability := range m {
		out = append(out, DamageOutcome{value, probability})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Value < out[j].Value })
	return out
}

func convolve(left map[float64]float64, right []DamageOutcome) map[float64]float64 {
	out := map[float64]float64{}
	for a, pa := range left {
		for _, b := range right {
			out[a+b.Value] += pa * b.Probability
		}
	}
	return out
}

func binomialCoefficient(n, k float64) float64 {
	result := 1.0
	for i := 1.0; i <= k; i++ {
		result = (result * (n - k + i)) / i
	}
	return result
}

// faceProbability is the probability one D6 meets threshold under comparison; false for a
// threshold that is not a whole number.
func faceProbability(thresholdAny any, comparison string) (float64, bool) {
	threshold, ok := num(thresholdAny)
	if s, isString := thresholdAny.(string); isString {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		threshold, ok = parsed, err == nil
	}
	if !ok || threshold != math.Trunc(threshold) || math.IsInf(threshold, 0) {
		return 0, false
	}
	met := 0
	for face := 1; face <= 6; face++ {
		if compareFace(float64(face), threshold, comparison) {
			met++
		}
	}
	return float64(met) / 6, true
}

// gateProbability is the probability a dice-gated node succeeds; false when it is not a fixed
// threshold on rolled dice.
func gateProbability(node map[string]any) (float64, bool) {
	for _, key := range []string{"test", "from", "requirement"} {
		if node[key] != nil {
			return 0, false
		}
	}
	threshold, ok := node["threshold"].(float64)
	if !ok {
		return 0, false
	}
	var diceStat any = "D6"
	if node["dice"] != nil {
		diceStat = node["dice"]
	}
	dice, err := quantityDistribution(diceStat)
	if err != nil {
		return 0, false
	}
	comparison := "gte"
	if s, ok := node["comparison"].(string); ok {
		comparison = s
	}
	sum := 0.0
	for _, outcome := range dice {
		if compareFace(outcome.Value, threshold, comparison) {
			sum += outcome.Probability
		}
	}
	return sum, true
}

func compareFace(value, threshold float64, comparison string) bool {
	switch comparison {
	case "lte":
		return value <= threshold
	case "lt":
		return value < threshold
	case "gt":
		return value > threshold
	case "eq":
		return value == threshold
	}
	return value >= threshold
}

func mergeNeeds(left, right []any) []any {
	out := append([]any{}, left...)
	for _, need := range right {
		key := getStr(need.(map[string]any), "key")
		found := false
		for _, existing := range out {
			if getStr(existing.(map[string]any), "key") == key {
				found = true
				break
			}
		}
		if !found {
			out = append(out, need)
		}
	}
	return out
}

func containsMortalWounds(node any) bool {
	switch x := node.(type) {
	case []any:
		for _, item := range x {
			if containsMortalWounds(item) {
				return true
			}
		}
	case map[string]any:
		if x["type"] == "mortal-wounds" {
			return true
		}
		for _, value := range x {
			if containsMortalWounds(value) {
				return true
			}
		}
	}
	return false
}
