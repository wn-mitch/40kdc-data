package wh40kdc

import (
	"math"
	"reflect"
	"strconv"
	"strings"
)

// Translate an Ability DSL effect tree into the Buff stack it contributes,
// plus the fragments it could not auto-apply (unsupported) and player-decision
// levers (activatable). Go mirror of python .../cruncher/from_dsl.py. Applied
// order and unsupported-reason strings are pinned by
// conformance/abilities-resolver/from-dsl.json / defensive-from-dsl.json.

var selfTargets = map[string]bool{
	"this-unit": true, "ability-unit": true, "this-model": true, "selected-unit": true, "recipient": true,
}

// modelTargets are the unit-refs naming a single *model* (the bearer, or one model
// of the unit) rather than its unit. Core rule 19.04: a rule affecting one
// specified model applies only to that model, even while it is part of an
// attached unit.
var modelTargets = map[string]bool{"this-model": true, "model-in-this-unit": true}

// modelScopedReason is the diagnostic for a model-scoped effect pooled in from an
// attached member.
const modelScopedReason = "model-scoped effect from an attached model: applies to that model only (core rule 19.04)"

const stochasticDiceGatedReason = "dice-gated effect: stochastic; not expressible as a buff"

var defenderTargets = map[string]bool{"defender": true}

type effectTranslation struct {
	applied     []any
	unsupported []any
	activatable []any
}

type dslOpts struct {
	context       map[string]any
	perspective   string
	abilityID     string
	defaultTarget string
	grantedHolder bool
	duration      any
}

// effectToBuffs walks an ability DSL effect tree, producing the buff stack plus
// unsupported and activatable lists. An optional activation record preserves
// the source usage/cost metadata on every opt-in lever.
func effectToBuffs(effect any, source map[string]any, context map[string]any, perspective string, activation ...map[string]any) *effectTranslation {
	out := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	if recipientSnapshotUnavailable(nil, effect) {
		resolved, reason := resolveRecipientSnapshots(nil, effect, source, context, perspective)
		if reason != "" {
			out.unsupported = append(out.unsupported, unsup(reason, effect))
			return out
		}
		effect = resolved
	}
	effect = resolveNamedWeaponBindings(effect)
	abilityID := "effect"
	if getStr(source, "kind") == "ability" {
		if a := getStr(source, "abilityId"); a != "" {
			abilityID = a
		}
	}
	var act map[string]any
	if len(activation) > 0 {
		act = activation[0]
	}
	opts := dslOpts{context: context, perspective: perspective, abilityID: abilityID}
	if act != nil {
		opts.duration = act["duration"]
	}
	dslWalk(effect, source, opts, out)
	if act == nil || (act["usage"] == nil && act["cost"] == nil && act["optional"] != true) {
		return out
	}
	requirement := cloneMap(act)
	delete(requirement, "duration")
	requires := []any{requirement}
	var counts []float64
	for _, raw := range getListValue(act["usage"]) {
		limit, ok := asMap(raw)
		if !ok || limit == nil || limit["per"] == "model" {
			continue
		}
		if n, ok := num(limit["count"]); ok {
			counts = append(counts, n)
		} else if limit["frequency"] != "n-per-battle" {
			counts = append(counts, 1)
		}
	}
	if limit, ok := asMap(act["usage"]); ok && limit != nil && len(getListValue(act["usage"])) == 0 && limit["per"] != "model" {
		if n, ok := num(limit["count"]); ok {
			counts = append(counts, n)
		} else if limit["frequency"] != "n-per-battle" {
			counts = append(counts, 1)
		}
	}
	var group map[string]any
	if len(counts) > 0 {
		min := counts[0]
		for _, n := range counts[1:] {
			if n < min {
				min = n
			}
		}
		group = map[string]any{"id": abilityID + "?usage", "maxActivations": min}
	}
	if len(out.applied) > 0 {
		out.activatable = append(out.activatable, map[string]any{
			"id": abilityID + "#activate", "label": labelForBuffs(out.applied),
			"buffs": append([]any(nil), out.applied...), "group": group,
		})
		out.applied = []any{}
	}
	for _, raw := range out.activatable {
		lever, ok := asMap(raw)
		if !ok || lever == nil {
			continue
		}
		if group != nil {
			if existing, _ := getMap(lever, "group"); existing == nil {
				lever["group"] = group
			} else if getStr(existing, "id") != getStr(group, "id") {
				lever["groups"] = append(getList(lever, "groups"), group)
			}
		}
		lever["requires"] = append(append([]any{}, requires...), getList(lever, "requires")...)
	}
	return out
}

// isModelScopedFromAttachedMember reports whether this node is a model-scoped
// effect reaching the buffed unit from *another* member of the combined unit.
// Core rule 19.04 keeps those on their own model: an attached Librarian's
// personal 4+ invulnerable save is not a 4+ invulnerable save for the ten
// Intercessors it joined.
//
// Keyed on the buff source, not on the DSL condition — the leak is not limited to
// abilities whose target filter mentions attachment membership.
// An ability read as the chosen unit's own (abilityKind "unit") is unaffected.
func isModelScopedFromAttachedMember(node map[string]any, source map[string]any) bool {
	if getStr(source, "kind") != "ability" || getStr(source, "abilityKind") != "attached" {
		return false
	}
	return modelTargets[getStr(node, "target")]
}

// unresolvedTargets are the unit-refs that name a unit the buff layer cannot
// identify with the buffed unit.
var unresolvedTargets = map[string]bool{"event-subject": true, "event-object": true, "stratagem-target": true, "bearer-transport": true}

func dslWalk(node any, source map[string]any, opts dslOpts, out *effectTranslation) {
	n, ok := asMap(node)
	if !ok || n == nil {
		return
	}
	if _, has := n["target"]; opts.defaultTarget != "" && !has {
		withTarget := make(map[string]any, len(n)+1)
		for k, v := range n {
			withTarget[k] = v
		}
		withTarget["target"] = opts.defaultTarget
		n = withTarget
	}
	// Core rule 19.04 gate, applied before leaf translation on both perspectives.
	if isModelScopedFromAttachedMember(n, source) {
		out.unsupported = append(out.unsupported, unsup(modelScopedReason, n))
		return
	}
	if n["target"] == "model-in-this-unit" {
		out.unsupported = append(out.unsupported, unsup("model-in-this-unit: individual model identity is unresolved", n))
		return
	}
	// An ability grant reports its own unresolved holders.
	if t, ok := n["target"].(string); ok && unresolvedTargets[t] && n["type"] != "ability-grant" {
		out.unsupported = append(out.unsupported, unsup("target \""+t+"\" is not resolved by the buff engine", n))
		return
	}
	if n["type"] == "select-units" {
		if plan := planSelection(n, source, opts.perspective, opts.context); plan.kind != "none" {
			translateSelection(plan, n, source, opts, out)
			return
		}
	}
	if n["type"] == "for-each-unit" {
		selector, _ := getMap(n, "selector")
		filter, _ := getMap(selector, "filter")
		if filter == nil {
			out.unsupported = append(out.unsupported, unsup("for-each-unit: recipient filter is malformed", n))
			return
		}
		dslWalk(bindEachRecipient(n["effect"], filter), source, opts, out)
		return
	}
	// Unit-filter targets are board facts, not merely keyword hints.
	if filter, ok := asMap(n["target"]); ok && filter != nil {
		side := opts.perspective
		if filter["member_of"] == "attacker" {
			side = "attacker"
		} else if filter["member_of"] == "defender" || filter["owner"] == "enemy" {
			side = "target"
		}
		owner := "friendly"
		if filter["owner"] == "enemy" {
			owner = "enemy"
		}
		switch verdict := matchesUnitFilter(filter, opts.context, side, owner); verdict {
		case false:
			return
		case nil:
			out.unsupported = append(out.unsupported, unsup("unit-filter target: identity, state or model membership is unresolved", n))
			return
		}
	}
	if hasUnresolvedFidelityBinding(n) {
		out.unsupported = append(out.unsupported, unsup(fidelityBindingReason, n))
		return
	}
	// A scaled or bound value (a count on the board, the battle size, a bound roll) has no fixed size here:
	// applying the printed value would over- or under-state it.
	if reason := unsizedValueReason(n); reason != "" {
		// A capped scaling ("+2 A per embarked model, to a maximum of +22") is a lever at its cap;
		// the player vouches for the count that reaches it.
		if atCap := scaledToCap(n); atCap != nil {
			offerLever(atCap, source, opts, out, leverSpec{id: opts.abilityID + "#at-cap", label: "At its maximum", requires: []any{n["scaling"]}})
			return
		}
		out.unsupported = append(out.unsupported, unsup(reason, n))
		return
	}
	// An ability another unit provides reaches the crunched unit only through a friendly filter,
	// an aura's recipient or a selection; its own unit and model are the provider, not the
	// crunched unit.
	if t, ok := n["target"].(string); ok && isProvidedByAnotherUnit(source) && providerTargets[t] {
		return
	}
	// An `incoming` change modifies attacks made against its target. On the buffed unit it is the
	// attacker's side of those attacks, which the `target: "attacker"` form already models; it never
	// modifies the buffed unit's own attacks.
	// On the defender it changes every friendly attack against that unit, the buffed unit's among
	// them, so the attacker perspective reads it as a change for friendly units; the target
	// perspective has no such attack.
	if m, ok := getMap(n, "modifier"); ok && m != nil && m["incoming"] == true && classifyTarget(n) == "defender" {
		if opts.perspective != "attacker" {
			return
		}
		stripped := make(map[string]any, len(m))
		for k, v := range m {
			if k != "incoming" {
				stripped[k] = v
			}
		}
		redirected := cloneMap(n)
		redirected["target"] = map[string]any{"owner": "friendly"}
		redirected["modifier"] = stripped
		dslWalk(redirected, source, opts, out)
		return
	}
	if m, ok := getMap(n, "modifier"); ok && m != nil && m["incoming"] == true && classifyTarget(n) == "self" {
		if opts.perspective == "attacker" {
			return
		}
		if n["type"] == "roll-modifier" || n["type"] == "stat-modifier" {
			stripped := make(map[string]any, len(m))
			for k, v := range m {
				if k != "incoming" {
					stripped[k] = v
				}
			}
			redirected := make(map[string]any, len(n))
			for k, v := range n {
				redirected[k] = v
			}
			redirected["target"] = "attacker"
			redirected["modifier"] = stripped
			dslWalk(redirected, source, opts, out)
		} else {
			out.unsupported = append(out.unsupported, unsup(jsStr(n["type"])+": an incoming change to attacks against the unit is not modelled", n))
		}
		return
	}
	switch getStr(n, "type") {
	case "re-roll":
		translateReroll(n, source, opts, out)
	case "roll-modifier":
		translateRollModifier(n, source, opts, out)
	case "stat-modifier":
		translateStatModifier(n, source, opts, out)
	case "feel-no-pain":
		translateFeelNoPain(n, source, opts, out)
	case "weapon-ability-grant":
		translateKeywordGrant(n, source, opts, out)
	case "keyword-grant":
		out.unsupported = append(out.unsupported, unsup("effect type \"keyword-grant\" is not modelled by the buff layer", n))
	case "damage-reduction":
		translateDamageReduction(n, source, opts, out)
	case "invulnerable-save":
		translateInvulnerableSave(n, source, opts, out)
	case "named-region-state":
		translateNamedRegionState(n, source, opts, out)
	case "conditional":
		translateConditional(n, source, opts, out)
	case "rules-bundle", "sequence":
		for _, step := range getList(n, "steps") {
			dslWalk(step, source, opts, out)
		}
	case "ability-part":
		partOpts := opts
		if n["duration"] != nil {
			partOpts.duration = n["duration"]
		}
		// Orders are issued at their own moment and last for the part's duration: each Order is a
		// lever for the attacks made while it lasts, as a stance option is.
		if effect, ok := n["effect"].(map[string]any); ok && effect["type"] == "issue-orders" {
			dslWalk(effect, source, partOpts, out)
			return
		}
		if n["trigger"] != nil {
			if bound, changed := bindEventSubject(n["trigger"], n["effect"], opts.context, opts.perspective); changed {
				rebound := cloneMap(n)
				rebound["effect"] = bound
				dslWalk(rebound, source, opts, out)
				return
			}
		}
		// A part with its own optionality, cost or usage is an activation.
		// Otherwise its trigger is only the moment at which its effect fires.
		if n["optional"] == true || n["cost"] != nil || n["usage"] != nil {
			translateNamedEffect(n, source, partOpts, out)
		} else {
			dslWalk(momentGate(n["trigger"], n["effect"], n), source, partOpts, out)
		}
	case "choice":
		enumerateChoice(n, source, opts, out)
	case "dice-gated":
		out.unsupported = append(out.unsupported, unsup(stochasticDiceGatedReason, n))
	case "dice-pool-allocation":
		enumerateDicePool(n, source, opts, out)
	case "roll":
		// A pool roll whose dice are allocated to named options (Blessings of Khorne) is the same
		// lever set dice-pool-allocation produced; any other bound roll only scopes its nested effect.
		if !enumerateRollAllocation(n, source, opts, out) {
			dslWalk(n["effect"], source, opts, out)
		}
	case "select-objective":
		out.unsupported = append(out.unsupported, unsup("select-objective: the bound objective marker is not resolved by the buff engine", n))
	case "characteristic-resolution":
		out.unsupported = append(out.unsupported, unsup("characteristic-resolution: which models' characteristic applies depends on the unit's model mix; not resolved by the buff engine", n))
	case "borrow-weapons":
		out.unsupported = append(out.unsupported, unsup("borrow-weapons: the passengers' weapons are not added to the Transport's profile by the buff engine", n))
	case "select-weapon":
		out.unsupported = append(out.unsupported, unsup("select-weapon: a bound weapon is not resolved by the buff engine", n))
	case "select-units":
		// Targeting wrapper — the selected units receive the nested effect.
		dslWalk(n["effect"], source, opts, out)
	case "aura":
		// An aura's own target names the side it reaches, not a unit-ref: friendly recipients are the
		// buffed side, enemy ones the other.
		side := "unknown"
		switch n["target"] {
		case "friendly-within-aura":
			side = "self"
		case "enemy-within-aura":
			side = "defender"
		}
		if side == "unknown" || (side == "defender" && opts.perspective != "target") {
			return
		}
		modifier, _ := getMap(n, "modifier")
		if recipientFilter, present := modifier["recipient_filter"]; present {
			matches, reason := auraRecipientFilterMatches(recipientFilter, opts.context, opts.perspective)
			if reason != "" {
				out.unsupported = append(out.unsupported, unsup("aura recipient keywords are unavailable or its filter is malformed", n))
				return
			}
			if !matches {
				return
			}
		}
		if emitterFilter, present := modifier["emitter_filter"]; present {
			matches, _ := auraRecipientFilterMatches(emitterFilter, nil, opts.perspective)
			if !matches {
				out.unsupported = append(out.unsupported, unsup("aura emitter filter requires the source unit's keywords", n))
				return
			}
		}
		effect, ok := getMap(modifier, "effect")
		if ok && effect != nil {
			dslWalk(effect, source, opts, out)
		} else {
			out.unsupported = append(out.unsupported, unsup("aura without nested effect: not a combat buff", n))
		}
	case "persistent-designation":
		out.unsupported = append(out.unsupported, unsup("persistent-designation: retained selection state is not resolved by the buff engine", n))
	case "designate-target":
		applies, _ := getMap(n, "applies")
		if applies["to"] == "attackers-of-target" || applies["to"] == "bearer-attacks-target" {
			for _, rawFilter := range []any{applies["attacker_filter"], applies["attacker_unit_filter"]} {
				if rawFilter == nil {
					continue
				}
				filter, ok := asMap(rawFilter)
				if !ok || filter == nil {
					out.unsupported = append(out.unsupported, unsup("designate-target attacker filter is unresolved", n))
					return
				}
				verdict := matchesUnitFilter(filter, opts.context, "attacker", "friendly")
				if verdict == false {
					return
				}
				if verdict == nil {
					out.unsupported = append(out.unsupported, unsup("designate-target attacker filter is unresolved", n))
					return
				}
			}
			// A designation restricted to units the target is not (e.g. an enemy VEHICLE) never marks it.
			if sel, ok := getMap(n, "select"); ok && sel["kind"] == "unit" {
				if selector, ok := getMap(sel, "selector"); ok {
					if filter, ok := asMap(selector["filter"]); ok && filter != nil && matchesUnitFilter(filter, opts.context, "target", "enemy") == false {
						return
					}
				}
			}
			sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
			dslWalk(applies["effect"], source, opts, sub)
			out.unsupported = append(out.unsupported, sub.unsupported...)
			requirement := map[string]any{"select": n["select"], "duration": n["duration"]}
			for _, raw := range sub.activatable {
				if lever, ok := asMap(raw); ok && lever != nil {
					lever["requires"] = append([]any{requirement}, getList(lever, "requires")...)
					out.activatable = append(out.activatable, lever)
				}
			}
			if len(sub.applied) > 0 {
				designation, ok := n["designation"].(string)
				if !ok {
					designation = "designated"
				}
				out.activatable = append(out.activatable, map[string]any{
					"id": opts.abilityID + "#" + designation, "label": "Designated target: " + labelForBuffs(sub.applied),
					"buffs": sub.applied, "requires": []any{requirement},
				})
			}
		} else {
			out.unsupported = append(out.unsupported, unsup("designate-target debuff on the marked unit: not a buff on the bearer", n))
		}
	case "risk-reward":
		// The reward is the buff; the risk (self-damage on a failed test) is not.
		dslWalk(n["reward"], source, opts, out)
	case "stance-select":
		// Pick-one modal buff — each option is an opt-in lever.
		maxActivations := float64(1)
		if value, ok := num(n["max_choices"]); ok {
			maxActivations = value
		}
		enumerateNamedOptions(n, source, opts, out, opts.abilityID+"?stance", maxActivations)
	case "stance-selection-capacity":
		translateStanceCapacity(n, opts, out)
	case "issue-orders":
		// Officer issues one Order from the menu — each is an opt-in lever.
		enumerateNamedOptions(n, source, opts, out, opts.abilityID+"?order", 1)
	case "resource-action-menu":
		// Each action is an INDEPENDENT reactive lever, not a pick-one group:
		// unlike stance-select/issue-orders, multiple actions (and repeats of
		// the same action by different units — see
		// usage.repeatable_if_different_unit) can fire in the same phase, so
		// no shared group/maxActivations cap is attached here.
		enumerateMenuActions(n, source, opts, out)
	case "roll-result":
		translateRollResult(n, source, opts, out)
	case "ignore-modifiers":
		translateIgnoreModifiers(n, source, opts, out)
	case "ability-grant":
		translateAbilityGrant(n, source, opts, out)
	case "ability-modifier":
		translateAbilityModifier(n, source, opts, out)
	default:
		out.unsupported = append(out.unsupported, unsup("effect type \""+jsStr(n["type"])+"\" is not modelled by the buff layer", n))
	}
}

const recipientSnapshotReason = "trigger-time recipient snapshot is unavailable; current membership cannot establish historical recipients"

func containsForEachUnit(node any) bool {
	switch value := node.(type) {
	case map[string]any:
		if value["type"] == "for-each-unit" {
			return true
		}
		for _, child := range value {
			if containsForEachUnit(child) {
				return true
			}
		}
	case []any:
		for _, child := range value {
			if containsForEachUnit(child) {
				return true
			}
		}
	}
	return false
}

// recipientSnapshotUnavailable reports the historical-membership case that the
// buff resolver cannot reconstruct. Attack-step triggers evaluate against the
// current attack and remain safe; other event triggers need a recipient
// snapshot at trigger time.
func recipientSnapshotUnavailable(trigger, effect any) bool {
	var check func(any, any) bool
	check = func(value, activeTrigger any) bool {
		switch item := value.(type) {
		case []any:
			for _, child := range item {
				if check(child, activeTrigger) {
					return true
				}
			}
			return false
		case map[string]any:
			inherited := activeTrigger
			if item["type"] == "ability-part" && item["trigger"] != nil {
				inherited = item["trigger"]
			}
			if item["type"] == "for-each-unit" {
				candidates, ok := asList(inherited)
				if !ok {
					candidates = []any{inherited}
				}
				for _, candidate := range candidates {
					t, ok := asMap(candidate)
					if ok && t != nil && getStr(t, "event") != "" && !isAttackStep(t) {
						return true
					}
				}
			}
			for key, child := range item {
				if key != "trigger" && check(child, inherited) {
					return true
				}
			}
		}
		return false
	}
	return check(effect, trigger)
}

// attackStepRolls are the rolls inside every attack: a trigger on one applies
// to each attack it modifies.
var attackStepRolls = map[string]bool{"hit": true, "wound": true, "save": true, "damage": true}

// isAttackStep reports a trigger on a step of every attack (a hit, wound, save
// or damage roll, or allocating damage).
func isAttackStep(trigger any) bool {
	t, ok := asMap(trigger)
	if !ok || t == nil {
		return false
	}
	if t["event"] == "damage-allocated" {
		return true
	}
	var roll any
	if f, ok := asMap(t["filter"]); ok && f != nil {
		roll = f["roll"]
	}
	r, isStr := roll.(string)
	return (t["event"] == "before-roll" || t["event"] == "after-roll") && isStr && attackStepRolls[r]
}
func snapshotValueEqual(left, right any) bool {
	if l, lok := left.(map[string]any); lok {
		r, rok := right.(map[string]any)
		if !rok || len(l) != len(r) {
			return false
		}
		for key, value := range l {
			if !snapshotValueEqual(value, r[key]) {
				return false
			}
		}
		return true
	}
	if l, lok := left.([]any); lok {
		r, rok := right.([]any)
		if !rok || len(l) != len(r) {
			return false
		}
		for i := range l {
			if !snapshotValueEqual(l[i], r[i]) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(left, right)
}

func bindSnapshotRecipient(node map[string]any) (any, bool) {
	selector := mapOr(node["selector"])
	bindAs := getStr(selector, "bind_as")
	bound, other := false, false
	var bind func(any) any
	bind = func(value any) any {
		if list, ok := value.([]any); ok {
			out := make([]any, len(list))
			for i, child := range list {
				out[i] = bind(child)
			}
			return out
		}
		m, ok := value.(map[string]any)
		if !ok || m == nil || m["type"] == "select-units" || m["type"] == "for-each-unit" {
			return value
		}
		out := make(map[string]any, len(m))
		for key, child := range m {
			recipient := child == "recipient"
			if bindAs != "" {
				if ref, ok := child.(map[string]any); ok && getStr(ref, "selection_var") == bindAs {
					recipient = true
				}
			}
			if key == "target" && recipient {
				out[key] = "recipient"
				bound = true
			} else {
				out[key] = bind(child)
				if key == "target" {
					other = true
				}
			}
		}
		return out
	}
	effect := bind(node["effect"])
	return effect, bound && !other
}

func resolveRecipientSnapshots(trigger, effect any, source map[string]any, context map[string]any, perspective string) (any, string) {
	sideID := getStr(context, map[string]string{"attacker": "attackerUnitId", "target": "targetUnitId"}[perspective])
	sourceID := ""
	if getStr(source, "kind") == "ability" {
		sourceID = getStr(source, "sourceUnitId")
		if sourceID == "" && getStr(source, "abilityKind") == "unit" {
			sourceID = sideID
		}
	}
	var reason string
	var visit func(any, string, any) any
	visit = func(node any, path string, event any) any {
		m, ok := node.(map[string]any)
		if !ok || m == nil {
			return node
		}
		events := []any{}
		if list, ok := event.([]any); ok {
			events = list
		} else {
			events = []any{event}
		}
		historical := []any{}
		for _, raw := range events {
			if t, ok := raw.(map[string]any); ok && getStr(t, "event") != "" && !isAttackStep(t) {
				historical = append(historical, t)
			}
		}
		if m["type"] == "for-each-unit" && len(historical) > 0 {
			matches := []map[string]any{}
			for _, raw := range getList(context, "recipientSnapshots") {
				snapshot, ok := raw.(map[string]any)
				if !ok || sourceID == "" || sideID == "" {
					continue
				}
				if snapshot["sourceUnitId"] != sourceID || snapshot["perspective"] != perspective || snapshot["recipientUnitId"] != sideID || getStr(snapshot, "selectionPath") != path || !snapshotValueEqual(snapshot["source"], source) || !snapshotValueEqual(snapshot["selector"], m["selector"]) {
					continue
				}
				for _, h := range historical {
					if snapshotValueEqual(snapshot["trigger"], h) {
						matches = append(matches, snapshot)
						break
					}
				}
			}
			if len(matches) == 0 {
				reason = recipientSnapshotReason
				return map[string]any{"type": "sequence", "steps": []any{}}
			}
			selected, _ := matches[0]["selected"].(bool)
			for _, match := range matches[1:] {
				if value, _ := match["selected"].(bool); value != selected {
					reason = "conflicting trigger-time recipient snapshots"
					return map[string]any{"type": "sequence", "steps": []any{}}
				}
			}
			if !selected {
				return map[string]any{"type": "sequence", "steps": []any{}}
			}
			bound, valid := bindSnapshotRecipient(m)
			if !valid {
				reason = "recipient snapshot cannot bind mixed or unresolved recipient effects"
				return map[string]any{"type": "sequence", "steps": []any{}}
			}
			return bound
		}
		if m["type"] == "for-each-unit" {
			return momentGate(event, m)
		}
		switch m["type"] {
		case "sequence", "rules-bundle":
			out := cloneMap(m)
			steps := getList(m, "steps")
			next := make([]any, len(steps))
			for i, step := range steps {
				next[i] = visit(step, path+"/steps/"+strconv.Itoa(i), event)
			}
			out["steps"] = next
			return out
		case "conditional":
			out := cloneMap(m)
			out["effect"] = visit(m["effect"], path+"/effect", event)
			return out
		case "ability-part":
			out := cloneMap(m)
			nextEvent := event
			if m["trigger"] != nil {
				nextEvent = m["trigger"]
			}
			delete(out, "trigger")
			out["effect"] = visit(m["effect"], path+"/effect", nextEvent)
			return out
		}
		if containsForEachUnit(m) {
			reason = "recipient snapshot is nested in an unsupported activation composition"
			return map[string]any{"type": "sequence", "steps": []any{}}
		}
		return momentGate(event, m)
	}
	return visit(effect, "", trigger), reason
}

// momentKey is the lever key of a trigger: its event family and the filter
// value that tells moments apart (<family>[:<key>]).
func momentKey(trigger map[string]any) string {
	f, _ := asMap(trigger["filter"])
	if f == nil {
		f = map[string]any{}
	}
	var moveTypes any
	if l, ok := asList(f["move_types"]); ok {
		parts := make([]string, len(l))
		for i, e := range l {
			if e != nil {
				parts[i] = cstr(e)
			}
		}
		moveTypes = strings.Join(parts, "+")
	}
	for _, v := range []any{f["to"], f["kind"], f["roll"], moveTypes, f["from"]} {
		if s, ok := v.(string); ok && s != "" {
			return jsStr(trigger["event"]) + ":" + s
		}
	}
	return jsStr(trigger["event"])
}

// ownMoveFact is the unit's own move the engine context records: a Charge (or
// Advance) move is "charged this turn".
func ownMoveFact(trigger map[string]any) map[string]any {
	if trigger["event"] != "move-ended" || (trigger["subject"] != nil && trigger["subject"] != "this-unit") {
		return nil
	}
	var types []any
	if f, ok := asMap(trigger["filter"]); ok && f != nil {
		types, _ = asList(f["move_types"])
	}
	if len(types) != 1 || (types[0] != "charge" && types[0] != "advance") {
		return nil
	}
	return map[string]any{"type": "happened", "parameters": map[string]any{
		"event": "move-ended", "filter": map[string]any{"move_types": types}, "window": "turn",
	}}
}

var activationClock = map[string]any{"type": "timing-is", "parameters": map[string]any{"timing": "activation"}}

// activationCondition replaces only clocks crossed by a lasting activation.
// Non-clock eligibility remains a live condition.
func activationCondition(condition map[string]any, duration any) map[string]any {
	expiry, _ := duration.(string)
	spansPhases := expiry == "turn" || expiry == "battle-round" || expiry == "battle" ||
		expiry == "permanent" || expiry == "while-leading" || expiry == "one-use" ||
		expiry == "control-lost" || strings.HasPrefix(expiry, "until-")
	clock := getStr(condition, "type")
	if spansPhases && (clock == "phase-is" ||
		(clock == "player-turn-is" && expiry != "turn") ||
		(clock == "battle-round" && expiry != "turn" && expiry != "battle-round")) {
		return cloneMap(activationClock)
	}
	if _, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			out := cloneMap(condition)
			rewritten := make([]any, len(operands))
			for i, operand := range operands {
				if child, ok := asMap(operand); ok && child != nil {
					rewritten[i] = activationCondition(child, duration)
				} else {
					rewritten[i] = operand
				}
			}
			out["operands"] = rewritten
			return out
		}
	}
	return condition
}

func momentCondition(trigger any, duration ...any) (map[string]any, bool) {
	candidates, ok := trigger.([]any)
	if !ok {
		candidates = []any{trigger}
	}
	var lifetime any
	if len(duration) > 0 {
		lifetime = duration[0]
	}
	var gates []any
	for _, candidate := range candidates {
		t, ok := asMap(candidate)
		if !ok || t == nil || getStr(t, "event") == "" {
			continue
		}
		own, hasOwn := asMap(t["condition"])
		hasOwn = hasOwn && own != nil
		if isAttackStep(t) {
			if !hasOwn {
				return nil, false
			}
			gates = append(gates, own)
			continue
		}
		moment := ownMoveFact(t)
		if moment == nil {
			moment = map[string]any{"type": "timing-is", "parameters": map[string]any{"timing": momentKey(t)}}
		}
		if hasOwn {
			gates = append(gates, map[string]any{"operator": "and", "operands": []any{moment, activationCondition(own, lifetime)}})
		} else {
			gates = append(gates, moment)
		}
	}
	if len(gates) == 0 {
		return nil, false
	}
	if len(gates) == 1 {
		return mapOr(gates[0]), true
	}
	return map[string]any{"operator": "or", "operands": gates}, true
}

// momentGate gates an effect on a trigger while retaining the canonical source
// fragment separately for diagnostics and activation requirements.
func momentGate(trigger any, effect any, sourceFragment ...map[string]any) any {
	if effect == nil {
		return effect
	}
	condition, ok := momentCondition(trigger)
	if !ok {
		return effect
	}
	fragment := any(map[string]any{"type": "ability-part", "trigger": trigger, "effect": effect})
	if len(sourceFragment) > 0 {
		fragment = sourceFragment[0]
	}
	return map[string]any{
		"type": "conditional", "condition": condition, "effect": effect,
		"__activation_source": map[string]any{"trigger": trigger, "fragment": fragment},
	}
}

// A named rule is transparent unless using it requires an activation.
func translateNamedEffect(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if recipientSnapshotUnavailable(node["trigger"], node["effect"]) {
		out.unsupported = append(out.unsupported, unsup(recipientSnapshotReason, node))
		return
	}
	if node["optional"] != true && node["cost"] == nil && node["trigger"] == nil && node["usage"] == nil {
		dslWalk(node["effect"], source, opts, out)
		return
	}
	body := momentGate(node["trigger"], node["effect"], node)
	if condition, ok := momentCondition(node["trigger"], opts.duration); ok {
		var evalSource map[string]any
		if !opts.grantedHolder {
			evalSource = source
		}
		verdict := evaluateCondition(condition, opts.context, opts.perspective, evalSource)
		if conditionMentionsTiming(condition) && verdict != false {
			body = node["effect"]
		} else {
			body = map[string]any{"type": "conditional", "condition": condition, "effect": node["effect"]}
		}
	}
	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(body, source, opts, sub)
	out.unsupported = append(out.unsupported, sub.unsupported...)
	requirement := activationRequirement(node)
	for _, raw := range sub.activatable {
		lever, ok := asMap(raw)
		if !ok || lever == nil {
			continue
		}
		lever["requires"] = append([]any{requirement}, getList(lever, "requires")...)
		out.activatable = append(out.activatable, lever)
	}
	if len(sub.applied) == 0 {
		return
	}
	name := getStr(node, "name")
	if name == "" {
		name = labelForBuffs(sub.applied)
	}
	out.activatable = append(out.activatable, map[string]any{
		"id": opts.abilityID + "#" + name, "label": name,
		"buffs": sub.applied, "requires": []any{requirement},
	})
}

// --- activatable-lever enumeration ---
func enumerateChoice(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	options, _ := asList(node["options"])
	maxActivations := float64(1)
	if isNumber(node["max_choices"]) {
		maxActivations, _ = num(node["max_choices"])
	}
	for i, opt := range options {
		var buffs []any
		collectGatedBuffs(opt, source, opts, map[string]any{}, &buffs, &out.unsupported)
		if len(buffs) == 0 {
			continue
		}
		out.activatable = append(out.activatable, map[string]any{
			"id": opts.abilityID + "?" + strconv.Itoa(i), "label": labelForBuffs(buffs),
			"buffs": buffs, "group": map[string]any{"id": opts.abilityID + "?choice", "maxActivations": maxActivations},
		})
	}
}

func enumerateDicePool(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	options, _ := asList(node["options"])
	maxActivations := float64(len(options))
	if isNumber(node["max_activations"]) {
		maxActivations, _ = num(node["max_activations"])
	}
	for _, optAny := range options {
		opt, ok := asMap(optAny)
		if !ok {
			continue
		}
		var buffs []any
		collectGatedBuffs(opt["effect"], source, opts, map[string]any{}, &buffs, &out.unsupported)
		if len(buffs) == 0 {
			continue
		}
		name := getStr(opt, "name")
		if name == "" {
			name = labelForBuffs(buffs)
		}
		out.activatable = append(out.activatable, map[string]any{
			"id": opts.abilityID + "#" + name, "label": name, "buffs": buffs,
			"group": map[string]any{"id": opts.abilityID, "maxActivations": maxActivations},
		})
	}
}

// enumerateNamedOptions emits one opt-in lever per buff-bearing named option
// (stance-select / issue-orders), grouped under groupID with maxActivations.
func enumerateNamedOptions(node, source map[string]any, opts dslOpts, out *effectTranslation, groupID string, maxActivations float64) {
	options, _ := asList(node["options"])
	for _, optAny := range options {
		opt, ok := asMap(optAny)
		if !ok {
			continue
		}
		var buffs []any
		collectGatedBuffs(opt["effect"], source, opts, map[string]any{}, &buffs, &out.unsupported)
		if len(buffs) == 0 {
			continue
		}
		name := getStr(opt, "name")
		if name == "" {
			name = labelForBuffs(buffs)
		}
		id := name
		if node["type"] == "stance-select" {
			id = getStr(opt, "id")
		}
		out.activatable = append(out.activatable, map[string]any{
			"id": opts.abilityID + "#" + id, "label": name, "buffs": buffs,
			"group": map[string]any{"id": groupID, "maxActivations": maxActivations},
		})
	}
}

// enumerateMenuActions emits one opt-in lever per buff-bearing
// resource-action-menu action. Unlike stance-select and issue-orders, each
// action is independent: a unit's per-phase manoeuvre limit is not a
// mutual-exclusion pool, and repeatable_if_different_unit can allow the same
// action for another unit. Eligibility is evaluated against the current
// crunch context; unavailable unit facts remain unsupported.
func enumerateMenuActions(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	actions, _ := asList(node["actions"])
	for _, actionAny := range actions {
		action, ok := asMap(actionAny)
		if !ok {
			continue
		}
		eligibility, _ := getMap(action, "eligibility")
		if eligibility != nil && eligibility["filter"] != nil {
			filter, ok := asMap(eligibility["filter"])
			if !ok {
				out.unsupported = append(out.unsupported, unsup("resource-action-menu eligibility filter is unresolved", action))
				continue
			}
			side := "target"
			if opts.perspective == "attacker" {
				side = "attacker"
			}
			switch matchesUnitFilter(filter, opts.context, side, "friendly") {
			case false:
				continue
			case nil:
				out.unsupported = append(out.unsupported, unsup("resource-action-menu eligibility filter is unresolved", action))
				continue
			}
		}
		skip := false
		for _, raw := range getList(eligibility, "requires") {
			condition, ok := asMap(raw)
			if ok && evaluateCondition(condition, opts.context, opts.perspective, source) == false {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		id := getStr(action, "id")
		if id == "" {
			out.unsupported = append(out.unsupported, unsup("resource-action-menu action has no stable id", action))
			continue
		}
		var buffs []any
		collectGatedBuffs(action["effect"], source, opts, map[string]any{}, &buffs, &out.unsupported)
		if len(buffs) == 0 {
			continue
		}
		label := getStr(action, "label")
		if label == "" {
			label = labelForBuffs(buffs)
		}
		requirement := map[string]any{
			"menu_id": node["menu_id"], "pool_id": node["pool_id"],
			"shared_usage": node["shared_usage"], "capacity": node["capacity"],
			"action": activationRequirement(action),
		}
		lever := map[string]any{
			"id": opts.abilityID + "#" + id, "label": label, "buffs": buffs,
			"requires": []any{requirement},
		}
		if shared, ok := getMap(node, "shared_usage"); ok {
			if cap, ok := num(shared["unit_max_manoeuvres_per_phase"]); ok {
				lever["group"] = map[string]any{"id": opts.abilityID + "?menu", "maxActivations": cap}
			}
		}
		out.activatable = append(out.activatable, lever)
	}
}

// postAttackMoment is the reason a conditional fired by its own side's resolved attacks is
// reported: the attacks that fire it are already resolved.
const postAttackMoment = "post-attack moment: applies only to attacks made after the triggering unit's"

// isPostOwnAttackMoment reports whether every alternative trigger fires just after the
// ability's own side resolved its attacks (`attacks-resolved` with no subject, `this-unit`,
// `this-model` or a friendly filter). The attacks that fire it are already resolved, so
// nothing it grants changes them. Mirror of isPostOwnAttackMoment in
// tools/src/cruncher/from-dsl.ts.
func isPostOwnAttackMoment(trigger any) bool {
	items, isList := asList(trigger)
	if !isList {
		items = []any{trigger}
	}
	count := 0
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok || m == nil {
			continue
		}
		count++
		if m["event"] != "attacks-resolved" {
			return false
		}
		subject := m["subject"]
		if subject == nil || subject == "this-unit" || subject == "this-model" {
			continue
		}
		if filter, ok := subject.(map[string]any); ok && filter != nil && filter["owner"] == "friendly" {
			continue
		}
		return false
	}
	return count > 0
}

func activationMetadata(node map[string]any) map[string]any {
	metadata, _ := asMap(node["__activation_source"])
	return metadata
}

func activationFragment(node map[string]any) any {
	if metadata := activationMetadata(node); metadata != nil && metadata["fragment"] != nil {
		return metadata["fragment"]
	}
	return node
}

func enumerateTimingGate(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	condition, ok := getMap(node, "condition")
	if !ok {
		return
	}
	var requirement map[string]any
	if metadata := activationMetadata(node); metadata != nil {
		if fragment, ok := asMap(metadata["fragment"]); ok && fragment != nil {
			requirement = activationRequirement(fragment)
		}
	}
	var buffs []any
	collectGatedBuffs(node["effect"], source, opts, map[string]any{}, &buffs, nil)
	sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(node["effect"], source, opts, sub)
	for _, unsupported := range sub.unsupported {
		fragment, ok := asMap(unsupported)
		if ok && getStr(fragment, "reason") == stochasticDiceGatedReason {
			effectFragment, isDiceGate := asMap(fragment["effectFragment"])
			if isDiceGate && getStr(effectFragment, "type") == "dice-gated" {
				continue
			}
		}
		out.unsupported = append(out.unsupported, unsupported)
	}
	for _, raw := range sub.activatable {
		lever, ok := asMap(raw)
		if !ok || lever == nil {
			continue
		}
		if requirement != nil {
			lever["requires"] = append([]any{requirement}, getList(lever, "requires")...)
		}
		out.activatable = append(out.activatable, lever)
	}
	if len(buffs) > 0 {
		timing := extractTiming(condition)
		if timing == "" {
			timing = "timing"
		}
		lever := map[string]any{
			"id": opts.abilityID + "@" + timing, "label": labelForBuffs(buffs), "buffs": buffs,
		}
		if requirement != nil {
			lever["requires"] = []any{requirement}
		}
		out.activatable = append(out.activatable, lever)
	}
}

func collectGatedBuffs(node any, source map[string]any, opts dslOpts, applicability map[string]any, outBuffs *[]any, diagnostics *[]any) {
	n, ok := asMap(node)
	if !ok {
		return
	}
	switch getStr(n, "type") {
	case "conditional":
		condition, ok := getMap(n, "condition")
		if !ok {
			return
		}
		app := conditionToApplicability(condition, opts.perspective)
		switch a := app.(type) {
		case string:
			if a == "gate" {
				collectGatedBuffs(n["effect"], source, opts, applicability, outBuffs, diagnostics)
				return
			}
			if a == "context" {
				var evalSource map[string]any
				if !opts.grantedHolder {
					evalSource = source
				}
				verdict := evaluateCondition(condition, opts.context, opts.perspective, evalSource)
				if verdict == true {
					collectGatedBuffs(n["effect"], source, opts, applicability, outBuffs, diagnostics)
				} else if verdict == nil && diagnostics != nil {
					*diagnostics = append(*diagnostics, unsup("activation condition cannot be evaluated against current context", activationFragment(n)))
				}
				return
			}
		case map[string]any:
			collectGatedBuffs(n["effect"], source, opts, combineApplicability(applicability, a), outBuffs, diagnostics)
			return
		}
		return
	case "rules-bundle", "sequence":
		for _, step := range getList(n, "steps") {
			collectGatedBuffs(step, source, opts, applicability, outBuffs, diagnostics)
		}
		return
	case "ability-part":
		partOpts := opts
		if n["duration"] != nil {
			partOpts.duration = n["duration"]
		}
		if n["trigger"] != nil || (n["optional"] != true && n["cost"] == nil && n["usage"] == nil) {
			collectGatedBuffs(momentGate(n["trigger"], n["effect"], n), source, partOpts, applicability, outBuffs, diagnostics)
		}
		return
	case "choice", "dice-pool-allocation", "dice-gated":
		return
	}
	tmp := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
	dslWalk(n, source, opts, tmp)
	if diagnostics != nil {
		*diagnostics = append(*diagnostics, tmp.unsupported...)
	}
	for _, b := range tmp.applied {
		if buff, ok := asMap(b); ok {
			*outBuffs = append(*outBuffs, applyApplicability(buff, applicability))
		}
	}
}

func activationRequirement(node map[string]any) map[string]any {
	requirement := cloneMap(node)
	delete(requirement, "effect")
	delete(requirement, "__activation_source")
	return requirement
}

func unsup(reason string, fragment any) map[string]any {
	return map[string]any{"reason": reason, "effectFragment": fragment}
}

func classifyTarget(node map[string]any) string {
	// A unit filter reaches every unit it matches: friendly ones are the buffed side, enemy ones the other.
	if f, ok := asMap(node["target"]); ok && f != nil {
		if _, present := f["unit_ids"]; present {
			return "self"
		}
	}
	if f, isMap := asMap(node["target"]); isMap && f != nil {
		_, ev := f["event_var"]
		_, sv := f["selection_var"]
		if !ev && !sv {
			switch f["owner"] {
			case "friendly":
				return "self"
			case "enemy":
				return "defender"
			}
			return "unknown"
		}
	}
	target, ok := node["target"].(string)
	if !ok {
		return "unknown"
	}
	if target == "attacker" {
		return "attacker"
	}
	if defenderTargets[target] {
		return "defender"
	}
	if selfTargets[target] {
		return "self"
	}
	return "unknown"
}

func appliesToBuffedUnit(node map[string]any, perspective string) bool {
	switch classifyTarget(node) {
	case "self":
		return true
	case "attacker":
		return perspective == "attacker"
	case "defender":
		return perspective == "target"
	}
	return false
}

func auraRecipientFilterMatches(value any, context map[string]any, perspective string) (bool, string) {
	filter, ok := asMap(value)
	if !ok || filter == nil {
		return false, "aura recipient_filter is malformed"
	}
	for key := range filter {
		if key != "owner" && key != "all_of" && key != "any_of" && key != "none_of" && key != "not_all_of" {
			return false, "aura recipient_filter has unrecognised keys"
		}
	}
	if owner := getStr(filter, "owner"); owner != "" && owner != "friendly" && owner != "any" {
		return false, "aura recipient_filter owner cannot be evaluated"
	}
	contextKey := "targetKeywords"
	if perspective == "attacker" {
		contextKey = "attackerKeywords"
	}
	rawKeywords, present := context[contextKey]
	if !present || rawKeywords == nil {
		return false, "aura recipient_filter cannot be evaluated without recipient keywords"
	}
	keywords, ok := asList(rawKeywords)
	if !ok {
		return false, "aura recipient_filter recipient keywords are malformed"
	}
	current := map[string]bool{}
	for _, raw := range keywords {
		keyword, ok := raw.(string)
		if !ok || keyword == "" {
			return false, "aura recipient_filter recipient keywords are malformed"
		}
		current[keywordKey(keyword)] = true
	}
	has := func(raw any) bool {
		keyword, ok := raw.(string)
		return ok && current[keywordKey(keyword)]
	}
	if required, ok := asList(filter["all_of"]); ok {
		for _, raw := range required {
			if !has(raw) {
				return false, ""
			}
		}
	}
	if alternatives, ok := asList(filter["any_of"]); ok {
		found := false
		for _, raw := range alternatives {
			if has(raw) {
				found = true
				break
			}
		}
		if !found {
			return false, ""
		}
	}
	if excluded, ok := asList(filter["none_of"]); ok {
		for _, raw := range excluded {
			if has(raw) {
				return false, ""
			}
		}
	}
	if excludedTogether, ok := asList(filter["not_all_of"]); ok {
		all := true
		for _, raw := range excludedTogether {
			if !has(raw) {
				all = false
				break
			}
		}
		if all {
			return false, ""
		}
	}
	return true, ""
}

func translateReroll(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective == "attacker" && !appliesToBuffedUnit(node, "attacker") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("re-roll: missing modifier object", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("re-roll: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	roll, _ := modifier["roll"].(string)
	subset, _ := modifier["subset"].(string)
	// An unnarrowed any-result re-roll is "all-failures" to the expected-value engine.
	if jsNumberEq(modifier["value"], 1) {
		subset = "ones"
	} else if _, has := modifier["subset"]; !has && jsStr(modifier["result_scope"]) == "any-result" {
		subset = "all-failures"
	}
	if opts.perspective == "target" && roll != "save" {
		return
	}
	damagePath := roll == "hit" || roll == "wound" || roll == "save" || roll == "damage"
	applicability := combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier))
	// "Re-roll one Hit roll": one die across the pool, which the engine prices
	// (oneRerollDice). A larger finite permission is non-linear in a way the
	// engine does not model; applying it as an uncapped reroll would silently
	// overstate the effect.
	if _, capped := modifier["count"]; capped && damagePath {
		if jsNumberEq(modifier["count"], 1) && subset == "all-failures" {
			out.applied = append(out.applied, withApplicability(map[string]any{"source": source, "contribution": map[string]any{"type": "reroll-one", "roll": roll}}, applicability))
			return
		}
		out.unsupported = append(out.unsupported, unsup("re-roll: a count-capped permission other than one die of any result is not modelled by the expected-value engine", node))
		return
	}
	if damagePath && (subset == "ones" || subset == "all-failures") {
		out.applied = append(out.applied, withApplicability(map[string]any{"source": source, "contribution": map[string]any{"type": "reroll", "roll": roll, "subset": subset}}, applicability))
		return
	}
	out.unsupported = append(out.unsupported, unsup("re-roll on \""+rollLabel(modifier["roll"])+"\" (subset \""+jsStr(modifier["subset"])+"\") is outside the damage path", node))
}

func translateRollModifier(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("roll-modifier: missing modifier object", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("roll-modifier: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	value, ok := signedValue(modifier)
	if !ok {
		out.unsupported = append(out.unsupported, unsup("roll-modifier: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	roll, _ := modifier["roll"].(string)
	// A change to the attacker's roll belongs to the side it favours: one that helps the attacker is
	// the attacking side's own rule, one that hinders it defends the unit being attacked.
	attackerChange := classifyTarget(node) == "attacker"
	if opts.perspective == "attacker" {
		if attackerChange && value < 0 {
			return
		}
		if !appliesToBuffedUnit(node, "attacker") {
			return
		}
		if roll == "save" {
			return
		}
	} else {
		cls := classifyTarget(node)
		if cls == "attacker" {
			if roll != "hit" && roll != "wound" {
				return
			}
			if attackerChange && value > 0 {
				return
			}
		} else if cls == "self" {
			if roll != "save" {
				return
			}
		} else {
			return
		}
	}
	ct := rollToContribType(roll)
	if ct == "" {
		out.unsupported = append(out.unsupported, unsup("roll-modifier on \""+rollLabel(modifier["roll"])+"\" is outside the damage path", node))
		return
	}
	out.applied = append(out.applied, withApplicability(map[string]any{"source": source, "contribution": map[string]any{"type": ct, "value": value}}, weaponApplicability(modifier)))
}

func translateStatModifier(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("stat-modifier: missing modifier object", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("stat-modifier: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	stat, _ := modifier["stat"].(string)
	isOnBuffedUnit := appliesToBuffedUnit(node, opts.perspective)
	// attack_type scopes the mod to that attack's phase, and weapon_name to that weapon's attacks.
	applicability := combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier))

	emit := func(contribution map[string]any) {
		out.applied = append(out.applied, withApplicability(map[string]any{"source": source, "contribution": contribution}, applicability))
	}

	if stat == "AP" {
		translateAPModifier(node, modifier, opts, out, emit)
		return
	}

	// WS/BS on the attacker is a defender-side rule: it penalises incoming hit rolls of that attack
	// type (e.g. Benefit of Cover), so it is a `hit-mod` under target perspective. On the buffed unit
	// it changes the characteristic its own attacks hit on.
	if stat == "BS" || stat == "WS" {
		translateSkillModifier(node, source, modifier, stat, isOnBuffedUnit, opts, out, emit)
		return
	}

	// Setting the Save characteristic is defender-side; any other set stat outside A/S/T is off the
	// damage path, and a set A/S/T has no single delta.
	if modifier["operation"] == "set" {
		if stat == "Sv" {
			translateSaveSet(node, modifier, isOnBuffedUnit, opts, out, emit)
			return
		}
		if stat != "A" && stat != "S" && stat != "T" && stat != "D" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier on \""+jsStr(modifier["stat"])+"\" is outside the damage path", node))
			return
		}
	}

	value, ok := signedValue(modifier)
	if !ok {
		out.unsupported = append(out.unsupported, unsup("stat-modifier: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	switch stat {
	case "A":
		if opts.perspective != "attacker" || !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "attacks-mod", "value": value})
	case "S":
		if opts.perspective != "attacker" || !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "strength-mod", "value": value})
	case "T":
		if opts.perspective != "target" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier T: defender-side stat; applies when the buffed unit is the target", node))
			return
		}
		if !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "toughness-mod", "value": value})
	case "D":
		// The Damage of attacks against the buffed unit is defender-side: a reduction (Necrodermis)
		// under target perspective. On the buffed unit it changes the Damage of its own attacks.
		if classifyTarget(node) == "attacker" {
			if opts.perspective != "target" {
				return
			}
			if value < 0 {
				emit(map[string]any{"type": "damage-reduction", "value": -value})
			} else {
				out.unsupported = append(out.unsupported, unsup("stat-modifier D: raising the Damage of incoming attacks is not modelled", node))
			}
			return
		}
		if opts.perspective != "attacker" || !isOnBuffedUnit {
			return
		}
		emit(map[string]any{"type": "damage-mod", "value": value})
	case "Sv":
		if opts.perspective != "target" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier Sv: defender-side stat; applies when the buffed unit is the target", node))
			return
		}
		if !isOnBuffedUnit {
			return
		}
		// A capped improvement ("cannot improve a Save to better than N+") changes the Save
		// characteristic itself, not the save roll.
		if best, ok := num(modifier["minimum"]); ok && modifier["operation"] == "improve" {
			emit(map[string]any{"type": "save-improve", "value": value, "best": best})
			return
		}
		saveMod := -value
		if modifier["operation"] == "improve" || modifier["operation"] == "worsen" {
			saveMod = value
		}
		emit(map[string]any{"type": "save-mod", "value": saveMod})
	default:
		out.unsupported = append(out.unsupported, unsup("stat-modifier on \""+jsStr(modifier["stat"])+"\" is outside the damage path", node))
	}
}

func translateAPModifier(node, modifier map[string]any, opts dslOpts, out *effectTranslation, emit func(map[string]any)) {
	if classifyTarget(node) == "attacker" {
		// Worsening the AP of attacks against the buffed unit; the engine floors AP at 0.
		if opts.perspective != "target" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier AP on the attacker: defender-side stat; applies when the buffed unit is the target", node))
			return
		}
		incoming, ok := apDelta(modifier)
		if !ok {
			out.unsupported = append(out.unsupported, unsup("stat-modifier AP: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
			return
		}
		emit(map[string]any{"type": "ap-mod", "value": incoming})
		return
	}
	if opts.perspective != "attacker" || !appliesToBuffedUnit(node, "attacker") {
		return
	}
	delta, ok := apDelta(modifier)
	if !ok {
		out.unsupported = append(out.unsupported, unsup("stat-modifier AP: operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	emit(map[string]any{"type": "ap-mod", "value": delta})
}

func translateFeelNoPain(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "target" {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("feel-no-pain: missing modifier object", node))
		return
	}
	threshold := jsNumber(modifier["threshold"])
	if math.IsInf(threshold, 0) || math.IsNaN(threshold) {
		out.unsupported = append(out.unsupported, unsup("feel-no-pain: threshold not numeric", node))
		return
	}
	// `psychic-and-mortal` folds into the mortal stream (its mortal-wound
	// coverage is exact; the psychic-attack half is invisible to the buff
	// layer); bare `psychic` has no stream to attach to, so it stays
	// unsupported rather than overstating defence.
	rawAgainst, present := modifier["against"]
	scope := "all"
	if present {
		if rawAgainst == "all" || rawAgainst == "mortal" {
			scope = rawAgainst.(string)
		} else if rawAgainst == "psychic-and-mortal" {
			scope = "mortal"
		} else if rawAgainst == "psychic" {
			out.unsupported = append(out.unsupported, unsup("feel-no-pain: against \"psychic\" (psychic attacks are not tracked by the buff layer)", node))
			return
		} else {
			out.unsupported = append(out.unsupported, unsup("feel-no-pain: unrecognised against \""+jsStr(rawAgainst)+"\" (expected \"all\" or \"mortal\")", node))
			return
		}
	}
	contribution := map[string]any{"type": "feel-no-pain", "threshold": threshold}
	if scope == "mortal" {
		contribution["scope"] = "mortal"
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": contribution})
}

func translateKeywordGrant(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "attacker" || !appliesToBuffedUnit(node, "attacker") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		return
	}
	for _, raw := range getList(modifier, "removes") {
		label := "unresolved keyword"
		if ref, ok := asMap(raw); ok && getStr(ref, "keyword_id") != "" {
			label = keywordLabel(ref)
		}
		out.unsupported = append(out.unsupported, unsup(
			"weapon-ability-removal: the cruncher does not model removing a weapon ability (\""+label+"\")",
			map[string]any{"removes": []any{raw}},
		))
	}
	if modifier["if_present"] != nil {
		out.unsupported = append(out.unsupported, unsup("weapon-ability-grant: incrementing an existing keyword rating is not modelled", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("weapon-ability-grant: unresolved "+narrowed, node))
		return
	}
	applicability := combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier))
	for _, raw := range getList(modifier, "keywords") {
		ref, ok := asMap(raw)
		if !ok || ref == nil || getStr(ref, "keyword_id") == "" {
			out.unsupported = append(out.unsupported, unsup("weapon-ability-grant: invalid structured keyword reference", raw))
			continue
		}
		if paramsRaw, present := ref["parameters"]; present {
			params, valid := asMap(paramsRaw)
			if !valid {
				out.unsupported = append(out.unsupported, unsup("weapon-ability-grant: invalid structured keyword reference", raw))
				continue
			}
			if value := params["value"]; value != nil && !isNumber(value) {
				if _, isString := value.(string); !isString {
					out.unsupported = append(out.unsupported, unsup("weapon-ability-grant: keyword rating quantity is unresolved", raw))
					continue
				}
			}
		}
		buff := map[string]any{"source": source, "contribution": map[string]any{"type": "extra-keyword", "keywordRef": ref}}
		out.applied = append(out.applied, withApplicability(buff, applicability))
	}
}

func attackTypeApplicability(modifier map[string]any) map[string]any {
	scope, _ := getMap(modifier, "weapons")
	if scope == nil {
		return nil
	}
	switch scope["type"] {
	case "melee":
		return map[string]any{"phases": []any{"fight"}}
	case "ranged":
		return map[string]any{"phases": []any{"shooting"}}
	}
	return nil
}

// Canonical weapon scope refs that require selecting a particular profile are
// intentionally unsupported by the aggregate cruncher. It must not widen a
// model-specific rule to every weapon when board selection is unavailable.
func unhonorableNarrowing(modifier map[string]any) string {
	if scope, _ := getMap(modifier, "weapons"); scope != nil && scope["ref"] != nil {
		return "weapons.ref"
	}
	return ""
}

func translateDamageReduction(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "target" {
		return
	}
	if !appliesToBuffedUnit(node, "target") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("damage-reduction: missing modifier object", node))
		return
	}
	reduction := modifier["reduction"]
	if isNumber(reduction) {
		r, _ := num(reduction)
		if !math.IsInf(r, 0) && !math.IsNaN(r) && r > 0 {
			out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "damage-reduction", "value": r}})
			return
		}
	}
	if reduction == "half" || reduction == "to-zero" {
		out.unsupported = append(out.unsupported, unsup("damage-reduction: \""+reduction.(string)+"\" is a one-use ablation effect, not modelled by the expected-value engine", node))
		return
	}
	out.unsupported = append(out.unsupported, unsup("damage-reduction: unrecognised reduction \""+jsStr(reduction)+"\"", node))
}

func translateInvulnerableSave(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "target" {
		return
	}
	if !appliesToBuffedUnit(node, "target") {
		return
	}
	modifier, ok := getMap(node, "modifier")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("invulnerable-save: missing modifier object", node))
		return
	}
	threshold := jsNumber(modifier["invuln_sv"])
	if math.IsInf(threshold, 0) || math.IsNaN(threshold) || threshold < 2 || threshold > 7 {
		out.unsupported = append(out.unsupported, unsup("invulnerable-save: invuln_sv \""+jsStr(modifier["invuln_sv"])+"\" is not a valid save threshold (2-7)", node))
		return
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "invulnerable-save", "threshold": threshold}})
}

func translateNamedRegionState(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	if opts.perspective != "attacker" {
		return
	}
	modifier, _ := getMap(node, "modifier")
	consumer, _ := getMap(modifier, "consumer")
	beneficiary, _ := getMap(consumer, "beneficiary_filter")
	matches, reason := auraRecipientFilterMatches(beneficiary, opts.context, opts.perspective)
	if reason != "" {
		out.unsupported = append(out.unsupported, unsup("named-region-state beneficiary filter cannot be evaluated against current attacker keywords", node))
		return
	}
	if !matches {
		return
	}
	defaultBranch, ok := getMap(consumer, "default_branch")
	if !ok {
		out.unsupported = append(out.unsupported, unsup("named-region-state default branch is missing", node))
		return
	}
	dslWalk(defaultBranch["effect"], source, opts, out)
	if qualifiedBranch, ok := getMap(consumer, "qualified_branch"); ok {
		out.unsupported = append(out.unsupported, unsup(
			"named-region-state qualified branch: region membership is unavailable in EngineContext; qualified replacement is unsupported",
			qualifiedBranch,
		))
	}
}

func translateConditional(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	condition, ok := getMap(node, "condition")
	if !ok {
		return
	}
	if isWeaponScopedCondition(condition) {
		if applicability, ok := conditionToApplicability(condition, opts.perspective).(map[string]any); ok {
			sub := &effectTranslation{applied: []any{}, unsupported: []any{}, activatable: []any{}}
			dslWalk(node["effect"], source, opts, sub)
			for _, raw := range sub.applied {
				if buff, ok := asMap(raw); ok {
					out.applied = append(out.applied, applyApplicability(buff, applicability))
				}
			}
			for _, raw := range sub.activatable {
				lever, ok := asMap(raw)
				if !ok {
					continue
				}
				buffs := getList(lever, "buffs")
				for i, buffRaw := range buffs {
					if buff, ok := asMap(buffRaw); ok {
						buffs[i] = applyApplicability(buff, applicability)
					}
				}
				lever["buffs"] = buffs
				out.activatable = append(out.activatable, lever)
			}
			out.unsupported = append(out.unsupported, sub.unsupported...)
			return
		}
	}
	evaluated := condition
	metadata := activationMetadata(node)
	if metadata != nil && isPostOwnAttackMoment(metadata["trigger"]) {
		out.unsupported = append(out.unsupported, unsup(postAttackMoment, metadata["fragment"]))
		return
	}
	if metadata != nil && opts.duration != nil {
		if moment, ok := momentCondition(metadata["trigger"], opts.duration); ok {
			evaluated = moment
		}
	}
	var evalSource map[string]any
	if !opts.grantedHolder {
		evalSource = source
	}
	verdict := evaluateCondition(evaluated, opts.context, opts.perspective, evalSource)
	if verdict == nil {
		if conditionMentionsTiming(condition) {
			enumerateTimingGate(node, source, opts, out)
		} else {
			// An operator condition (`and`, `or`, `not`) has no type; it is named by its operator.
			conditionName := condition["type"]
			if conditionName == nil {
				conditionName = condition["operator"]
			}
			out.unsupported = append(out.unsupported, unsup(
				"conditional: cannot evaluate condition \""+jsStr(conditionName)+"\" against current context",
				activationFragment(node),
			))
		}
		return
	}
	if verdict == true {
		dslWalk(node["effect"], source, opts, out)
	}
}

func conditionMentionsTiming(condition map[string]any) bool {
	if getStr(condition, "type") == "timing-is" {
		return true
	}
	if _, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			for _, o := range operands {
				if om, ok := asMap(o); ok && conditionMentionsTiming(om) {
					return true
				}
			}
		}
	}
	return false
}

func extractTiming(condition map[string]any) string {
	if getStr(condition, "type") == "timing-is" {
		params, _ := getMap(condition, "parameters")
		if t, ok := params["timing"].(string); ok {
			return t
		}
		return ""
	}
	if operands, ok := asList(condition["operands"]); ok {
		for _, o := range operands {
			if om, ok := asMap(o); ok {
				if t := extractTiming(om); t != "" {
					return t
				}
			}
		}
	}
	return ""
}

// conditionToApplicability returns "gate", "context", or a declarative gate.
// negatedWeaponApplicability reads `not attack-is {weapons: {keyword}}` as a weapon exclusion: the
// effect applies to attacks with none of those weapon keywords. Any other negation needs the
// attack context.
func negatedWeaponApplicability(operands []any) any {
	if len(operands) != 1 {
		return "context"
	}
	operand, ok := asMap(operands[0])
	if !ok || getStr(operand, "type") != "attack-is" {
		return "context"
	}
	params, ok := getMap(operand, "parameters")
	if !ok || unhonorableNarrowing(params) != "" {
		return "context"
	}
	for key := range params {
		if key != "weapons" {
			return "context"
		}
	}
	weapons, ok := getMap(params, "weapons")
	if !ok {
		return "context"
	}
	for key := range weapons {
		if key != "keyword" {
			return "context"
		}
	}
	included, _ := weaponApplicability(params)["weaponKeywords"].([]map[string]any)
	if len(included) == 0 {
		return "context"
	}
	return map[string]any{"excludedWeaponKeywords": included}
}

// isWeaponScopedCondition reports an `attack-is` naming weapons, or its negation: the resolver
// gates these per weapon.
func isWeaponScopedCondition(condition map[string]any) bool {
	if getStr(condition, "operator") == "not" {
		operands, ok := asList(condition["operands"])
		if !ok || len(operands) != 1 {
			return false
		}
		operand, ok := asMap(operands[0])
		return ok && operand["operator"] == nil && isWeaponScopedCondition(operand)
	}
	if getStr(condition, "type") != "attack-is" {
		return false
	}
	params, ok := getMap(condition, "parameters")
	return ok && params["weapons"] != nil
}

func conditionToApplicability(condition map[string]any, perspective string) any {
	if op, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			if op == "not" {
				return negatedWeaponApplicability(operands)
			}
			if op != "and" {
				return "context"
			}
			merged := map[string]any{}
			for _, operandAny := range operands {
				operand, ok := asMap(operandAny)
				if !ok {
					return "context"
				}
				a := conditionToApplicability(operand, perspective)
				if a == "gate" {
					continue
				}
				if a == "context" {
					return "context"
				}
				merged = combineApplicability(merged, a.(map[string]any))
			}
			return merged
		}
	}
	params, _ := getMap(condition, "parameters")
	switch getStr(condition, "type") {
	case "timing-is":
		return "gate"
	case "phase-is":
		if phase, ok := params["phase"].(string); ok {
			return map[string]any{"phases": []any{phase}}
		}
	case "matches":
		filter, ok := getMap(params, "filter")
		if !ok || len(filter) != 1 || filter["all_of"] == nil {
			return "context"
		}
		kw, ok := singleKeyword(filter)
		if !ok {
			return "context"
		}
		switch params["subject"] {
		case "defender":
			return map[string]any{"requiresTargetKeyword": kw}
		case "attacker":
			return map[string]any{"requiresAttackerKeyword": kw}
		}
		if isBuffedUnit(params["subject"]) {
			if perspective == "target" {
				return map[string]any{"requiresTargetKeyword": kw}
			}
			return map[string]any{"requiresAttackerKeyword": kw}
		}
	case "attack-is":
		if params == nil || unhonorableNarrowing(params) != "" {
			return "context"
		}
		for key := range params {
			if key != "attack_type" && key != "weapons" {
				return "context"
			}
		}
		var phase map[string]any
		switch params["attack_type"] {
		case "melee":
			phase = map[string]any{"phases": []any{"fight"}}
		case "ranged":
			phase = map[string]any{"phases": []any{"shooting"}}
		}
		if applicability := combineOptional(phase, combineOptional(attackTypeApplicability(params), weaponApplicability(params))); applicability != nil {
			return applicability
		}
	}
	return "context"
}

func combineApplicability(a, b map[string]any) map[string]any {
	out := cloneMap(a)
	if bp := getList(b, "phases"); len(bp) > 0 {
		if ap := getList(a, "phases"); len(ap) > 0 {
			var inter []any
			for _, p := range ap {
				if containsAnyV(bp, p) {
					inter = append(inter, p)
				}
			}
			if inter == nil {
				inter = []any{}
			}
			out["phases"] = inter
		} else {
			out["phases"] = bp
		}
	}
	if v, ok := b["rollType"]; ok && v != nil {
		out["rollType"] = v
	}
	if v, ok := b["requiresTargetKeyword"]; ok && v != nil {
		out["requiresTargetKeyword"] = v
	}
	if v, ok := b["requiresAttackerKeyword"]; ok && v != nil {
		out["requiresAttackerKeyword"] = v
	}
	if v, ok := b["weaponName"].(string); ok && v != "" {
		out["weaponName"] = v
	}
	if v := b["weaponKeywords"]; v != nil {
		out["weaponKeywords"] = v
	}
	if v := b["excludedWeaponNames"]; v != nil {
		out["excludedWeaponNames"] = v
	}
	if v := b["excludedWeaponKeywords"]; v != nil {
		out["excludedWeaponKeywords"] = v
	}
	if bx, ok := asList(b["excludedTargetKeywords"]); ok {
		union := []any{}
		for _, k := range append(append([]any{}, getList(a, "excludedTargetKeywords")...), bx...) {
			if !containsAnyV(union, k) {
				union = append(union, k)
			}
		}
		out["excludedTargetKeywords"] = union
	}
	return out
}

func applyApplicability(buff map[string]any, applicability map[string]any) map[string]any {
	if len(applicability) == 0 {
		return buff
	}
	merged := applicability
	if existing, ok := getMap(buff, "applicableWhen"); ok {
		merged = combineApplicability(existing, applicability)
	}
	out := cloneMap(buff)
	out["applicableWhen"] = merged
	return out
}

func labelForBuffs(buffs []any) string {
	seen := map[string]bool{}
	var parts []string
	for _, bAny := range buffs {
		b, _ := asMap(bAny)
		c, _ := getMap(b, "contribution")
		p := describeContribution(c)
		if !seen[p] {
			seen[p] = true
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return "buff"
	}
	return strings.Join(parts, ", ")
}

func describeContribution(c map[string]any) string {
	switch getStr(c, "type") {
	case "extra-keyword":
		ref, _ := getMap(c, "keywordRef")
		return keywordLabel(ref)
	case "hit-mod":
		return signedStr(c["value"]) + " to hit"
	case "wound-mod":
		return signedStr(c["value"]) + " to wound"
	case "save-mod":
		return signedStr(c["value"]) + " to save"
	case "damage-mod":
		return signedStr(c["value"]) + " damage"
	case "attacks-mod":
		return signedStr(c["value"]) + " attacks"
	case "strength-mod":
		return signedStr(c["value"]) + " strength"
	case "toughness-mod":
		return signedStr(c["value"]) + " toughness"
	case "ap-mod":
		return "AP " + numStr(c["value"])
	case "reroll":
		ones := ""
		if getStr(c, "subset") == "ones" {
			ones = " 1s"
		}
		return "re-roll " + getStr(c, "roll") + ones
	case "reroll-one":
		return "re-roll one " + getStr(c, "roll")
	case "feel-no-pain":
		if getStr(c, "scope") == "mortal" {
			return "feel no pain " + numStr(c["threshold"]) + "+ vs mortals"
		}
		return "feel no pain " + numStr(c["threshold"]) + "+"
	case "damage-reduction":
		return "-" + numStr(c["value"]) + " damage"
	case "invulnerable-save":
		return numStr(c["threshold"]) + "+ invuln"
	case "crit-threshold":
		return "critical " + getStr(c, "roll") + " on " + numStr(c["value"]) + "+"
	case "ignore-modifiers":
		return "ignore " + getStr(c, "roll") + " modifiers"
	case "skill-mod":
		return getStr(c, "stat") + " improved by " + numStr(c["value"])
	case "save-characteristic":
		return numStr(c["value"]) + "+ save"
	case "save-improve":
		return "Save improved by " + numStr(c["value"]) + " (no better than " + numStr(c["best"]) + "+)"
	}
	return "cover"
}

func signedStr(v any) string {
	n, _ := num(v)
	if n >= 0 {
		return "+" + numStr(v)
	}
	return numStr(v)
}

func keywordLabel(ref map[string]any) string {
	params, _ := getMap(ref, "parameters")
	if getStr(ref, "keyword_id") == "anti" {
		if tk, ok := params["target_keyword"].(string); ok {
			suffix := ""
			if isNumber(params["threshold"]) {
				suffix = " " + numStr(params["threshold"]) + "+"
			}
			return "Anti-" + tk + suffix
		}
	}
	var words []string
	for _, w := range strings.Split(getStr(ref, "keyword_id"), "-") {
		if w == "" {
			words = append(words, w)
		} else {
			words = append(words, strings.ToUpper(w[:1])+w[1:])
		}
	}
	base := strings.Join(words, " ")
	if isNumber(params["value"]) {
		return base + " " + numStr(params["value"])
	}
	return base
}

// --- condition evaluator ---

// evaluateCondition returns bool, or nil for "unknown".
// isBuffedUnit reports the buffed unit: the ability's own unit (or model), or
// the unit an aura is applied to.
func isBuffedUnit(subject any) bool {
	return subject == nil || subject == "this-unit" || subject == "ability-unit" || subject == "this-model" || subject == "recipient"
}

// singleKeyword returns the one keyword a `has-keyword` names.
func singleKeyword(params map[string]any) (string, bool) {
	all, _ := asList(params["all_of"])
	if params["any_of"] != nil || len(all) != 1 {
		return "", false
	}
	kw, ok := all[0].(string)
	return kw, ok
}

// contextKeywordList reads a context keyword list; ok is false when it is absent or holds a
// non-string.
func contextKeywordList(raw any) ([]string, bool) {
	items, ok := asList(raw)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			return nil, false
		}
		out = append(out, text)
	}
	return out, true
}

// modelKeywordVerdict evaluates a keyword predicate over a unit's models: true when every model
// meets it, false when no model can, else nil. Every model carries every and none carries more
// than most. Clauses that need more keywords (all_of, any_of) are settled for every model by
// every and for none by most; clauses that need fewer (none_of, not_all_of) the other way round.
func modelKeywordVerdict(predicates map[string]any, every []string, everyKnown bool, most []string, mostKnown bool) any {
	allModels := true
	for _, key := range []string{"all_of", "any_of", "none_of", "not_all_of"} {
		value, present := predicates[key]
		if !present {
			continue
		}
		clause := map[string]any{key: value}
		least, leastKnown, upper, upperKnown := every, everyKnown, most, mostKnown
		if key == "none_of" || key == "not_all_of" {
			least, leastKnown, upper, upperKnown = most, mostKnown, every, everyKnown
		}
		if upperKnown && !unitMatchesAppliesTo(clause, upper) {
			return false
		}
		if !leastKnown || !unitMatchesAppliesTo(clause, least) {
			allModels = false
		}
	}
	if allModels {
		return true
	}
	return nil
}

// matchesUnitFilter evaluates only unit facts carried by the crunch context.
// It returns bool, or nil when a board, model, or relationship fact is unavailable.
//
// owner says whose the filter is relative to the filtered unit: the ability
// belongs to side when the unit is friendly, and to the other side when it is
// an enemy.
func matchesUnitFilter(filter, ctx map[string]any, side, owner string) any {
	abilitySide := side
	if owner != "friendly" {
		abilitySide = otherSide(side)
	}
	unknown := false
	memberSide := filter["member_of"] == "this-unit"
	if side == "attacker" {
		memberSide = memberSide || filter["member_of"] == "attacker"
	} else {
		memberSide = memberSide || filter["member_of"] == "defender"
	}
	keywordsKey := "targetKeywords"
	if side == "attacker" {
		keywordsKey = "attackerKeywords"
	}
	predicates := map[string]any{}
	for _, key := range []string{"all_of", "any_of", "none_of", "not_all_of"} {
		raw, present := filter[key]
		if !present {
			continue
		}
		items, ok := asList(raw)
		if !ok {
			return nil
		}
		for _, item := range items {
			if _, ok := item.(string); !ok {
				return nil
			}
		}
		predicates[key] = items
	}
	modelPredicate := filter["level"] == "model" && len(predicates) > 0
	everyModelMatches := false
	if modelPredicate {
		modelKeywordsKey := "targetModelKeywords"
		if side == "attacker" {
			modelKeywordsKey = "attackerModelKeywords"
		}
		every, everyKnown := contextKeywordList(ctx[modelKeywordsKey])
		most, mostKnown := contextKeywordList(ctx[keywordsKey])
		switch verdict := modelKeywordVerdict(predicates, every, everyKnown, most, mostKnown); verdict {
		case false:
			return false
		case nil:
			unknown = true
		default:
			everyModelMatches = true
		}
	} else if len(predicates) > 0 {
		rawKeywords, present := asList(ctx[keywordsKey])
		if !present {
			unknown = true
		} else {
			ownedKeywords := make([]string, 0, len(rawKeywords))
			keywordsValid := true
			for _, keyword := range rawKeywords {
				text, ok := keyword.(string)
				if !ok {
					unknown = true
					keywordsValid = false
					continue
				}
				ownedKeywords = append(ownedKeywords, text)
			}
			if keywordsValid && !unitMatchesAppliesTo(predicates, ownedKeywords) {
				return false
			}
		}
	}
	for key, value := range filter {
		if _, predicate := predicates[key]; predicate {
			continue
		}
		switch key {
		case "owner":
			wanted, ok := value.(string)
			if !ok {
				return nil
			}
			if wanted != "any" && wanted != owner {
				return false
			}
		case "unit_ids":
			ids, ok := asList(value)
			if !ok || len(ids) == 0 || filter["level"] != "unit" {
				return nil
			}
			idKey := "targetUnitId"
			if side == "attacker" {
				idKey = "attackerUnitId"
			}
			identity, ok := ctx[idKey].(string)
			if !ok {
				unknown = true
				continue
			}
			matched := false
			for _, rawID := range ids {
				id, ok := rawID.(string)
				if !ok {
					return nil
				}
				matched = matched || id == identity
			}
			if !matched {
				return false
			}
		case "any_of_filters":
			alternatives, ok := asList(value)
			if !ok || len(alternatives) == 0 {
				return nil
			}
			matched := false
			alternativeUnknown := false
			for _, rawAlternative := range alternatives {
				alternative, ok := asMap(rawAlternative)
				if !ok || alternative == nil {
					alternativeUnknown = true
					continue
				}
				switch matchesUnitFilter(alternative, ctx, side, owner) {
				case true:
					matched = true
				case nil:
					alternativeUnknown = true
				}
			}
			if !matched {
				if !alternativeUnknown {
					return false
				}
				unknown = true
			}
		case "state":
			if value != "benefit-of-cover" {
				switch matchesStateFilter(value, ctx, side) {
				case false:
					return false
				case nil:
					unknown = true
				}
				continue
			}
			coverKey := "targetInCover"
			if side == "attacker" {
				coverKey = "attackerInCover"
			}
			switch ctx[coverKey] {
			case false:
				return false
			case true:
			default:
				unknown = true
			}
		case "within":
			within, ok := asMap(value)
			if !ok || within == nil || within["wholly"] == true {
				unknown = true
				continue
			}
			if objective, ok := objectiveWithin(within); ok {
				verdict := any(nil)
				if within["range"] == "objective-control" {
					verdict = withinObjective(objective, sideValue(ctx, side, "Objectives"), abilitySide)
				}
				switch verdict {
				case false:
					return false
				case nil:
					unknown = true
				}
				continue
			}
			other := "attacker"
			if side == "attacker" {
				other = "defender"
			}
			ofAbilityUnit := (within["of"] == "this-unit" || within["of"] == "ability-unit") && abilitySide != side
			if within["of"] != other && !ofAbilityUnit {
				unknown = true
				continue
			}
			if within["range"] == "half-weapon" {
				switch ctx["withinHalfRange"] {
				case false:
					return false
				case true:
				default:
					unknown = true
				}
				continue
			}
			rangeRef, ok := asMap(within["range"])
			if !ok || rangeRef == nil {
				unknown = true
				continue
			}
			if tiers, ok := asList(rangeRef["per_battle_round"]); ok {
				battleRound, roundKnown := filterNumber(ctx["battleRound"])
				if !roundKnown || len(tiers) == 0 {
					unknown = true
					continue
				}
				index := max(int(battleRound)-1, 0)
				if index >= len(tiers) {
					index = len(tiers) - 1
				}
				rangeRef, ok = asMap(tiers[index])
				if !ok || rangeRef == nil {
					unknown = true
					continue
				}
			}
			inches, rangeKnown := filterNumber(rangeRef["inches"])
			distance, distanceKnown := filterNumber(ctx["distanceInches"])
			if !rangeKnown || !distanceKnown {
				unknown = true
			} else if distance > inches {
				return false
			}
		case "level":
			if value == "unit" || (value == "model" && filter["attachment_role"] != nil && memberSide) {
				continue
			}
			// Every model of the unit meets the keyword predicate, so the filter selects the whole unit.
			if value == "model" && everyModelMatches && filter["attachment_role"] == nil {
				continue
			}
			unknown = true
		case "attachment_role":
			if filter["level"] != "model" || !memberSide {
				unknown = true
				continue
			}
			roleKey := "targetAttachmentRole"
			if side == "attacker" {
				roleKey = "attackerAttachmentRole"
			}
			actual, ok := ctx[roleKey].(string)
			if !ok {
				unknown = true
			} else if actual != value {
				return false
			}
		case "designated":
			wanted, ok := value.(string)
			if !ok {
				unknown = true
				continue
			}
			switch matchesDesignatedFilter(wanted, ctx, side) {
			case false:
				return false
			case nil:
				unknown = true
			}
		case "member_of":
			if !memberSide || filter["attachment_role"] == nil {
				unknown = true
			}
		default:
			unknown = true
		}
	}
	if unknown {
		return nil
	}
	return true
}

func filterNumber(value any) (float64, bool) {
	if !isNumber(value) {
		return 0, false
	}
	return reflect.ValueOf(value).Convert(reflect.TypeOf(float64(0))).Float(), true
}

func evaluateCondition(condition, ctx map[string]any, rest ...any) any {
	perspective := "attacker"
	var source map[string]any
	if len(rest) > 0 {
		if value, ok := rest[0].(string); ok && value != "" {
			perspective = value
		}
	}
	if len(rest) > 1 {
		source, _ = asMap(rest[1])
	}
	if op, ok := condition["operator"].(string); ok {
		if operands, ok := asList(condition["operands"]); ok {
			return evaluateCompound(op, operands, ctx, perspective, source)
		}
	}
	params, _ := getMap(condition, "parameters")
	switch getStr(condition, "type") {
	case "phase-is":
		wanted, ok := params["phase"].(string)
		if !ok {
			return nil
		}
		return ctx["phase"] == wanted
	case "attack-is":
		for key := range params {
			if key != "attack_type" {
				return nil
			}
		}
		switch params["attack_type"] {
		case "melee":
			return ctx["phase"] == "fight"
		case "ranged":
			return ctx["phase"] == "shooting"
		}
		return nil
	case "timing-is":
		wanted, ok := params["timing"].(string)
		if !ok || ctx["timing"] == nil {
			return nil
		}
		return ctx["timing"] == wanted
	case "happened":
		filter, _ := getMap(params, "filter")
		types, _ := asList(filter["move_types"])
		own := params["subject"] == nil && params["object"] == nil && params["count"] == nil && params["window"] == "turn"
		if !own || params["event"] != "move-ended" || len(types) != 1 || len(filter) != 1 {
			return nil
		}
		switch types[0] {
		case "remain-stationary":
			return ctx["attackerStationary"] == true
		case "charge":
			if ctx["attackerCharged"] == nil {
				return nil
			}
			return ctx["attackerCharged"] == true
		}
		return nil
	case "attachment":
		if params["with"] != nil {
			return nil
		}
		subject := params["subject"]
		explicitSide := ""
		switch subject {
		case "attacker":
			explicitSide = "attacker"
		case "defender":
			explicitSide = "target"
		default:
			if subject != nil && subject != "this-model" && subject != "this-unit" && subject != "ability-unit" {
				return nil
			}
		}
		side := explicitSide
		if side == "" {
			side = perspective
		}
		var attached any
		var role any
		if side == "attacker" {
			attached = ctx["attackerAttached"]
			role = ctx["attackerAttachmentRole"]
		} else {
			attached = ctx["targetAttached"]
			role = ctx["targetAttachmentRole"]
		}
		if explicitSide == "" && getStr(source, "kind") == "ability" &&
			(getStr(source, "abilityKind") == "attached" || getStr(source, "abilityKind") == "support") {
			if roles, ok := getMap(ctx, "attachmentRoles"); ok {
				role = roles[getStr(source, "sourceUnitId")]
			} else {
				role = nil
			}
			if getStr(source, "abilityKind") == "attached" {
				attached = true
			} else if role == nil {
				attached = nil
			} else {
				attached = true
			}
		}
		if attached == false {
			return false
		}
		switch params["role"] {
		case "attached":
			if attached == nil {
				return nil
			}
			return attached == true
		case "leading":
			if role == nil {
				return nil
			}
			return role == "leader"
		case "led":
			if role == "bodyguard" {
				return true
			}
		}
		return nil
	case "matches":
		filter, ok := getMap(params, "filter")
		if !ok {
			return nil
		}
		side := conditionSide(params["subject"], perspective)
		if side == "" {
			return nil
		}
		// Ownership is relative to the side whose ability it is.
		owner := "enemy"
		if side == perspectiveSide(perspective) {
			owner = "friendly"
		}
		return matchesUnitFilter(filter, ctx, side, owner)
	case "army-faction":
		// "Your Army Faction" is the army of the side whose ability it is.
		faction, ok := params["faction"].(string)
		armyKey := "armyFaction"
		if perspective == "target" {
			armyKey = "targetArmyFaction"
		}
		if !ok || ctx[armyKey] == nil {
			return nil
		}
		return ctx[armyKey] == faction
	case "model-count":
		// "contains N or more models": min and max are inclusive. A keyword-restricted count needs
		// per-keyword model counts the context does not carry.
		if params["keyword"] != nil {
			return nil
		}
		side := conditionSide(params["subject"], perspective)
		key := map[string]string{"attacker": "attackerModelCount", "target": "targetModelCount"}[side]
		count, ok := contextNumber(ctx[key])
		if key == "" || !ok {
			return nil
		}
		if minimum, ok := contextNumber(params["min"]); ok && count < minimum {
			return false
		}
		if maximum, ok := contextNumber(params["max"]); ok && count > maximum {
			return false
		}
		return true
	case "unit-wargear":
		return evaluateUnitWargear(params, ctx, perspective)
	case "battle-size":
		size, ok := params["size"].(string)
		if !ok || ctx["battleSize"] == nil {
			return nil
		}
		return ctx["battleSize"] == size
	case "battle-round", "player-turn-is", "strength", "wounds", "closest":
		return evaluateScenarioCondition(getStr(condition, "type"), params, ctx, perspective)
	case "guided":
		if (params["subject"] != nil && !isBuffedUnit(params["subject"])) || ctx["attackerGuided"] == nil {
			return nil
		}
		return ctx["attackerGuided"] == true
	}
	return nil
}

func evaluateCompound(operator string, operands []any, ctx map[string]any, perspective string, source map[string]any) any {
	if operator == "not" {
		if len(operands) == 0 {
			return nil
		}
		first, ok := asMap(operands[0])
		if !ok {
			return nil
		}
		value := evaluateCondition(first, ctx, perspective, source)
		if value == nil {
			return nil
		}
		return !value.(bool)
	}
	if operator != "and" && operator != "or" {
		return nil
	}
	sawUnknown := false
	for _, operandAny := range operands {
		operand, ok := asMap(operandAny)
		if !ok {
			sawUnknown = true
			continue
		}
		value := evaluateCondition(operand, ctx, perspective, source)
		if value == nil {
			sawUnknown = true
			continue
		}
		if operator == "and" && value == false {
			return false
		}
		if operator == "or" && value == true {
			return true
		}
	}
	if sawUnknown {
		return nil
	}
	return operator == "and"
}

// --- helpers ---

func jsStr(v any) string {
	switch x := v.(type) {
	case nil:
		return "undefined"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return numStr(x)
	case string:
		return x
	}
	return numStr(v)
}

func jsNumberEq(v any, target float64) bool {
	n := jsNumber(v)
	return !math.IsNaN(n) && n == target
}

func signedValue(modifier map[string]any) (float64, bool) {
	value := jsNumber(modifier["value"])
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return 0, false
	}
	switch modifier["operation"] {
	case "add", "improve":
		return value, true
	case "subtract", "worsen":
		return -value, true
	}
	return 0, false
}

func apDelta(modifier map[string]any) (float64, bool) {
	value := jsNumber(modifier["value"])
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return 0, false
	}
	switch modifier["operation"] {
	case "improve":
		return -math.Abs(value), true
	case "worsen":
		return math.Abs(value), true
	case "add":
		return value, true
	case "subtract":
		return -value, true
	}
	return 0, false
}

func containsAnyV(l []any, v any) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

const fidelityBindingReason = "selection/history/model/attack predicates are not resolved by the buff engine"

func hasUnresolvedFidelityBinding(n map[string]any) bool {
	selector, _ := getMap(n, "selector")
	applies, _ := getMap(n, "applies")
	modifier, _ := getMap(n, "modifier")
	consumer, _ := getMap(modifier, "consumer")
	selectorUnresolved := false
	if n["type"] == "select-units" || n["type"] == "for-each-unit" {
		filter, _ := getMap(selector, "filter")
		for key := range filter {
			switch key {
			case "owner", "level", "member_of", "attachment_role", "all_of", "any_of", "none_of", "not_all_of":
			default:
				selectorUnresolved = true
			}
		}
		selectorUnresolved = selectorUnresolved ||
			selector["eligibility"] != nil ||
			selector["limit"] != nil ||
			selector["bind_as"] != nil
	}
	// A designation's own selection (range, visibility, eligibility) is what its lever's player vouches for.
	designationUnresolved := n["type"] == "designate-target" && (applies["attacker_filter"] != nil ||
		applies["attacker_unit_filter"] != nil ||
		applies["beneficiary"] != nil ||
		applies["reference"] != nil)
	triggerUnresolved := n["type"] == "ability-part" && hasUnresolvedTriggerBinding(n["trigger"])
	return selectorUnresolved ||
		designationUnresolved ||
		triggerUnresolved ||
		(n["type"] == "named-region-state" && consumer["attack_condition"] != nil)
}

func hasUnresolvedTriggerBinding(raw any) bool {
	if triggers, ok := asList(raw); ok {
		for _, trigger := range triggers {
			if hasUnresolvedTriggerBinding(trigger) {
				return true
			}
		}
		return false
	}
	trigger, ok := asMap(raw)
	if !ok || trigger == nil {
		return false
	}
	filter, isFilter := asMap(trigger["filter"])
	return (isFilter && filter != nil && filter["by"] != nil) || trigger["source_ability"] != nil
}

// contextNumber reads a JSON number (float64) or a Go-built integer from a context or parameter.
func contextNumber(value any) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case int:
		return float64(number), true
	case int64:
		return float64(number), true
	}
	return 0, false
}

// evaluateUnitWargear reads `unit-wargear` from the side's chosen loadout. With `models`, the
// bounds count the models that carry the item (state carry) or lack it (state lack, which needs
// the unit's model count). It returns bool, or nil when unknown.
func evaluateUnitWargear(params map[string]any, ctx map[string]any, perspective string) any {
	side := conditionSide(params["subject"], perspective)
	wargearKey := map[string]string{"attacker": "attackerWargear", "target": "targetWargear"}[side]
	countKey := map[string]string{"attacker": "attackerModelCount", "target": "targetModelCount"}[side]
	id, ok := params["wargear"].(string)
	wargear, present := asMap(ctx[wargearKey])
	if wargearKey == "" || !ok || !present {
		return nil
	}
	carried := 0.0
	if value, ok := contextNumber(wargear[id]); ok {
		carried = value
	}
	rawModels, hasModels := params["models"]
	if !hasModels {
		return carried > 0
	}
	models, _ := asMap(rawModels)
	bounds, _ := asMap(models["count"])
	var counted float64
	switch models["state"] {
	case "carry":
		counted = carried
	case "lack":
		modelCount, ok := contextNumber(ctx[countKey])
		if !ok {
			return nil
		}
		counted = modelCount - carried
	default:
		return nil
	}
	for _, key := range []string{"min", "max"} {
		raw, present := bounds[key]
		if !present {
			continue
		}
		value, ok := contextNumber(raw)
		if !ok || value != math.Trunc(value) {
			return nil
		}
	}
	if minimum, ok := contextNumber(bounds["min"]); ok && counted < minimum {
		return false
	}
	if maximum, ok := contextNumber(bounds["max"]); ok && counted > maximum {
		return false
	}
	return true
}
