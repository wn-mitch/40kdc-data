package wh40kdc

import (
	"sort"
	"strings"
)

// Per-attack mortal wounds: a hit or wound roll of the attack inflicting mortal wounds on the
// target. Go mirror of attackRollOf / translateMortalWounds in tools/src/cruncher/from-dsl.ts.

// attackRollOf is the hit or wound roll a single after-roll trigger fires on, with its outcome;
// nil for any other trigger. A "failure" result is not a scoring roll, so it gives no attack roll.
func attackRollOf(trigger any) *attackRollInfo {
	t, ok := asMap(trigger)
	if !ok || t == nil || t["event"] != "after-roll" {
		return nil
	}
	filter, ok := asMap(t["filter"])
	if !ok || filter == nil {
		return nil
	}
	roll, _ := filter["roll"].(string)
	if roll != "hit" && roll != "wound" {
		return nil
	}
	if result, present := filter["result"]; present {
		s, _ := result.(string)
		if s != "success" && s != "critical" {
			return nil
		}
		return &attackRollInfo{roll: roll, outcome: s}
	}
	return &attackRollInfo{roll: roll}
}

// rollingSubjects are who make a hit or wound roll the attack's own: the unit or model holding
// the ability.
var rollingSubjects = map[string]bool{"this-unit": true, "this-model": true, "bearer": true}

func ownRollingSubject(trigger map[string]any) bool {
	subject, present := trigger["subject"]
	if !present || subject == nil {
		return true
	}
	s, ok := subject.(string)
	return ok && rollingSubjects[s]
}

// isOwnAttackRollTrigger reports whether a trigger fires on a hit or wound roll of the unit's own
// attacks, whatever its outcome: mortal wounds there belong to the attack, never to a moment
// outside it.
func isOwnAttackRollTrigger(trigger any) bool {
	t, ok := asMap(trigger)
	if !ok || t == nil || t["event"] != "after-roll" {
		return false
	}
	filter, ok := asMap(t["filter"])
	if !ok || filter == nil {
		return false
	}
	roll, _ := filter["roll"].(string)
	return (roll == "hit" || roll == "wound") && ownRollingSubject(t)
}

// onAttackRoll is an effect under a hit or wound trigger and that roll. The trigger's attack type
// and weapon scope narrow which attacks fire it, so they gate the effect as an attack-is
// condition; any other narrowing (another filter key, another unit rolling, an object) is named
// in the roll's unmodelled. The roll is nil under any other trigger.
func onAttackRoll(trigger any, effect any) (any, *attackRollInfo) {
	roll := attackRollOf(trigger)
	if roll == nil {
		return effect, nil
	}
	t, _ := asMap(trigger)
	filter, _ := asMap(t["filter"])
	keys := make([]string, 0, len(filter))
	for key := range filter {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parameters := map[string]any{}
	var unmodelled []string
	for _, key := range keys {
		value := filter[key]
		switch {
		case key == "roll" || key == "result":
		case key == "attack_type" && (value == "ranged" || value == "melee"):
			parameters["attack_type"] = value
		case key == "weapons":
			parameters["weapons"] = value
		default:
			unmodelled = append(unmodelled, "filter."+key)
		}
	}
	if !ownRollingSubject(t) {
		unmodelled = append(unmodelled, "subject")
	}
	if object, present := t["object"]; present && object != nil {
		unmodelled = append(unmodelled, "object")
	}
	roll.unmodelled = unmodelled
	if len(parameters) == 0 {
		return effect, roll
	}
	return map[string]any{"type": "conditional", "condition": map[string]any{"type": "attack-is", "parameters": parameters}, "effect": effect}, roll
}

// translateMortalWounds turns the mortal wounds an attack's own hit or wound roll inflicts on the
// target into a mortal-wounds-on-roll contribution. Mortal wounds outside an attack are not a
// buff: mortalWoundSources reports them.
func translateMortalWounds(node map[string]any, source map[string]any, opts dslOpts, out *effectTranslation) {
	roll := opts.attackRoll
	if roll == nil {
		out.unsupported = append(out.unsupported, unsup("mortal-wounds: inflicted outside an attack, not a change to it", node))
		return
	}
	if roll.outcome == "" {
		out.unsupported = append(out.unsupported, unsup("mortal-wounds: the "+roll.roll+" roll's outcome is not stated", node))
		return
	}
	if classifyTarget(node) != "defender" {
		out.unsupported = append(out.unsupported, unsup("mortal-wounds: the attack's rolls inflict them on a unit other than the target", node))
		return
	}
	if len(roll.unmodelled) > 0 {
		out.unsupported = append(out.unsupported, unsup("mortal-wounds: the "+roll.roll+" roll's trigger "+strings.Join(roll.unmodelled, ", ")+" is not modelled", node))
		return
	}
	if opts.perspective != "attacker" {
		return
	}
	modifier, _ := getMap(node, "modifier")
	var extra []string
	for key := range modifier {
		if key != "count" {
			extra = append(extra, key)
		}
	}
	if len(extra) > 0 {
		sort.Strings(extra)
		joined := ""
		for i, key := range extra {
			if i > 0 {
				joined += ", "
			}
			joined += key
		}
		out.unsupported = append(out.unsupported, unsup("mortal-wounds: "+joined+" on an attack roll is not modelled", node))
		return
	}
	distribution, err := quantityDistribution(modifier["count"])
	if err != nil {
		out.unsupported = append(out.unsupported, unsup("mortal-wounds: count "+jsonStringify(modifier["count"])+" is not a fixed or dice quantity", node))
		return
	}
	count := 0.0
	for _, outcome := range distribution {
		count += outcome.Value * outcome.Probability
	}
	out.applied = append(out.applied, map[string]any{"source": source, "contribution": map[string]any{
		"type": "mortal-wounds-on-roll", "roll": roll.roll, "outcome": roll.outcome, "count": count,
	}})
}

// jsonStringify is JSON.stringify for a reason string: canonical key order, and "undefined" for
// an absent value.
func jsonStringify(value any) string {
	if value == nil {
		return "undefined"
	}
	return canonicalJSON(value)
}
