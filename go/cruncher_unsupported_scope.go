package wh40kdc

import "regexp"

// Whether an unsupported fragment of an ability could change the attack being crunched. Go
// mirror of tools/src/cruncher/unsupported-scope.ts, pinned by the `unsupportedScopes` field of
// conformance/abilities-resolver/from-dsl.json.
//
// Scopes: "out-of-scope" (no damage content for this attack), "encounter-layer" (acts outside the
// attack through deaths, mortal wounds, healing, designations or a later moment) and
// "unresolved" (could change the attack's damage, but the engine cannot evaluate it).

const (
	scopeOut        = "out-of-scope"
	scopeEncounter  = "encounter-layer"
	scopeUnresolved = "unresolved"
)

var scopeRank = map[string]int{scopeOut: 0, scopeEncounter: 1, scopeUnresolved: 2}

// widerScope is the more consequential of two scopes.
func widerScope(a, b string) string {
	if scopeRank[a] >= scopeRank[b] {
		return a
	}
	return b
}

var damageRolls = map[string]bool{"hit": true, "wound": true, "save": true, "damage": true}
var damageStats = map[string]bool{"A": true, "S": true, "T": true, "Sv": true, "AP": true, "D": true, "WS": true, "BS": true}

// nonDamageEffectTypes are the leaf effect types that change no attack's damage. A type not
// reviewed stays a gap.
var nonDamageEffectTypes = map[string]bool{
	"heal": true, "move": true, "mortal-wounds": true, "set-up": true, "permission": true, "cost-modifier": true,
	"stance-selection-capacity": true, "move-modifier": true, "army-rule": true, "keyword-grant": true,
	"act-on-death": true, "cp-gain": true, "resource-gain": true, "add-unit": true, "split-unit": true,
	"transport-capacity": true, "destroy-models": true, "designate": true, "test": true, "targeting": true,
	"state-change": true, "no-effect": true, "oath-modifier": true, "objective-sticky": true, "counts-as": true,
	"marker": true, "test-exemption": true, "return-models": true,
}

// encounterEffectTypes are the non-damage leaf types that act through events outside the attack.
var encounterEffectTypes = map[string]bool{
	"mortal-wounds": true, "act-on-death": true, "designate": true, "heal": true, "destroy-models": true, "return-models": true,
}

// nonDamageAbilities decide deployment, movement, fight order, attachment or resurrection.
var nonDamageAbilities = map[string]bool{
	"deadly-demise": true, "deep-strike": true, "fights-first": true, "hover": true, "infiltrators": true,
	"leader": true, "lone-operative": true, "scouts": true, "support": true, "super-heavy-walker": true,
	"mobile": true, "reanimation-protocols": true,
}

var encounterAbilities = map[string]bool{"deadly-demise": true, "reanimation-protocols": true}

var (
	statModifierOutsideDamagePath = regexp.MustCompile(`^stat-modifier on ".*" is outside the damage path$`)
	rollModifierOutsideDamagePath = regexp.MustCompile(`^roll-modifier on ".*" is outside the damage path$`)
	rerollOutsideDamagePath       = regexp.MustCompile(`^re-roll on ".*" \(subset ".*"\) is outside the damage path$`)
	objectiveSelectionReason      = regexp.MustCompile(`^select-objective: `)
	defenderSideStatReason        = regexp.MustCompile(`: defender-side stat; applies when the buffed unit is the target$`)
	attachedModelScopedReason     = regexp.MustCompile(`^model-scoped effect from an attached model`)
	undecidedConditionReason      = regexp.MustCompile(`^conditional: cannot evaluate condition `)
)

// absentField stands for a missing key: JavaScript's `undefined`, which the scope classifier
// treats as unresolved, unlike an explicit null.
type absentField struct{}

func field(m map[string]any, key string) any {
	if v, has := m[key]; has {
		return v
	}
	return absentField{}
}

func abilityScope(id any) string {
	s, ok := id.(string)
	if !ok || !nonDamageAbilities[s] {
		return scopeUnresolved
	}
	if encounterAbilities[s] {
		return scopeEncounter
	}
	return scopeOut
}

// effectScope is the scope of an effect subtree: the widest scope among its leaves. Any leaf or
// container not recognised here is "unresolved", the conservative default.
func effectScope(node any) string {
	if node == nil {
		return scopeOut
	}
	effect, ok := node.(map[string]any)
	if !ok {
		return scopeUnresolved
	}
	modifier, _ := effect["modifier"].(map[string]any)
	if modifier == nil {
		modifier = map[string]any{}
	}
	widest := func(children []any) string {
		scope := scopeOut
		for _, child := range children {
			scope = widerScope(scope, effectScope(child))
		}
		return scope
	}
	typ, _ := effect["type"].(string)
	switch typ {
	case "sequence", "rules-bundle":
		steps, ok := effect["steps"].([]any)
		if !ok {
			return scopeUnresolved
		}
		return widest(steps)
	case "conditional":
		if _, has := effect["else"]; !has {
			return widest([]any{field(effect, "effect")})
		}
		return widest([]any{field(effect, "effect"), effect["else"]})
	case "select-units", "for-each-unit", "ability-part":
		return effectScope(field(effect, "effect"))
	case "dice-gated":
		return widest([]any{effect["on_success"], effect["on_fail"]})
	case "dice-table":
		outcomes, ok := effect["outcomes"].([]any)
		if !ok {
			return scopeUnresolved
		}
		effects := make([]any, len(outcomes))
		for i, outcome := range outcomes {
			if om, ok := outcome.(map[string]any); ok {
				effects[i] = om["effect"]
			}
		}
		return widest(effects)
	case "roll-result", "roll-modifier", "re-roll":
		if roll, ok := modifier["roll"].(string); ok && !damageRolls[roll] {
			return scopeOut
		}
		return scopeUnresolved
	case "stat-modifier":
		if stat, ok := modifier["stat"].(string); ok && !damageStats[stat] {
			return scopeOut
		}
		return scopeUnresolved
	case "ability-grant":
		// A printed grant is judged by the body it carries.
		if def, has := modifier["definition"]; has {
			return effectScope(def)
		}
		return abilityScope(modifier["ability"])
	case "ability-activate":
		return abilityScope(modifier["ability"])
	case "rule-state":
		if modifier["rule_kind"] == "ability" {
			return abilityScope(modifier["rule"])
		}
		if modifier["rule_kind"] == "core-rule" && modifier["rule"] == "attacking-ends-hidden" {
			return scopeOut
		}
		return scopeUnresolved
	case "ability-modifier":
		if modifier["aspect"] == "uses" || modifier["aspect"] == "range" {
			return scopeOut
		}
		return scopeUnresolved
	}
	if !nonDamageEffectTypes[typ] {
		return scopeUnresolved
	}
	if encounterEffectTypes[typ] {
		return scopeEncounter
	}
	return scopeOut
}

// labelledOutsideDamagePath reports whether the translator's "outside the damage path" label
// holds (known true/false); known is false when the reason is not one of those labels.
func labelledOutsideDamagePath(reason string, fragment any) (outside, known bool) {
	fm, _ := fragment.(map[string]any)
	modifier, _ := fm["modifier"].(map[string]any)
	if statModifierOutsideDamagePath.MatchString(reason) {
		stat, isStr := modifier["stat"].(string)
		return !isStr || !damageStats[stat], true
	}
	if rollModifierOutsideDamagePath.MatchString(reason) || rerollOutsideDamagePath.MatchString(reason) {
		roll, isStr := modifier["roll"].(string)
		return !isStr || !damageRolls[roll], true
	}
	return false, false
}

// fragmentScope is the scope of one unsupported fragment from its reason and effect fragment. An
// undecided condition is classified by the caller, which can translate its body.
func fragmentScope(reason string, fragment any) string {
	if outside, known := labelledOutsideDamagePath(reason, fragment); known {
		if outside {
			return scopeOut
		}
		return scopeUnresolved
	}
	if reason == postAttackMoment {
		return scopeEncounter
	}
	if objectiveSelectionReason.MatchString(reason) || defenderSideStatReason.MatchString(reason) || attachedModelScopedReason.MatchString(reason) {
		return scopeOut
	}
	if undecidedConditionReason.MatchString(reason) {
		return scopeUnresolved
	}
	return effectScope(fragment)
}
