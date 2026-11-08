package wh40kdc

// defensiveLevers collects the opt-in levers DefensiveLeversFor returns. A nil
// *defensiveLevers collects nothing, so the plain buff walks pass nil.
type defensiveLevers struct {
	levers []map[string]any
	groups []map[string]any
}

// push appends each of an ability's activatables as an opt-in lever (first id
// wins) with the pools it names. An activatable that raises a pool's cap or is
// gated on a stance option is left out: nothing here resolves it against
// another lever. Mirrors the levers sink of TS collectBuffs.
func (l *defensiveLevers) push(ability *AbilityView, source map[string]any, activatable []any) {
	if l == nil {
		return
	}
	for _, actAny := range activatable {
		act, ok := asMap(actAny)
		if !ok || act == nil {
			continue
		}
		if act["capRaise"] != nil || act["requiresOption"] != nil || act["excludesOption"] != nil {
			continue
		}
		id := getStr(act, "id")
		if l.has(l.levers, id) {
			continue
		}
		lever := map[string]any{
			"id":      id,
			"label":   ability.Name() + " — " + getStr(act, "label"),
			"buffs":   getList(act, "buffs"),
			"enabled": false,
			"source":  source,
		}
		pools := []any{}
		if group, ok := getMap(act, "group"); ok && group != nil {
			lever["group"] = getStr(group, "id")
			pools = append(pools, group)
		}
		if extra := getList(act, "groups"); len(extra) > 0 {
			ids := make([]any, 0, len(extra))
			for _, groupAny := range extra {
				group, _ := asMap(groupAny)
				ids = append(ids, getStr(group, "id"))
			}
			lever["groups"] = ids
			pools = append(pools, extra...)
		}
		if requires, present := act["requires"]; present && requires != nil {
			lever["requires"] = requires
		}
		l.levers = append(l.levers, lever)
		for _, groupAny := range pools {
			group, _ := asMap(groupAny)
			if l.has(l.groups, getStr(group, "id")) {
				continue
			}
			l.groups = append(l.groups, map[string]any{
				"id":             getStr(group, "id"),
				"abilityId":      ability.ID(),
				"label":          ability.Name(),
				"maxActivations": group["maxActivations"],
			})
		}
	}
}

func (l *defensiveLevers) has(items []map[string]any, id string) bool {
	for _, item := range items {
		if getStr(item, "id") == id {
			return true
		}
	}
	return false
}

// DefensiveLeversFor is the defending unit's player decisions: the activatable
// levers of the abilities defensiveBuffsFor walks (an optional ability, a
// usage-limited activation, a choice branch), each off by default, with the
// pools that cap them. Each lever is {id, label, buffs, enabled, source,
// group?, groups?, requires?} and each pool {id, abilityId, label,
// maxActivations}, as TS Dataset.defensiveLeversFor returns them. The plain
// defensive stack never applies these. A lever behind an undecided condition
// appears once that condition is answered true in context["conditionFacts"].
// Append each chosen lever's buffs to the defensive stack to crunch it.
func (ds *Dataset) DefensiveLeversFor(input, context map[string]any) (levers, groups []map[string]any) {
	sink := &defensiveLevers{levers: []map[string]any{}, groups: []map[string]any{}}
	ds.collectBuffs(input, context, "target", sink)
	return sink.levers, sink.groups
}
