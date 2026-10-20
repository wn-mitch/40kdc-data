package wh40kdc

import "strings"

// Scenario state the caller declares on the engine context. Every fact is
// optional: an absent key leaves the condition or filter that reads it unknown
// (nil), while a supplied list is complete, so an empty list is a known "none".
//
//	attackerTurn                         bool: it is the attacking unit's player's turn
//	attackerStrength, targetStrength     "full" | "below-starting" | "below-half"
//	attackerWounds, targetWounds         {remaining, starting} of the damaged (or only) model
//	attackerDesignations, targetDesignations  []string, matched case-insensitively
//	attackerStates, targetStates         []string of "engaged" | "battle-shocked" | "hidden"
//	targetClosest                        bool: the target is the closest eligible target
//	attackerObjectives, targetObjectives []{controller, designations, role, homeOf, territory, name};
//	                                     controller/homeOf/territory name "attacker" or "target"

// listedStates are the unit states the context lists per unit; the rest are
// fixed for a unit in an attack, or unknown.
var listedStates = map[string]bool{"engaged": true, "battle-shocked": true, "hidden": true}

// conditionSide names which unit of the attack a condition's subject is
// ("attacker" or "target"), or "" for another unit.
func conditionSide(subject any, perspective string) string {
	switch subject {
	case "defender":
		return "target"
	case "attacker":
		return "attacker"
	}
	if isBuffedUnit(subject) {
		if perspective == "attacker" {
			return "attacker"
		}
		return "target"
	}
	return ""
}

// perspectiveSide is the side whose ability is being evaluated.
func perspectiveSide(perspective string) string {
	if perspective == "attacker" {
		return "attacker"
	}
	return "target"
}

// otherSide is the opposing side of an attack.
func otherSide(side string) string {
	if side == "attacker" {
		return "target"
	}
	return "attacker"
}

// evaluateScenarioCondition evaluates the conditions read from declared
// scenario state. It returns bool, or nil for "unknown".
func evaluateScenarioCondition(kind string, params, ctx map[string]any, perspective string) any {
	switch kind {
	case "battle-round":
		round, ok := contextNumber(ctx["battleRound"])
		if !ok {
			return nil
		}
		if minimum, ok := contextNumber(params["min"]); ok && round < minimum {
			return false
		}
		if maximum, ok := contextNumber(params["max"]); ok && round > maximum {
			return false
		}
		return true
	case "player-turn-is":
		// "Your turn" is the turn of the player whose ability it is.
		turn := params["turn"]
		attackerTurn, known := ctx["attackerTurn"].(bool)
		if (turn != "your-turn" && turn != "opponent-turn") || !known {
			return nil
		}
		yours := attackerTurn
		if perspective != "attacker" {
			yours = !attackerTurn
		}
		if turn == "your-turn" {
			return yours
		}
		return !yours
	case "strength":
		strength, known := sideValue(ctx, conditionSide(params["subject"], perspective), "Strength").(string)
		below := params["below"]
		if !known || (below != "starting" && below != "half") {
			return nil
		}
		if below == "half" {
			return strength == "below-half"
		}
		return strength != "full"
	case "wounds":
		// Each listed property must hold; the Damaged bracket needs datasheet data the context lacks.
		wounds, known := asMap(sideValue(ctx, conditionSide(params["subject"], perspective), "Wounds"))
		if !known || wounds == nil {
			return nil
		}
		remaining, remainingKnown := contextNumber(wounds["remaining"])
		starting, startingKnown := contextNumber(wounds["starting"])
		if !remainingKnown || !startingKnown {
			return nil
		}
		_, unknown := params["damaged"]
		if params["lost"] == true && remaining >= starting {
			return false
		}
		if rawMax, present := params["remaining_max"]; present {
			if maximum, ok := contextNumber(rawMax); !ok {
				unknown = true
			} else if remaining > maximum {
				return false
			}
		}
		if unknown {
			return nil
		}
		return true
	case "closest":
		// Only "the target is the closest eligible target to the attacker" is in the context.
		to, toPresent := params["to"]
		toAttacker := !toPresent || to == "attacker" || (perspective == "attacker" && isBuffedUnit(to))
		if conditionSide(params["subject"], perspective) != "target" || params["among"] != "eligible-targets" || !toAttacker {
			return nil
		}
		closest, known := ctx["targetClosest"].(bool)
		if !known {
			return nil
		}
		if !closest {
			return false
		}
		rawRange, present := params["range"]
		if !present {
			return true
		}
		rangeRef, ok := asMap(rawRange)
		if !ok || rangeRef == nil {
			return nil
		}
		inches, inchesKnown := filterNumber(rangeRef["inches"])
		distance, distanceKnown := filterNumber(ctx["distanceInches"])
		if !inchesKnown || !distanceKnown {
			return nil
		}
		return distance <= inches
	}
	return nil
}

// sideValue reads the `attacker<suffix>` or `target<suffix>` context key for a
// side, or nil when the side is not a unit of the attack.
func sideValue(ctx map[string]any, side, suffix string) any {
	switch side {
	case "attacker", "target":
		return ctx[side+suffix]
	}
	return nil
}

// matchesStateFilter evaluates a unit filter's `state` value other than
// benefit-of-cover: true, false, or nil for unknown.
func matchesStateFilter(value any, ctx map[string]any, side string) any {
	switch value {
	case "on-battlefield":
		// Both units of an attack are on the battlefield.
		return true
	case "in-strategic-reserves", "in-cult-ambush":
		return false
	}
	state, ok := value.(string)
	if !ok || !listedStates[state] {
		return nil
	}
	states, known := asList(sideValue(ctx, side, "States"))
	if !known {
		return nil
	}
	for _, listed := range states {
		if listed == state {
			return true
		}
	}
	return false
}

// matchesDesignatedFilter evaluates a unit filter's `designated` value against
// the unit's complete designation list: true, false, or nil for unknown.
func matchesDesignatedFilter(wanted string, ctx map[string]any, side string) any {
	designations, known := asList(sideValue(ctx, side, "Designations"))
	if !known {
		return nil
	}
	return containsFold(designations, wanted)
}

// containsFold reports whether a list holds a string equal to wanted, ignoring case.
func containsFold(items []any, wanted string) bool {
	for _, item := range items {
		if text, ok := item.(string); ok && strings.EqualFold(text, wanted) {
			return true
		}
	}
	return false
}

// objectiveWithin reports whether a `within` value names an objective (the
// `of.objective` form), returning that objective filter.
func objectiveWithin(within map[string]any) (map[string]any, bool) {
	of, ok := asMap(within["of"])
	if !ok || of == nil {
		return nil, false
	}
	objective, ok := asMap(of["objective"])
	return objective, ok && objective != nil
}

// withinObjective reports whether one of the unit's objectives meets every
// property of an objective filter. Ownership and territory are read from the
// ability's side. It returns true, false, or nil for unknown.
func withinObjective(filter map[string]any, rawObjectives any, abilitySide string) any {
	objectives, known := asList(rawObjectives)
	if !known {
		return nil
	}
	other := otherSide(abilitySide)
	sideOf := func(relative any) string {
		switch relative {
		case "friendly":
			return abilitySide
		case "enemy":
			return other
		}
		return ""
	}
	unknown := false
	for _, rawObjective := range objectives {
		objective, _ := asMap(rawObjective)
		var verdict any = true
		for key, wanted := range filter {
			var holds any
			switch key {
			case "controlled_by":
				controller, present := objective["controller"]
				switch {
				case !present:
					holds = nil
				case wanted == "any":
					holds = controller != "none"
				case sideOf(wanted) == "":
					holds = nil
				default:
					holds = controller == sideOf(wanted)
				}
			case "designated":
				text, isText := wanted.(string)
				designations, present := asList(objective["designations"])
				if !isText || !present {
					holds = nil
				} else {
					holds = containsFold(designations, text)
				}
			case "role":
				holds = presentEquals(objective, "role", wanted)
			case "home_of":
				if sideOf(wanted) == "" {
					holds = nil
				} else {
					holds = presentEquals(objective, "homeOf", sideOf(wanted))
				}
			case "territory":
				territory := ""
				switch wanted {
				case "your-territory":
					territory = abilitySide
				case "enemy-territory":
					territory = other
				case "no-mans-land":
					territory = "no-mans-land"
				}
				if territory == "" {
					holds = nil
				} else {
					holds = presentEquals(objective, "territory", territory)
				}
			case "name":
				holds = presentEquals(objective, "name", wanted)
			}
			if holds == false {
				verdict = false
				break
			}
			if holds == nil {
				verdict = nil
			}
		}
		if verdict == true {
			return true
		}
		if verdict == nil {
			unknown = true
		}
	}
	if unknown {
		return nil
	}
	return false
}

// presentEquals compares an objective field with a wanted value, or returns nil
// when the objective leaves the field out.
func presentEquals(objective map[string]any, key string, wanted any) any {
	actual, present := objective[key]
	if !present {
		return nil
	}
	switch wanted.(type) {
	case map[string]any, []any:
		return false
	}
	switch actual.(type) {
	case map[string]any, []any:
		return false
	}
	return actual == wanted
}
