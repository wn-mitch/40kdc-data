package wh40kdc

import "math"

// Buff-layer translation of the damage levers: weapon-name gates, WS/BS changes, a set Save, set
// weapon characteristics, critical thresholds (roll-result), ignored hit/wound modifiers, and the
// core abilities the buff layer models on the unit being attacked (ability-grant). Mirror of the matching helpers in
// tools/src/cruncher/from-dsl.ts.

// criticalOnlyKeys are the modifier keys a critical-threshold-only roll-result may carry.
var criticalOnlyKeys = map[string]bool{"roll": true, "critical_on": true, "attack_type": true, "weapons": true}

// weaponKeywordSelectors returns the canonical catalog-backed selectors in a
// weapon scope. A single selector and an explicit any-of array have identical
// matching semantics; retaining the structured reference preserves parameters
// such as Anti's target keyword and threshold.
func weaponKeywordSelectors(raw any) []map[string]any {
	if one, ok := asMap(raw); ok && one != nil {
		return []map[string]any{one}
	}
	list, _ := asList(raw)
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if ref, ok := asMap(item); ok && ref != nil {
			out = append(out, ref)
		}
	}
	return out
}

// weaponApplicability translates the canonical weapon scope to the internal
// applicability shape consumed by the expected-value engine. Catalog refs are
// kept intact; runtime matching can therefore distinguish parameterized
// keywords rather than parsing display strings.
func weaponApplicability(modifier map[string]any) map[string]any {
	scope, _ := getMap(modifier, "weapons")
	if scope == nil {
		return nil
	}
	out := map[string]any{}
	if kind := getStr(scope, "type"); kind != "" {
		if kind == "melee" {
			out["phases"] = []any{"fight"}
		} else if kind == "ranged" {
			out["phases"] = []any{"shooting"}
		}
	}
	if name := getStr(scope, "name"); name != "" {
		out["weaponName"] = lower(name)
	}
	if refs := weaponKeywordSelectors(scope["keyword"]); len(refs) > 0 {
		out["weaponKeywords"] = refs
	}
	if name := getStr(scope, "exclude_name"); name != "" {
		out["excludedWeaponNames"] = []any{lower(name)}
	}
	if refs := weaponKeywordSelectors(scope["exclude_keyword"]); len(refs) > 0 {
		out["excludedWeaponKeywords"] = refs
	}
	if scope["ref"] != nil {
		// A bound weapon is a board selection, not a profile property available
		// to the cruncher. Refusing it is safer than widening the modifier.
		out["unresolvedWeaponRef"] = scope["ref"]
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// combineOptional combines two optional applicabilities (TS combineOptional).
func combineOptional(a, b map[string]any) map[string]any {
	if a != nil && b != nil {
		return combineApplicability(a, b)
	}
	if a != nil {
		return a
	}
	return b
}

// withApplicability attaches applicability to buff when present.
func withApplicability(buff, applicability map[string]any) map[string]any {
	if applicability != nil {
		buff["applicableWhen"] = applicability
	}
	return buff
}

// isIntIn reports JS `Number.isInteger(v) && v >= low && v <= high`.
func isIntIn(v float64, low, high float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v == math.Trunc(v) && v >= low && v <= high
}

// numericValue is modifier.value when it is a number (JS `typeof value === "number"`), else NaN.
func numericValue(modifier map[string]any) float64 {
	if v, ok := modifier["value"].(float64); ok {
		return v
	}
	return math.NaN()
}

func isFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// translateSkillModifier handles a WS/BS stat-modifier: on the attacker it is a hit-mod on
// incoming attacks of that type (target perspective); on the buffed unit it is a skill-mod.
func translateSkillModifier(node, source, modifier map[string]any, stat string, isOnBuffedUnit bool, opts dslOpts, out *effectTranslation, emit func(map[string]any)) {
	phase := "fight"
	if stat == "BS" {
		phase = "shooting"
	}
	if classifyTarget(node) == "attacker" {
		if opts.perspective != "target" {
			return
		}
		if skill, ok := signedValue(modifier); ok {
			out.applied = append(out.applied, map[string]any{"source": source, "applicableWhen": map[string]any{"phases": []any{phase}}, "contribution": map[string]any{"type": "hit-mod", "value": skill}})
		}
		return
	}
	if opts.perspective != "attacker" || !isOnBuffedUnit {
		return
	}
	// Only a numeric value sizes the change; a missing or null one is not read as 0.
	improvement := math.NaN()
	switch modifier["operation"] {
	case "improve":
		improvement = numericValue(modifier)
	case "worsen":
		improvement = -numericValue(modifier)
	}
	if !isFinite(improvement) {
		out.unsupported = append(out.unsupported, unsup("stat-modifier "+stat+": operation \""+jsStr(modifier["operation"])+"\" not supported", node))
		return
	}
	emit(map[string]any{"type": "skill-mod", "stat": stat, "value": improvement + 0})
}

// translateSaveSet handles a stat-modifier that sets the Save characteristic (defender-side).
// translateStatSet lowers a set A, S, T or D. A, S and D on the buffed unit replace its weapons'
// characteristic before modifiers; a set Toughness and a set Damage of incoming attacks are not
// modelled.
func translateStatSet(node, modifier map[string]any, stat string, isOnBuffedUnit bool, opts dslOpts, out *effectTranslation, emit func(map[string]any)) {
	if stat == "T" {
		out.unsupported = append(out.unsupported, unsup("stat-modifier T: setting the Toughness characteristic is not modelled", node))
		return
	}
	if stat == "D" && classifyTarget(node) == "attacker" {
		if opts.perspective == "target" {
			out.unsupported = append(out.unsupported, unsup("stat-modifier D: setting the Damage of incoming attacks is not modelled", node))
		}
		return
	}
	if opts.perspective != "attacker" || !isOnBuffedUnit {
		return
	}
	value := numericValue(modifier)
	if math.IsNaN(value) || math.IsInf(value, 0) || value != math.Trunc(value) || value < 0 {
		out.unsupported = append(out.unsupported, unsup("stat-modifier "+stat+": set value \""+jsStr(modifier["value"])+"\" is not a characteristic", node))
		return
	}
	emit(map[string]any{"type": "stat-set", "stat": stat, "value": value})
}

func translateSaveSet(node, modifier map[string]any, isOnBuffedUnit bool, opts dslOpts, out *effectTranslation, emit func(map[string]any)) {
	if opts.perspective != "target" {
		out.unsupported = append(out.unsupported, unsup("stat-modifier Sv: defender-side stat; applies when the buffed unit is the target", node))
		return
	}
	saveValue := numericValue(modifier)
	if !isOnBuffedUnit {
		return
	}
	if isIntIn(saveValue, 2, 6) {
		emit(map[string]any{"type": "save-characteristic", "value": saveValue})
		return
	}
	if math.IsNaN(saveValue) {
		out.unsupported = append(out.unsupported, unsup("stat-modifier Sv: set has no numeric value", node))
		return
	}
	out.unsupported = append(out.unsupported, unsup("stat-modifier Sv: set value \""+numStr(saveValue)+"\" is not a save characteristic", node))
}

func modifierOrEmpty(node map[string]any) map[string]any {
	if modifier, ok := getMap(node, "modifier"); ok && modifier != nil {
		return modifier
	}
	return map[string]any{}
}

// translateRollResult handles a changed roll result. Only a critical threshold on the buffed
// unit's own hit or wound roll is in the damage math; a fixed result for any other roll
// (advance, battle-shock, ...) is outside it.
func translateRollResult(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier := modifierOrEmpty(node)
	roll, _ := modifier["roll"].(string)
	if roll != "hit" && roll != "wound" && roll != "save" && roll != "damage" {
		out.unsupported = append(out.unsupported, unsup("roll-result on \""+rollLabel(modifier["roll"])+"\" is outside the damage path", node))
		return
	}
	if narrowed := unhonorableNarrowing(modifier); narrowed != "" {
		out.unsupported = append(out.unsupported, unsup("roll-result: narrows by \""+narrowed+"\" which the cruncher can't resolve here", node))
		return
	}
	critical := jsNumber(modifier["critical_on"])
	onlyCritical := true
	for key := range modifier {
		if !criticalOnlyKeys[key] {
			onlyCritical = false
			break
		}
	}
	if (roll != "hit" && roll != "wound") || !onlyCritical || !isIntIn(critical, 2, 6) {
		out.unsupported = append(out.unsupported, unsup("roll-result on \""+roll+"\": only a critical threshold on hit or wound rolls is modelled", node))
		return
	}
	if opts.perspective != "attacker" || !appliesToBuffedUnit(node, "attacker") {
		return
	}
	applicability := combineOptional(attackTypeApplicability(modifier), weaponApplicability(modifier))
	out.applied = append(out.applied, withApplicability(map[string]any{"source": source, "contribution": map[string]any{"type": "crit-threshold", "roll": roll, "value": critical}}, applicability))
}

// translateIgnoreModifiers handles ignoring modifiers to the buffed unit's own hit or wound
// rolls. Ignoring WS/BS modifiers is the same lever here: the buff layer changes WS/BS for
// incoming attacks only through hit modifiers.
func translateIgnoreModifiers(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier := modifierOrEmpty(node)
	var listed any
	switch modifier["what"] {
	case "rolls":
		listed = modifier["rolls"]
	case "characteristics":
		listed = modifier["stats"]
	}
	items, _ := asList(listed)
	rolls := make([]string, 0, len(items))
	supported := len(items) > 0
	for _, item := range items {
		roll, _ := item.(string)
		if roll == "WS" || roll == "BS" {
			roll = "hit"
		}
		if roll != "hit" && roll != "wound" {
			supported = false
		}
		rolls = append(rolls, roll)
	}
	if !supported {
		out.unsupported = append(out.unsupported, unsup("ignore-modifiers: only hit and wound rolls and WS/BS are modelled", node))
		return
	}
	if opts.perspective != "attacker" || !appliesToBuffedUnit(node, "attacker") {
		return
	}
	seen := map[string]bool{}
	for _, roll := range rolls {
		if seen[roll] {
			continue
		}
		seen[roll] = true
		out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{"type": "ignore-modifiers", "roll": roll}})
	}
}

// translateAbilityGrant translates a printed grant's (`definition`) body for the holders.
// Otherwise it handles the core abilities the buff layer models on the unit being attacked:
// Stealth and the benefit of cover (Stealth gives the benefit of cover) and Feel No Pain. Like
// the other defender-side leaves, they contribute nothing to the buffed unit's own attacks.
func translateAbilityGrant(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	modifier := modifierOrEmpty(node)
	// A printed grant carries the granted ability's body: it is the holders' own ability, so it
	// reaches the buffed unit exactly when the grant does, and its "this unit" is the holder.
	if definition, ok := modifier["definition"].(map[string]any); ok {
		switch classifyTarget(node) {
		case "self":
			target, _ := getMap(node, "target")
			if t := getStr(node, "target"); t == "this-model" || t == "model-in-this-unit" || getStr(target, "level") == "model" {
				out.unsupported = append(out.unsupported, unsup("ability-grant: model-only definition cannot be applied to the entire unit", node))
				break
			}
			grantedOpts := opts
			grantedOpts.grantedHolder = true
			dslWalk(definition, source, grantedOpts, out)
		case "unknown":
			out.unsupported = append(out.unsupported, unsup("ability-grant: the units holding the granted ability are not resolved", node))
		}
		return
	}
	ability := modifier["ability"]
	fnp := jsNumber(modifier["value"])
	var contribution map[string]any
	switch {
	case ability == "stealth" || ability == "benefit-of-cover":
		contribution = map[string]any{"type": "cover"}
	case ability == "feel-no-pain" && isIntIn(fnp, 2, 6):
		contribution = map[string]any{"type": "feel-no-pain", "threshold": fnp}
	}
	if contribution == nil {
		out.unsupported = append(out.unsupported, unsup("effect type \"ability-grant\" is not modelled by the buff layer", node))
		return
	}
	if opts.perspective != "target" || classifyTarget(node) != "self" {
		return
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": contribution})
}

// translateAbilityModifier handles a change to another ability. Adding
// selections to the crunched unit's own ability raises the cap of the lever pool
// that ability offers, which the consumer resolves by the ability's name; other
// aspects are not modelled.
func translateAbilityModifier(node, source map[string]any, opts dslOpts, out *effectTranslation) {
	out.unsupported = append(out.unsupported, unsup(`effect type "ability-modifier" is not modelled by the buff layer`, node))
}

// translateStanceCapacity preserves stable ability/option references and the
// allocation policy used by the capacity consumer.
func translateStanceCapacity(node map[string]any, opts dslOpts, out *effectTranslation) {
	modifier, _ := getMap(node, "modifier")
	ability := getStr(modifier, "ability_id")
	by, ok := num(modifier["additional_selections"])
	allocation := getStr(modifier, "allocation")
	valid := ability != "" && ok && by > 0 &&
		(allocation == "fixed-option" || allocation == "choose-one-option")
	ref := func(value any) (map[string]any, bool) {
		r, ok := asMap(value)
		if !ok || r == nil || getStr(r, "ability_id") == "" || getStr(r, "option_id") == "" {
			return nil, false
		}
		return map[string]any{"ability_id": getStr(r, "ability_id"), "option_id": getStr(r, "option_id")}, true
	}
	var option map[string]any
	if allocation == "fixed-option" {
		option, valid = ref(modifier["option"])
	}
	var options []any
	if raw, present := modifier["options"]; present {
		list, ok := asList(raw)
		if !ok || len(list) == 0 {
			valid = false
		} else {
			options = make([]any, 0, len(list))
			for _, item := range list {
				r, ok := ref(item)
				if !ok {
					valid = false
					break
				}
				options = append(options, r)
			}
		}
	}
	if !valid {
		out.unsupported = append(out.unsupported, unsup("stance-selection-capacity: unresolved option reference", node))
		return
	}
	cap := map[string]any{"ability": ability, "by": by, "allocation": allocation}
	if option != nil {
		cap["option"] = option
	}
	if options != nil {
		cap["options"] = options
	}
	label := jsStr(by) + " more " + ability + " selections"
	out.activatable = append(out.activatable, map[string]any{
		"id": opts.abilityID + "#cap", "label": label, "buffs": []any{}, "capRaise": cap,
	})
}
