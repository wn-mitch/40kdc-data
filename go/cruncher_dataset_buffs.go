package wh40kdc

// AbilityView buff-translation methods + the Dataset buff-collection methods
// (eligible_abilities / buffs_for / defensive_buffs_for). Go mirror of the
// buff-translation halves of python .../data/entities.py and dataset.py.

// resolveRulesBundles expands entity-backed grants into reusable bundle effect
// trees. Unresolved, malformed, and cyclic references remain untouched so the
// DSL translator emits its normal unsupported diagnostic.
func (a *AbilityView) resolveRulesBundles(value any, seen map[string]bool) (any, bool) {
	switch node := value.(type) {
	case []any:
		var copy []any
		for i, child := range node {
			resolved, changed := a.resolveRulesBundles(child, seen)
			if changed {
				if copy == nil {
					copy = append([]any(nil), node...)
				}
				copy[i] = resolved
			}
		}
		if copy != nil {
			return copy, true
		}
		return value, false
	case map[string]any:
		if getStr(node, "type") == "ability-grant" {
			modifier, _ := getMap(node, "modifier")
			abilityID := getStr(modifier, "ability")
			rulesBundle, _ := modifier["rules_bundle"].(bool)
			if rulesBundle && abilityID != "" && !seen[abilityID] {
				if target, ok := a.ds.Abilities.Get(abilityID); ok {
					targetEffect := target.Raw["effect"]
					if targetMap, isMap := targetEffect.(map[string]any); isMap &&
						getStr(targetMap, "type") == "rules-bundle" {
						nextSeen := make(map[string]bool, len(seen)+1)
						for id := range seen {
							nextSeen[id] = true
						}
						nextSeen[abilityID] = true
						resolved, _ := a.resolveRulesBundles(targetEffect, nextSeen)
						return resolved, true
					}
				}
			}
		}

		var copy map[string]any
		for key, child := range node {
			resolved, changed := a.resolveRulesBundles(child, seen)
			if changed {
				if copy == nil {
					copy = cloneMap(node)
				}
				copy[key] = resolved
			}
		}
		if copy != nil {
			return copy, true
		}
		return value, false
	default:
		return value, false
	}
}

// triggerGated gates a reactive ability's effect on its trigger, the way a
// timing-is condition gates it: the moment is one the player opts into, so a
// triggered buff is an activatable lever (<ability>@<event>) rather than always on.
// Several triggers are alternatives. A trigger on an attack step is met by every
// attack, and an activated ability (a stratagem) is already opt-in, so neither is
// gated.
func triggerGated(behavior any, trigger any, effect any) any {
	gated, _ := triggerGatedStep(behavior, trigger, effect)
	return gated
}

// usageGated gates an ability's effect on its usage limit ("once per battle",
// "once per turn"): using it is the player's choice, so its buffs are an opt-in
// lever (<ability>@<frequency>). Called only when no trigger already gates the
// effect. A stratagem is already opt-in.
func usageGated(abilityType any, usage any, effect any) any {
	// Several limits that all apply are still one player-chosen use; the first limit names the lever.
	if l, ok := asList(usage); ok {
		usage = nil
		if len(l) > 0 {
			usage = l[0]
		}
	}
	u, ok := asMap(usage)
	if effect == nil || !ok || u == nil || abilityType == "stratagem" {
		return effect
	}
	frequency, ok := u["frequency"].(string)
	if !ok {
		return effect
	}
	return map[string]any{"type": "conditional", "condition": map[string]any{"type": "timing-is", "parameters": map[string]any{"timing": frequency}}, "effect": effect}
}

// triggerGatedStep is triggerGated, also reporting whether a trigger gated the
// effect (a usage limit then adds nothing).
func triggerGatedStep(behavior any, trigger any, effect any) (any, bool) {
	if behavior != "reactive" {
		return effect, false
	}
	candidates, ok := trigger.([]any)
	if !ok {
		candidates = []any{trigger}
	}
	// An ability firing on an attack step applies to every attack; its trigger
	// condition is already how the authored data gates such abilities (in the
	// effect), so nothing is added.
	hasEvent := false
	for _, candidate := range candidates {
		if t, ok := asMap(candidate); ok && t != nil {
			_, isEvent := t["event"].(string)
			if isAttackStep(t) {
				return effect, false
			}
			hasEvent = hasEvent || isEvent
		}
	}
	// With attack steps excluded, momentGate leaves the effect ungated only when
	// there is no effect or no trigger with an event.
	return momentGate(trigger, effect), effect != nil && hasEvent
}

// describeBuffs is the full DSL->Buff translation (applied/unsupported/
// activatable). An aura (an effect whose target filter reaches units `within`
// N") gates on distance to the target: the single inch range every such target
// reaches (auraInches) is stamped onto every emitted buff as
// applicableWhen.maxRangeInches.
func (a *AbilityView) describeBuffs(source map[string]any, ctx map[string]any, perspective string) *effectTranslation {
	return a.describeRatedBuffs(source, ctx, perspective, nil, false)
}

// describeRatedBuffs is describeBuffs for a rated rule: every {rating: true}
// in the effect reads the rating the owning unit prints (hasRating).
func (a *AbilityView) describeRatedBuffs(source map[string]any, ctx map[string]any, perspective string, rating any, hasRating bool) *effectTranslation {
	if ctx == nil {
		ctx = map[string]any{"phase": "shooting"}
	}
	bundled, _ := a.resolveRulesBundles(a.Raw["effect"], map[string]bool{a.ID(): true})
	resolvedEffect := withRating(bundled, rating, hasRating)
	needsSnapshot := recipientSnapshotUnavailable(a.Raw["trigger"], resolvedEffect)
	if needsSnapshot && (getStr(source, "kind") != "ability" || getStr(source, "abilityId") != a.ID()) {
		return &effectTranslation{
			applied: []any{}, activatable: []any{},
			unsupported: []any{unsup("recipient snapshot source does not own this ability", a.Raw["effect"])},
		}
	}
	moment := resolvedEffect
	if needsSnapshot {
		var reason string
		moment, reason = resolveRecipientSnapshots(a.Raw["trigger"], resolvedEffect, source, ctx, perspective)
		if reason != "" {
			return &effectTranslation{
				applied: []any{}, activatable: []any{},
				unsupported: []any{unsup(reason, a.Raw["effect"])},
			}
		}
	} else {
		bound := resolvedEffect
		if a.Raw["trigger"] != nil {
			bound, _ = bindEventSubject(a.Raw["trigger"], resolvedEffect, ctx, perspective)
		}
		moment = triggerGated(a.Raw["behavior"], a.Raw["trigger"], bound)
	}
	translated := effectToBuffs(moment, source, ctx, perspective, map[string]any{"usage": a.Raw["usage"], "duration": mapOr(a.Raw["scope"])["duration"]})
	rng, ok := auraInches(resolvedEffect)
	if !ok {
		return translated
	}
	gate := func(bAny any) any {
		b, _ := asMap(bAny)
		nb := cloneMap(b)
		aw, _ := getMap(b, "applicableWhen")
		merged := cloneMap(aw)
		merged["maxRangeInches"] = rng
		nb["applicableWhen"] = merged
		return nb
	}
	out := &effectTranslation{unsupported: translated.unsupported}
	for _, b := range translated.applied {
		out.applied = append(out.applied, gate(b))
	}
	for _, actAny := range translated.activatable {
		act, _ := asMap(actAny)
		na := cloneMap(act)
		var gb []any
		for _, b := range getList(act, "buffs") {
			gb = append(gb, gate(b))
		}
		na["buffs"] = gb
		out.activatable = append(out.activatable, na)
	}
	if out.applied == nil {
		out.applied = []any{}
	}
	if out.activatable == nil {
		out.activatable = []any{}
	}
	return out
}

func (a *AbilityView) getBuffs(source map[string]any, ctx map[string]any, perspective string) []any {
	return a.describeBuffs(source, ctx, perspective).applied
}

func buffSourceFromEligible(entry map[string]any) map[string]any {
	ability := entry["ability"].(*AbilityView)
	source := entry["source"].(map[string]any)
	kind := getStr(source, "kind")
	if kind == "attached" {
		return map[string]any{"kind": "ability", "abilityId": ability.ID(), "abilityKind": "attached", "sourceUnitId": source["unitId"]}
	}
	if kind == "support" {
		return map[string]any{"kind": "ability", "abilityId": ability.ID(), "abilityKind": "support", "sourceUnitId": source["sourceUnitId"]}
	}
	if kind == "detachment-stratagem" {
		out := map[string]any{"kind": "ability", "abilityId": ability.ID(), "abilityKind": "detachment-stratagem"}
		if source["selectsModel"] == true {
			out["selectsModel"] = true
		}
		return out
	}
	return map[string]any{"kind": "ability", "abilityId": ability.ID(), "abilityKind": kind}
}

func (ds *Dataset) eligibleAbilities(input map[string]any, phase string) []map[string]any {
	return resolveEligibleAbilities(ds, input, phase)
}

func (ds *Dataset) derivedContext(input, context map[string]any) map[string]any {
	ctx := cloneMap(context)
	if ctx["attackerAttached"] == nil {
		ctx["attackerAttached"] = len(getList(input, "attachedUnitIds")) > 0
	}
	if ctx["attachmentRoles"] == nil {
		if roles, ok := getMap(input, "attachmentRoles"); ok && roles != nil {
			ctx["attachmentRoles"] = roles
		}
	}
	if ctx["attackerAttachmentRole"] == nil {
		if roles, ok := getMap(ctx, "attachmentRoles"); ok {
			ctx["attackerAttachmentRole"] = roles[getStr(input, "unitId")]
		}
	}
	return ctx
}

// weaponFaction is the faction to scope weaponProfiles lookups by: the
// explicit factionId when given, else the input unit's own faction.
func (ds *Dataset) weaponFaction(input map[string]any) string {
	if f := getStr(input, "factionId"); f != "" {
		return f
	}
	if unit, ok := ds.Units.GetAny(getStr(input, "unitId")); ok {
		return getStr(unit.Raw, "faction_id")
	}
	return ""
}

// buffContext is the engine context the buff collectors translate under: context with the input
// unit's attachment, unit id and (attacker) Toughness filled in where context leaves them unset.
func (ds *Dataset) buffContext(input, context map[string]any, perspective string) map[string]any {
	ctx := ds.derivedContext(input, context)
	if perspective == "attacker" && ctx["attackerUnitId"] == nil {
		ctx["attackerUnitId"] = getStr(input, "unitId")
	}
	if perspective == "attacker" && ctx["attackerToughness"] == nil {
		roles, _ := getMap(input, "attachmentRoles")
		if toughness, ok := combinedToughness(ds.combinedUnit(input), roles); ok {
			ctx["attackerToughness"] = toughness
		}
	}
	if perspective == "target" && ctx["targetUnitId"] == nil {
		ctx["targetUnitId"] = getStr(input, "unitId")
	}
	return ctx
}

func (ds *Dataset) collectBuffs(input, context map[string]any, perspective string) []any {
	out := []any{}
	ctx := ds.buffContext(input, context, perspective)
	if perspective == "attacker" {
		// Weapon ids are shared across factions with divergent stats — resolve
		// within the input unit's faction (GetAny fallback for cross-faction ids).
		weaponFaction := ds.weaponFaction(input)
		for _, refAny := range getList(input, "weaponProfiles") {
			ref, _ := asMap(refAny)
			weapon, ok := (*WeaponView)(nil), false
			if weaponFaction != "" {
				weapon, ok = ds.Weapons.GetInFaction(getStr(ref, "weaponId"), weaponFaction)
			}
			if !ok {
				weapon, ok = ds.Weapons.GetAny(getStr(ref, "weaponId"))
			}
			if !ok {
				continue
			}
			out = append(out, weapon.profileBuffs(asInt(ref["profileIndex"]), ctx)...)
		}
	}
	optedIn := map[string]struct{}{}
	for _, s := range getStrList(input, "optedInStratagemIds") {
		optedIn[s] = struct{}{}
	}
	eligible := ds.eligibleAbilities(input, getStr(ctx, "phase"))
	for _, entry := range historicalSnapshotAbilities(ds, input, ctx, perspective) {
		source := entry["source"].(map[string]any)
		duplicate := false
		for _, current := range eligible {
			if current["ability"].(*AbilityView).ID() == entry["ability"].(*AbilityView).ID() && snapshotValueEqual(source, buffSourceFromEligible(current)) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		ability := entry["ability"].(*AbilityView)
		rating, hasRating := entry["rating"]
		out = append(out, ability.describeRatedBuffs(source, ctx, perspective, rating, hasRating).applied...)
	}
	for _, entry := range eligible {
		source := entry["source"].(map[string]any)
		if getStr(source, "kind") == "detachment-stratagem" {
			if _, ok := optedIn[getStr(source, "stratagemId")]; !ok {
				continue
			}
		}
		ability := entry["ability"].(*AbilityView)
		bs := buffSourceFromEligible(entry)
		rating, hasRating := entry["rating"]
		out = append(out, ability.describeRatedBuffs(bs, ctx, perspective, rating, hasRating).applied...)
	}
	return out
}

// combinedUnit is the input unit (faction-scoped when the input names a
// faction) followed by its attached units, resolved within the same faction.
func (ds *Dataset) combinedUnit(input map[string]any) []*UnitView {
	var unit *UnitView
	found := false
	factionID := getStr(input, "factionId")
	if factionID != "" {
		unit, found = ds.Units.GetInFaction(getStr(input, "unitId"), factionID)
	}
	if !found {
		unit, found = ds.Units.GetAny(getStr(input, "unitId"))
	}
	combined := []*UnitView{}
	if found {
		combined = append(combined, unit)
		if factionID == "" {
			factionID = unit.FactionID()
		}
	}
	for _, id := range getStrList(input, "attachedUnitIds") {
		member, ok := (*UnitView)(nil), false
		if factionID != "" {
			member, ok = ds.Units.GetInFaction(id, factionID)
		}
		if !ok {
			member, ok = ds.Units.GetAny(id)
		}
		if ok {
			combined = append(combined, member)
		}
	}
	return combined
}

// combinedToughness is the Toughness of a (combined) unit: its Bodyguard's
// when Leaders or Support units are attached, as for an attack against it,
// taking the highest model's. roles (unit id -> role) wins over the
// datasheet's own attachment_role. ok is false when no unit prints a
// Toughness.
func combinedToughness(units []*UnitView, roles map[string]any) (float64, bool) {
	role := func(unit *UnitView) string {
		if r, ok := roles[unit.ID()].(string); ok {
			return r
		}
		return getStr(unit.Raw, "attachment_role")
	}
	bodyguard := []*UnitView{}
	for _, unit := range units {
		if r := role(unit); r != "leader" && r != "support" {
			bodyguard = append(bodyguard, unit)
		}
	}
	if len(bodyguard) == 0 {
		bodyguard = units
	}
	highest, found := 0.0, false
	for _, unit := range bodyguard {
		for _, profileAny := range getList(unit.Raw, "profiles") {
			profile, _ := asMap(profileAny)
			if t, ok := profile["T"].(float64); ok && (!found || t > highest) {
				highest, found = t, true
			}
		}
	}
	return highest, found
}

func (ds *Dataset) buffsFor(input, context map[string]any) []any {
	return ds.collectBuffs(input, context, "attacker")
}

func (ds *Dataset) defensiveBuffsFor(input, context map[string]any) []any {
	return ds.collectBuffs(input, context, "target")
}

// auraInches is the one inch range every aura-filtered effect target in effect
// reaches (target.within.range.inches), when there is exactly one.
func auraInches(effect any) (float64, bool) {
	found := map[float64]bool{}
	var walk func(node any)
	walk = func(node any) {
		switch x := node.(type) {
		case []any:
			for _, c := range x {
				walk(c)
			}
		case map[string]any:
			if _, typed := x["type"].(string); typed {
				if target, ok := asMap(x["target"]); ok && target != nil {
					if inches, ok := mapOr(mapOr(target["within"])["range"])["inches"].(float64); ok {
						found[inches] = true
					}
				}
			}
			for _, c := range x {
				walk(c)
			}
		}
	}
	walk(effect)
	if len(found) != 1 {
		return 0, false
	}
	for v := range found {
		return v, true
	}
	return 0, false
}
