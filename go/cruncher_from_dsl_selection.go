package wh40kdc

import "strings"

// Unit selections and other player-vouched choices as levers. A select-units
// effect whose nested effect reaches the selected-unit is a choice the player
// makes on the table: which unit is picked, whether the range and visibility
// hold, and whether a gating roll succeeded are not known to the cruncher. The
// translator offers the selection's buffs as one opt-in lever on the unit the
// selection can reach, and records what the player vouches for in the lever's
// `requires`. Mirror of tools/src/cruncher/from-dsl-selection.ts plus
// translateSelection, offerLever, isProvidedByAnotherUnit and
// friendlyFilterExcludes from tools/src/cruncher/from-dsl.ts.

const selectedUnit = "selected-unit"

// providerTargets are the self targets that, in an ability another unit
// provides, name that provider.
var providerTargets = map[string]bool{"this-unit": true, "ability-unit": true, "this-model": true}

// selectionPlan is what a selection contributes to the crunched unit. kind is
// "none" (not a selection lever), "skip" (nothing reaches the crunched unit),
// "unsupported" (reason set) or "lever".
type selectionPlan struct {
	kind          string
	reason        string
	effect        any
	applicability map[string]any
	requires      []any
	label         string
}

// planSelection plans a select-units node for the crunched unit under
// perspective. A friendly selection reaches the crunched unit when its keywords
// match the selector; when the eligibility excludes the ability's own unit, the
// lever exists only when another unit provides the ability (abilityKind
// "support"). An enemy selection reaches the other side of the attack. A
// top-level dice gate with no failure branch becomes the lever's content; its
// roll joins requires.
func planSelection(node, source map[string]any, perspective string, context map[string]any) selectionPlan {
	selector, ok := node["selector"].(map[string]any)
	if !ok {
		return selectionPlan{kind: "none"}
	}
	filter, ok := selector["filter"].(map[string]any)
	if !ok || (filter["owner"] != "friendly" && filter["owner"] != "enemy") {
		return selectionPlan{kind: "none"}
	}
	if filter["level"] == "model" || filter["model_names"] != nil || selector["bind_as"] != nil {
		return selectionPlan{kind: "none"}
	}
	keywords, keywordsOK := selectorKeywordList(filter["all_of"])
	anyKeywords, anyOK := selectorKeywordList(filter["any_of"])
	excluded, excludedOK := selectorKeywordList(filter["none_of"])
	if (filter["all_of"] != nil && !keywordsOK) || (filter["any_of"] != nil && !anyOK) || (filter["none_of"] != nil && !excludedOK) {
		return selectionPlan{kind: "unsupported", reason: "select-units: the selector's keyword lists are malformed"}
	}
	if len(anyKeywords) > 0 {
		// The buff gate can represent one required keyword, not an arbitrary
		// OR predicate on an enemy selector.
		if filter["owner"] == "enemy" {
			return selectionPlan{kind: "unsupported", reason: "select-units: any_of keyword selectors are not gated by the buff layer"}
		}
	}
	selection := make(map[string]any, len(node))
	for k, v := range node {
		if k != "effect" {
			selection[k] = v
		}
	}
	requires := []any{selection}

	var effect any
	var applicability map[string]any
	var label string
	if filter["owner"] == "friendly" {
		provided := getStr(source, "kind") == "ability" && getStr(source, "abilityKind") == "support"
		if excludesAbilityUnit(selector["eligibility"]) && !provided {
			return selectionPlan{kind: "skip"}
		}
		hasKeywords := len(keywords) > 0 || len(anyKeywords) > 0 || len(excluded) > 0
		if hasKeywords {
			key := "targetKeywords"
			if perspective == "attacker" {
				key = "attackerKeywords"
			}
			ownRaw, present := context[key]
			if !present || ownRaw == nil {
				return selectionPlan{kind: "unsupported", reason: "select-units: the crunched unit's keywords are unavailable for the selector"}
			}
			own := getList(context, key)
			for _, k := range keywords {
				if !includesKeyword(own, k) {
					return selectionPlan{kind: "skip"}
				}
			}
			if len(anyKeywords) > 0 {
				found := false
				for _, k := range anyKeywords {
					if includesKeyword(own, k) {
						found = true
						break
					}
				}
				if !found {
					return selectionPlan{kind: "skip"}
				}
			}
			for _, k := range excluded {
				if includesKeyword(own, k) {
					return selectionPlan{kind: "skip"}
				}
			}
		}
		if filter["not_all_of"] != nil {
			return selectionPlan{kind: "unsupported", reason: "select-units: not_all_of keyword selectors are not gated by the buff layer"}
		}
		effect = node["effect"]
		label = "Selected unit"
	} else {
		other := "attacker"
		if perspective == "attacker" {
			other = "defender"
		}
		if filter["not_all_of"] != nil {
			return selectionPlan{kind: "unsupported", reason: "select-units: not_all_of keyword selectors are not gated by the buff layer"}
		}
		gate, reason := selectedEnemyGate(keywords, excluded, perspective)
		if reason != "" {
			return selectionPlan{kind: "unsupported", reason: reason}
		}
		applicability = gate
		effect = retargetSelected(node["effect"], other)
		label = "Selected enemy unit"
	}

	if gated, ok := effect.(map[string]any); ok && gated["type"] == "dice-gated" {
		if gated["on_fail"] != nil {
			return selectionPlan{kind: "unsupported", reason: "select-units: a dice gate with a failure branch is not a single lever"}
		}
		roll := make(map[string]any, len(gated))
		for k, v := range gated {
			if k != "on_success" && k != "on_fail" {
				roll[k] = v
			}
		}
		requires = append(requires, roll)
		effect = gated["on_success"]
	}
	return selectionPlan{kind: "lever", effect: effect, applicability: applicability, requires: requires, label: label}
}
func bindEachRecipient(effect any, filter map[string]any) any {
	switch value := effect.(type) {
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			out[i] = bindEachRecipient(item, filter)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(value))
		for key, child := range value {
			if key == "target" && child == "recipient" {
				level := getStr(filter, "level")
				if level == "model" {
					out[key] = "this-model"
				} else {
					out[key] = "this-unit"
				}
			} else {
				out[key] = bindEachRecipient(child, filter)
			}
		}
		return out
	default:
		return effect
	}
}

func matchesEachRecipient(filter map[string]any, context map[string]any, perspective string) (bool, string) {
	owner := getStr(filter, "owner")
	keywordsKey := "targetKeywords"
	roleKey := "targetAttachmentRole"
	if perspective == "attacker" {
		keywordsKey = "attackerKeywords"
		roleKey = "attackerAttachmentRole"
	}
	if owner == "enemy" {
		if keywordsKey == "attackerKeywords" {
			keywordsKey, roleKey = "targetKeywords", "targetAttachmentRole"
		} else {
			keywordsKey, roleKey = "attackerKeywords", "attackerAttachmentRole"
		}
	}
	if ids, present := asList(filter["unit_ids"]); present {
		idKey := "targetUnitId"
		if keywordsKey == "attackerKeywords" {
			idKey = "attackerUnitId"
		}
		actual := getStr(context, idKey)
		if actual == "" {
			return false, "for-each-unit unit ID is unavailable"
		}
		for _, raw := range ids {
			if id, ok := raw.(string); ok && id == actual {
				return true, ""
			}
		}
		return false, ""
	}
	filterCopy := cloneMap(filter)
	delete(filterCopy, "owner")
	if role := getStr(filterCopy, "attachment_role"); role != "" {
		actual, ok := context[roleKey].(string)
		if !ok || actual == "" {
			return false, "for-each-unit attachment role is unavailable"
		}
		if actual != role {
			return false, ""
		}
	}
	if keywords := context[keywordsKey]; keywords != nil {
		matchPerspective := "target"
		if keywordsKey == "attackerKeywords" {
			matchPerspective = "attacker"
		}
		matched, reason := auraRecipientFilterMatches(filterCopy, context, matchPerspective)
		return matched, reason
	}
	if filterCopy["all_of"] != nil || filterCopy["any_of"] != nil || filterCopy["none_of"] != nil || filterCopy["not_all_of"] != nil {
		return false, "for-each-unit recipient keywords are unavailable"
	}
	return true, ""
}

// selectedEnemyGate is the keyword gate an enemy selector puts on the selected
// unit, or a reason the buff layer cannot express it.
func selectedEnemyGate(keywords, excluded []string, perspective string) (map[string]any, string) {
	out := map[string]any{}
	if len(keywords) > 0 {
		if len(keywords) > 1 {
			return nil, "select-units: more than one required keyword on the selected enemy unit is not gated by the buff layer"
		}
		if perspective == "attacker" {
			out["requiresTargetKeyword"] = keywords[0]
		} else {
			out["requiresAttackerKeyword"] = keywords[0]
		}
	}
	if len(excluded) > 0 {
		if perspective != "attacker" {
			return nil, "select-units: excluded keywords on the attacking unit are not gated by the buff layer"
		}
		list := make([]any, len(excluded))
		for i, k := range excluded {
			list[i] = k
		}
		out["excludedTargetKeywords"] = list
	}
	if len(out) == 0 {
		return nil, ""
	}
	return out, ""
}

// referencesSelectedUnit reports whether the effect names the selected unit as a
// target anywhere, outside a nested selection.
func referencesSelectedUnit(node any) bool {
	switch n := node.(type) {
	case []any:
		for _, child := range n {
			if referencesSelectedUnit(child) {
				return true
			}
		}
		return false
	case map[string]any:
		if n["type"] == "select-units" {
			return false
		}
		if n["target"] == selectedUnit {
			return true
		}
		for k, v := range n {
			if k != "target" && referencesSelectedUnit(v) {
				return true
			}
		}
	}
	return false
}

// retargetSelected copies the effect with each selected-unit target replaced,
// leaving nested selections alone.
func retargetSelected(node any, target string) any {
	switch n := node.(type) {
	case []any:
		out := make([]any, len(n))
		for i, child := range n {
			out[i] = retargetSelected(child, target)
		}
		return out
	case map[string]any:
		if n["type"] == "select-units" {
			return n
		}
		out := make(map[string]any, len(n))
		for k, v := range n {
			if k == "target" && v == selectedUnit {
				out[k] = target
			} else {
				out[k] = retargetSelected(v, target)
			}
		}
		return out
	}
	return node
}

// excludesAbilityUnit reports whether the eligibility forbids selecting the
// unit holding the ability (`not same-unit ability-unit`).
func excludesAbilityUnit(raw any) bool {
	condition, ok := raw.(map[string]any)
	if !ok {
		return false
	}
	operands, isList := condition["operands"].([]any)
	if condition["operator"] == "not" && isList {
		for _, operandAny := range operands {
			operand, ok := operandAny.(map[string]any)
			if !ok || operand["type"] != "same-unit" {
				continue
			}
			if params, ok := operand["parameters"].(map[string]any); ok && params["as"] == "ability-unit" {
				return true
			}
		}
		return false
	}
	if condition["operator"] == "and" && isList {
		for _, operand := range operands {
			if excludesAbilityUnit(operand) {
				return true
			}
		}
	}
	return false
}

// selectorKeywordList returns raw as a list of non-empty strings; ok is false otherwise.
func selectorKeywordList(raw any) ([]string, bool) {
	list, ok := raw.([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		s, ok := item.(string)
		if !ok || s == "" {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

func includesKeyword(keywords []any, keyword string) bool {
	want := strings.ToLower(keyword)
	for _, candidate := range keywords {
		if s, ok := candidate.(string); ok && strings.ToLower(s) == want {
			return true
		}
	}
	return false
}

// translateSelection offers a planned unit selection as one lever, gated on the
// selected unit's keywords, with the selection (and any roll) in requires.
func translateSelection(plan selectionPlan, node, source map[string]any, opts dslOpts, out *effectTranslation) {
	switch plan.kind {
	case "skip", "none":
		return
	case "unsupported":
		out.unsupported = append(out.unsupported, unsup(plan.reason, node))
		return
	}
	offerLever(plan.effect, source, opts, out, leverSpec{id: opts.abilityID + "#selected", label: plan.label, requires: plan.requires, applicability: plan.applicability})
}

// leverSpec names the lever offerLever builds.
type leverSpec struct {
	id, label     string
	requires      []any
	applicability map[string]any
}

// offerLever translates effect and offers what it gives the crunched unit as
// one opt-in lever that requires lever.requires. Levers nested in the effect
// keep their own choice and add those requirements to theirs;
// lever.applicability gates every buff.
func offerLever(effect any, source map[string]any, opts dslOpts, out *effectTranslation, lever leverSpec) {
	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(effect, source, opts, sub)
	gate := func(bAny any) any {
		b, _ := asMap(bAny)
		if lever.applicability == nil {
			return b
		}
		return applyApplicability(b, lever.applicability)
	}
	out.unsupported = append(out.unsupported, sub.unsupported...)
	for _, nestedAny := range sub.activatable {
		nested, _ := asMap(nestedAny)
		act := cloneMap(nested)
		buffs := []any{}
		for _, b := range getList(nested, "buffs") {
			buffs = append(buffs, gate(b))
		}
		act["buffs"] = buffs
		act["requires"] = append(append([]any{}, lever.requires...), getList(nested, "requires")...)
		out.activatable = append(out.activatable, act)
	}
	if len(sub.applied) > 0 {
		buffs := make([]any, len(sub.applied))
		for i, b := range sub.applied {
			buffs[i] = gate(b)
		}
		out.activatable = append(out.activatable, map[string]any{
			"id":       lever.id,
			"label":    lever.label + ": " + labelForBuffs(buffs),
			"buffs":    buffs,
			"requires": lever.requires,
		})
	}
}

func isProvidedByAnotherUnit(source map[string]any) bool {
	return getStr(source, "kind") == "ability" && getStr(source, "abilityKind") == "support"
}

// friendlyFilterExcludes reports whether a friendly unit-filter target names
// keywords the crunched unit lacks. Only the plain keyword fields are read; a
// filter of alternatives is left to alternativesMatch, and a missing keyword
// list keeps the filter permissive.
func friendlyFilterExcludes(node map[string]any, opts dslOpts) bool {
	target, ok := node["target"].(map[string]any)
	if !ok || target["owner"] != "friendly" {
		return false
	}
	if _, alternatives := target["any_of_filters"].([]any); alternatives {
		return false
	}
	key := "targetKeywords"
	if opts.perspective == "attacker" {
		key = "attackerKeywords"
	}
	if _, ok := selectorKeywordList(opts.context[key]); !ok {
		return false
	}
	keywords := getList(opts.context, key)
	allOf, _ := selectorKeywordList(target["all_of"])
	anyOf, hasAny := selectorKeywordList(target["any_of"])
	noneOf, _ := selectorKeywordList(target["none_of"])
	for _, k := range allOf {
		if !includesKeyword(keywords, k) {
			return true
		}
	}
	if hasAny {
		matched := false
		for _, k := range anyOf {
			if includesKeyword(keywords, k) {
				matched = true
			}
		}
		if !matched {
			return true
		}
	}
	for _, k := range noneOf {
		if includesKeyword(keywords, k) {
			return true
		}
	}
	return false
}

// eventSubject is the unit-ref naming the unit whose action fired the enclosing trigger.
const eventSubject = "event-subject"

// otherUnit is the internal binding for an event subject that is another unit, so the
// effect never reaches the buffed unit.
const otherUnit = "other-unit"

// ownedMoments are the moments a unit makes itself; one that names no subject is the
// ability's own unit's (the DSL's default).
var ownedMoments = map[string]bool{
	"selected": true, "move-started": true, "move-ended": true, "targets-selected": true, "attacks-resolved": true,
}

// triggerSubject is who acts in a trigger: its subject, else `this-unit` for a unit's
// own moment; clock and destruction events have none. Mirror of triggerSubject in
// tools/src/cruncher/from-dsl-selection.ts.
func triggerSubject(trigger map[string]any) any {
	if subject := trigger["subject"]; subject != nil {
		return subject
	}
	if event, ok := trigger["event"].(string); ok && ownedMoments[event] {
		return "this-unit"
	}
	return nil
}

// bindEventSubject binds `event-subject` effects when the trigger says who acts.
// `this-unit` names the ability's own unit, as does an absent subject on a unit's own
// moment (triggerSubject). A friendly unit filter the buffed unit matches names the
// buffed unit; one it fails names another unit. Seen from the target, an enemy unit
// filter the attacker matches names the attacker (the enemy whose action fired the
// trigger is the one attacking); one it fails names another unit. The binding is left
// in place when a clock or destruction event names no subject, an enemy seen from
// the attacker, differs across alternative triggers, or cannot be checked, so the
// translator reports it. A nested ability part with its own trigger binds its own
// subject. changed reports whether any
// target was rebound. Mirror of bindEventSubject in
// tools/src/cruncher/from-dsl-selection.ts.
func bindEventSubject(trigger, effect any, context map[string]any, perspective string) (any, bool) {
	var triggers []map[string]any
	items, isList := asList(trigger)
	if !isList {
		items = []any{trigger}
	}
	for _, item := range items {
		if m, ok := item.(map[string]any); ok && m != nil {
			triggers = append(triggers, m)
		}
	}
	if len(triggers) == 0 {
		return effect, false
	}
	subject := triggerSubject(triggers[0])
	for _, item := range triggers {
		if !jsonEqual(triggerSubject(item), subject) {
			return effect, false
		}
	}
	if subject == "this-unit" {
		return rebindEventSubject(effect, "this-unit")
	}
	filter, ok := subject.(map[string]any)
	if ok && filter != nil && filter["owner"] == "enemy" && perspective == "target" {
		switch matchesUnitFilter(filter, context, "attacker", "enemy") {
		case true:
			return rebindEventSubject(effect, "attacker")
		case false:
			return rebindEventSubject(effect, otherUnit)
		default:
			return effect, false
		}
	}
	if !ok || filter == nil || filter["owner"] != "friendly" {
		return effect, false
	}
	side := "target"
	if perspective == "attacker" {
		side = "attacker"
	}
	switch matchesUnitFilter(filter, context, side, "friendly") {
	case true:
		// `selected-unit`, not `this-unit`: in a supporting unit's ability `this-unit` names the provider.
		return rebindEventSubject(effect, selectedUnit)
	case false:
		return rebindEventSubject(effect, otherUnit)
	default:
		return effect, false
	}
}

// rebindEventSubject rewrites every `event-subject` target to `to`, returning node
// itself and false when it holds none to rebind.
func rebindEventSubject(node any, to string) (any, bool) {
	switch value := node.(type) {
	case []any:
		out := make([]any, len(value))
		changed := false
		for i, child := range value {
			bound, childChanged := rebindEventSubject(child, to)
			out[i] = bound
			changed = changed || childChanged
		}
		if !changed {
			return node, false
		}
		return out, true
	case map[string]any:
		if value == nil || (value["type"] == "ability-part" && value["trigger"] != nil) {
			return node, false
		}
		out := make(map[string]any, len(value))
		changed := false
		for key, child := range value {
			if key == "target" && child == eventSubject {
				out[key] = to
				changed = true
				continue
			}
			bound, childChanged := rebindEventSubject(child, to)
			out[key] = bound
			changed = changed || childChanged
		}
		if !changed {
			return node, false
		}
		return out, true
	default:
		return node, false
	}
}
