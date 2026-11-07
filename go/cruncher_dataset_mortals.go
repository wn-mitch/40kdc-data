package wh40kdc

// Dataset.MortalWoundSourcesFor: the mortal wounds a unit's abilities inflict on an enemy unit
// outside its attacks. Go mirror of tools/src/data/dataset-mortals.ts.

// AbilityMortalWounds is one MortalWoundSource with the ability that inflicts it.
type AbilityMortalWounds struct {
	MortalWoundSource
	AbilityID string
	// Label is the ability's name.
	Label string
	// CP is the Stratagem's CP cost; nil for anything else.
	CP *float64
}

// MortalWoundSourcesFor walks every eligible ability of the unit across all five phases (a
// source happens at its own moment, whatever phase the attack is made in), deduplicated by
// ability id. Each source gives the expected mortal wounds per occurrence of its moment, before
// Feel No Pain, assuming each of its needs holds. Unsupported fragments carry an "abilityId".
func (ds *Dataset) MortalWoundSourcesFor(input, context map[string]any) ([]AbilityMortalWounds, []map[string]any) {
	ctx := ds.buffContext(input, context, "attacker")
	sources := []AbilityMortalWounds{}
	unsupported := []map[string]any{}
	if getStr(input, "unitId") == "" {
		return sources, unsupported
	}
	seen := map[string]bool{}
	for _, phase := range []string{"command", "movement", "shooting", "charge", "fight"} {
		for _, entry := range ds.eligibleAbilities(input, phase) {
			ability := entry["ability"].(*AbilityView)
			if seen[ability.ID()] {
				continue
			}
			seen[ability.ID()] = true
			rating, _ := entry["rating"]
			translation := mortalWoundSources(ability.ID(), ability.Raw["effect"], ability.Raw["trigger"], ctx, rating)
			var cp *float64
			if source, _ := asMap(entry["source"]); getStr(source, "kind") == "detachment-stratagem" {
				if n, ok := num(source["cpCost"]); ok {
					cp = &n
				}
			}
			for _, source := range translation.Sources {
				sources = append(sources, AbilityMortalWounds{MortalWoundSource: *source, AbilityID: ability.ID(), Label: ability.Name(), CP: cp})
			}
			for _, fragment := range translation.Unsupported {
				tagged := cloneMap(fragment)
				tagged["abilityId"] = ability.ID()
				unsupported = append(unsupported, tagged)
			}
		}
	}
	return sources, unsupported
}
