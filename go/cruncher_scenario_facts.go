package wh40kdc

import (
	"math"
	"strings"
)

// Condition evaluators for declared objectives, designations, keyword model
// counts, moves and test results. Each returns true, false, or nil ("unknown")
// when the context does not declare the fact it needs. Mirror of
// objectiveControl, evaluateDesignated, keywordModelBounds, boundsVerdict,
// evaluateOwnMove and evaluateTestResult in
// tools/src/cruncher/scenario-conditions.ts.
//
//	objectives                         []{controller?, designations?, role?, homeOf?, territory?, name?}: every objective
//	attackerDesignationsApplied, targetDesignationsApplied  {designation: units carrying it that the unit applied}
//	attackerKeywordModels, targetKeywordModels  {keyword: models carrying it}
//	attackerMoves, targetMoves         []string: every move the unit made this turn
//	testResults                        {roll: "success" | "failure"}
//	attackerSelected, targetSelected   []string: every activity selected for this phase
//	attackerKills, targetKills         {models, units}: enemies destroyed this phase
//	attackerLosses, targetLosses       number: models lost this phase
//	attackerRolls, targetRolls, attackerRolledAgainst, targetRolledAgainst  []{roll, result} this phase

// objectiveControl counts how many of the declared objectives meeting filter
// each side controls, or returns nil when an objective's match, or a matching
// objective's controller, is unknown.
func objectiveControl(rawFilter, rawObjectives any, abilitySide string) map[string]any {
	filter, isFilter := asMap(rawFilter)
	objectives, known := asList(rawObjectives)
	if !isFilter || filter == nil || !known {
		return nil
	}
	attacker, target, total := 0.0, 0.0, 0.0
	for _, raw := range objectives {
		objective, _ := asMap(raw)
		verdict := objectiveMatches(filter, objective, abilitySide)
		if verdict == nil {
			return nil
		}
		if verdict == false {
			continue
		}
		controller, present := objective["controller"]
		if !present {
			return nil
		}
		total++
		switch controller {
		case "attacker":
			attacker++
		case "target":
			target++
		}
	}
	return map[string]any{"attacker": attacker, "target": target, "total": total}
}

// evaluateDesignated evaluates `designated`: with `count`, how many units carry
// the designation that the `by` unit applied; with an objective subject, how
// many objectives meeting the filter carry it (at least one without `count`).
func evaluateDesignated(params, ctx map[string]any, bySide, abilitySide string) any {
	tag, ok := params["tag"].(string)
	if !ok {
		return nil
	}
	rawBounds, bounded := params["count"]
	var bounds map[string]any
	if bounded {
		bounds, ok = asMap(rawBounds)
		if !ok || bounds == nil {
			return nil
		}
		for _, key := range []string{"min", "max"} {
			if value, present := bounds[key]; present {
				if _, numeric := contextNumber(value); !numeric {
					return nil
				}
			}
		}
	}
	within := func(count float64) bool {
		if !bounded {
			return count >= 1
		}
		if minimum, ok := contextNumber(bounds["min"]); ok && count < minimum {
			return false
		}
		if maximum, ok := contextNumber(bounds["max"]); ok && count > maximum {
			return false
		}
		return true
	}
	rawSubject, hasSubject := params["subject"]
	if subject, ok := asMap(rawSubject); ok && subject != nil {
		if objectiveFilter, ok := asMap(subject["objective"]); ok && objectiveFilter != nil {
			objectives, known := asList(ctx["objectives"])
			if _, by := params["by"]; by || !known {
				return nil
			}
			filter := map[string]any{"designated": tag}
			for key, value := range objectiveFilter {
				if key != "designated" {
					filter[key] = value
				}
			}
			count := 0.0
			for _, raw := range objectives {
				objective, _ := asMap(raw)
				verdict := objectiveMatches(filter, objective, abilitySide)
				if verdict == nil {
					return nil
				}
				if verdict == true {
					count++
				}
			}
			return within(count)
		}
	}
	if bounded {
		if hasSubject || bySide == "" {
			return nil
		}
		applied, known := asMap(ctx[bySide+"DesignationsApplied"])
		if !known || applied == nil {
			return nil
		}
		count := 0.0
		for designation, units := range applied {
			if strings.EqualFold(designation, tag) {
				value, _ := contextNumber(units)
				count += value
			}
		}
		return within(count)
	}
	// A unit's own designations are a `matches` filter; the schema gives this
	// condition no such form.
	return nil
}

// keywordModelBounds bounds how many models of a unit carry keyword: the
// declared count, else all of them when every model carries it. ok is false
// otherwise: a unit's keywords omit its models' own names, so a keyword missing
// from them does not show that no model carries it.
func keywordModelBounds(keyword string, declared, modelKeywords, modelCount any) (low, high float64, ok bool) {
	if counts, known := asMap(declared); known {
		for item, count := range counts {
			if strings.EqualFold(item, keyword) {
				value, numeric := contextNumber(count)
				return value, value, numeric
			}
		}
	}
	keywords, known := asList(modelKeywords)
	if !known || !containsFold(keywords, keyword) {
		return 0, 0, false
	}
	if count, known := contextNumber(modelCount); known {
		return count, count, true
	}
	return 1, math.Inf(1), true
}

// boundsVerdict applies inclusive `min`/`max` bounds to a count known to lie in
// [low, high].
func boundsVerdict(params map[string]any, low, high float64) any {
	minimum, hasMin := contextNumber(params["min"])
	maximum, hasMax := contextNumber(params["max"])
	if (hasMin && high < minimum) || (hasMax && low > maximum) {
		return false
	}
	if (!hasMin || low >= minimum) && (!hasMax || high <= maximum) {
		return true
	}
	return nil
}

// evaluateOwnMove evaluates `happened` for a unit's own moves this turn:
// whether the unit on side made any of the listed moves. decided is false when
// the condition has another form or the moves are undeclared.
func evaluateOwnMove(params, ctx map[string]any, side string) (moved, decided bool) {
	filter, isFilter := asMap(params["filter"])
	if params["event"] != "move-ended" || params["window"] != "turn" || side == "" || !isFilter || filter == nil {
		return false, false
	}
	for key := range params {
		if key != "event" && key != "subject" && key != "filter" && key != "window" {
			return false, false
		}
	}
	types, isList := asList(filter["move_types"])
	if len(filter) != 1 || !isList || len(types) == 0 {
		return false, false
	}
	for _, kind := range types {
		if _, ok := kind.(string); !ok {
			return false, false
		}
	}
	moves, known := asList(ctx[side+"Moves"])
	if !known {
		return false, false
	}
	for _, kind := range types {
		for _, made := range moves {
			if made == kind {
				return true, true
			}
		}
	}
	return false, true
}

// evaluateTestResult evaluates `roll-result` for a test the ability made, from
// the declared test results.
func evaluateTestResult(params, ctx map[string]any) any {
	roll, _ := params["roll"].(string)
	result, _ := params["result"].(string)
	if (roll != "leadership" && roll != "battle-shock" && roll != "charge") || (result != "success" && result != "failure") {
		return nil
	}
	results, known := asMap(ctx["testResults"])
	if !known || results == nil {
		return nil
	}
	declared, present := results[roll]
	if !present {
		return nil
	}
	return declared == result
}

// phaseEventKeys are the parameters each phase-event form may carry.
var phaseEventKeys = map[string][]string{
	"selected":        {"event", "subject", "filter", "window"},
	"model-destroyed": {"event", "object", "filter", "window", "count"},
	"destroyed":       {"event", "object", "filter", "window", "count"},
	"after-roll":      {"event", "subject", "object", "filter", "window"},
}

// evaluatePhaseEvent evaluates `happened` this phase from the declared phase
// events: what a unit was selected for, the enemy models and units it
// destroyed, the models it lost, and the rolls it made or that were made
// against it. sideOf names the unit of the attack a reference is ("" for
// neither). decided is false when the condition has another form; verdict is
// nil when the fact it reads is undeclared. A kill or roll filter narrower than
// the declared facts can still rule an event out when none happened.
func evaluatePhaseEvent(params, ctx map[string]any, sideOf func(any) string) (verdict any, decided bool) {
	event, _ := params["event"].(string)
	keys, known := phaseEventKeys[event]
	if params["window"] != "phase" || !known {
		return nil, false
	}
	for key := range params {
		allowed := false
		for _, candidate := range keys {
			allowed = allowed || key == candidate
		}
		if !allowed {
			return nil, false
		}
	}
	filter := map[string]any{}
	if raw, present := params["filter"]; present {
		var ok bool
		if filter, ok = asMap(raw); !ok || filter == nil {
			return nil, false
		}
	}
	switch event {
	case "selected":
		side := sideOf(params["subject"])
		to, ok := filter["to"].(string)
		if side == "" || !ok || len(filter) != 1 {
			return nil, false
		}
		selected, declared := asList(ctx[side+"Selected"])
		if !declared {
			return nil, true
		}
		for _, item := range selected {
			if item == to {
				return true, true
			}
		}
		return false, true
	case "after-roll":
		return evaluateRolled(params, filter, ctx, sideOf)
	}
	bounds := map[string]any{"min": 1.0}
	if raw, present := params["count"]; present {
		var ok bool
		if bounds, ok = asMap(raw); !ok || bounds == nil {
			return nil, false
		}
	}
	var low, high float64
	var form, declared bool
	if event == "model-destroyed" && len(filter) == 0 {
		low, high, form, declared = lossRange(params["object"], ctx, sideOf)
	} else {
		low, high, form, declared = killRange(event == "model-destroyed", params["object"], filter, ctx, sideOf)
	}
	if !form {
		return nil, false
	}
	if !declared {
		return nil, true
	}
	return boundsVerdict(bounds, low, high), true
}

// lossRange bounds how many of the object's models the ability's unit lost this
// phase: this model, or any model of this unit.
func lossRange(object any, ctx map[string]any, sideOf func(any) string) (low, high float64, form, declared bool) {
	if object != "this-model" && object != "model-in-this-unit" {
		return 0, 0, false, false
	}
	side := sideOf("this-unit")
	losses, known := contextNumber(ctx[side+"Losses"])
	if side == "" || !known {
		return 0, 0, true, false
	}
	if object == "this-model" {
		return 0, math.Min(losses, 1), true, true
	}
	return losses, losses, true, true
}

// killRange bounds how many enemy models (or units) the `by` unit destroyed
// this phase. A kill by one model, or narrowed by object keywords or attack
// type, counts at most the unit's kills.
func killRange(models bool, rawObject any, filter, ctx map[string]any, sideOf func(any) string) (low, high float64, form, declared bool) {
	object, ok := asMap(rawObject)
	by, hasBy := filter["by"]
	if !ok || object == nil || object["owner"] != "enemy" || !hasBy {
		return 0, 0, false, false
	}
	level, leveled := object["level"]
	if !leveled && !models {
		level = "unit"
	}
	want := "unit"
	if models {
		want = "model"
	}
	if level != want {
		return 0, 0, false, false
	}
	side := sideOf(by)
	if side == "" {
		return 0, 0, false, false
	}
	kills, known := asMap(ctx[side+"Kills"])
	if !known || kills == nil {
		return 0, 0, true, false
	}
	field := "units"
	if models {
		field = "models"
	}
	count, _ := contextNumber(kills[field])
	narrowed := by == "this-model"
	for key := range object {
		narrowed = narrowed || (key != "owner" && key != "level")
	}
	for key := range filter {
		narrowed = narrowed || key != "by"
	}
	if narrowed {
		return 0, count, true, true
	}
	return count, count, true, true
}

// evaluateRolled evaluates `after-roll` this phase: a roll the subject unit
// made, or with an object (and no subject), one made against the object unit.
// A filter beyond the roll and result can only rule the roll out.
func evaluateRolled(params, filter, ctx map[string]any, sideOf func(any) string) (verdict any, decided bool) {
	roll, ok := filter["roll"].(string)
	result, _ := filter["result"].(string)
	if !ok || (result != "success" && result != "failure" && result != "critical") {
		return nil, false
	}
	subject, hasSubject := params["subject"]
	object, against := params["object"]
	if hasSubject && against {
		return nil, false
	}
	reference, suffix := subject, "Rolls"
	if against {
		reference, suffix = object, "RolledAgainst"
	}
	side := sideOf(reference)
	if side == "" {
		return nil, false
	}
	rolls, declared := asList(ctx[side+suffix])
	if !declared {
		return nil, true
	}
	rolled := false
	for _, raw := range rolls {
		entry, _ := asMap(raw)
		made, _ := entry["result"].(string)
		if entry["roll"] == roll && (made == result || (result == "success" && made == "critical")) {
			rolled = true
		}
	}
	if !rolled {
		return false, true
	}
	for key := range filter {
		if key != "roll" && key != "result" {
			return nil, true
		}
	}
	return true, true
}
