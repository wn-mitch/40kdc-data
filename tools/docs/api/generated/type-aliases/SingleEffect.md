[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / SingleEffect

# Type Alias: SingleEffect

> **SingleEffect** = `object` & `object`

Defined in: [generated.ts:488](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L488)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "single-effect".

## Type Declaration

### type

> **type**: `"ability-grant"` \| `"attack-restriction"` \| `"auto-result"` \| `"battle-shock-test"` \| `"bs-modifier"` \| `"charge-roll-modifier"` \| `"cp-gain"` \| `"cp-on-destroy"` \| `"cp-refund"` \| `"damage-reduction"` \| `"deep-strike"` \| `"disembark"` \| `"disembark-after-move"` \| `"engagement-passthrough"` \| `"fallback-and-act"` \| `"feel-no-pain"` \| `"fight-eligibility-extension"` \| `"fight-first"` \| `"fight-last"` \| `"fight-on-death"` \| `"firing-deck"` \| `"flyover"` \| `"heal-wounds"` \| `"hazard-rolls"` \| `"invulnerable-save"` \| `"keyword-grant"` \| `"leadership-modifier"` \| `"model-destruction"` \| `"modifier-immunity"` \| `"mortal-wounds"` \| `"detection-range-modifier"` \| `"named-region-state"` \| `"objective-control-modifier"` \| `"objective-tag"` \| `"pool-add-die"` \| `"re-roll"` \| `"recovery-pool"` \| `"remove-battle-shock"` \| `"set-battle-shock"` \| `"replace-roll-from-pool"` \| `"resource-clear"` \| `"resource-gain"` \| `"resource-spend"` \| `"resurrection"` \| `"roll-modifier"` \| `"rule-state"` \| `"shoot-on-death"` \| `"stat-modifier"` \| `"stratagem-cost-modifier"` \| `"stratagem-targeting-permission"` \| `"strategic-reserves-arrival"` \| `"targeting-permission"` \| `"tracking-token"` \| `"transport-capacity-conversion"` \| `"terrain-area-tag"` \| `"unit-attachment"` \| `"unit-keyword"` \| `"unit-keyword-grant"` \| `"unit-tag"` \| `"ward"` \| `"unit-division"` \| `"desperate-escape"` \| `"reactive-charge"` \| `"ability-usage-limit"` \| `"deadly-demise-threshold"` \| `"embark"` \| `"eligibility-override"` \| `"weapon-grant"` \| `"mirror-triggering-choice"` \| `"persistent-battlefield-marker-state"` \| `"named-objective-state"`

### target

> **target**: `"self"` \| `"bearer"` \| `"unit"` \| `"attached-unit"` \| `"selected-models-unit"` \| `"attacker"` \| `"defender"` \| `"target"` \| `"targets-of-selected-unit-attacks"` \| `"friendly-within-aura"` \| `"enemy-within-aura"` \| `"all-friendly"` \| `"all-enemy"` \| `"destroyed-model"` \| `"triggering-unit"`

### modifier?

> `optional` **modifier?**: `object`

#### Index Signature

\[`k`: `string`\]: `unknown`

### scaling?

> `optional` **scaling?**: [`Scaling`](../interfaces/Scaling.md)
