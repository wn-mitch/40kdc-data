[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MovementModifierEffect

# Interface: MovementModifierEffect

Defined in: [generated.ts:2705](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2705)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "movement-modifier-effect".

## Properties

### type

> **type**: `"movement-modifier"`

Defined in: [generated.ts:2706](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2706)

***

### target

> **target**: `"attacker"` \| `"defender"` \| `"self"` \| `"bearer"` \| `"unit"` \| `"attached-unit"` \| `"target"` \| `"friendly-within-aura"` \| `"enemy-within-aura"` \| `"all-friendly"` \| `"all-enemy"`

Defined in: [generated.ts:2707](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2707)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:2719](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2719)

#### move\_type?

> `optional` **move\_type?**: `"advance"` \| `"normal"` \| `"pile-in"` \| `"consolidation"` \| `"ingress"` \| `"surge"` \| `"scout"` \| `"reactive"` \| `"redeploy"` \| `"infiltrate"` \| `"shoot-and-scoot"`

#### distance?

> `optional` **distance?**: `string` \| `number`

#### passthrough?

> `optional` **passthrough?**: (`"tall-terrain"` \| `"non-titanic-models"` \| `"friendly-vehicles"` \| `"friendly-monsters"` \| `"terrain-le-4"` \| `"all-terrain"`)[]

#### vertical\_limit?

> `optional` **vertical\_limit?**: `number`

#### ignore\_vertical?

> `optional` **ignore\_vertical?**: `boolean`

#### replaces\_default?

> `optional` **replaces\_default?**: `boolean`

#### to\_reserves?

> `optional` **to\_reserves?**: `boolean`

#### applies\_to\_moves?

> `optional` **applies\_to\_moves?**: (`"charge"` \| `"advance"` \| `"fall-back"` \| `"normal"`)[]

#### name?

> `optional` **name?**: `string`

#### excludes\_keyword?

> `optional` **excludes\_keyword?**: `string`

#### max\_units?

> `optional` **max\_units?**: `number`

#### marker?

> `optional` **marker?**: `object`

##### marker.affected?

> `optional` **affected?**: `string`

##### marker.unit\_filter?

> `optional` **unit\_filter?**: `string`

##### marker.location?

> `optional` **location?**: `string`

##### marker.max\_units?

> `optional` **max\_units?**: `number`

#### condition?

> `optional` **condition?**: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md)

***

### after\_move?

> `optional` **after\_move?**: [`SingleEffect`](../type-aliases/SingleEffect.md) \| [`StanceSelectEffect`](StanceSelectEffect.md) \| [`StanceSelectionCapacityEffect`](StanceSelectionCapacityEffect.md) \| [`ChoiceEffect`](ChoiceEffect.md) \| [`SequenceEffect`](SequenceEffect.md) \| [`RulesBundleEffect`](RulesBundleEffect.md) \| [`NamedEffect`](NamedEffect.md) \| [`AbilityPart`](AbilityPart.md) \| [`DiceGatedEffect`](DiceGatedEffect.md) \| [`DiceTableEffect`](DiceTableEffect.md) \| [`ConditionalEffect`](ConditionalEffect.md) \| [`DicePoolAllocationEffect`](DicePoolAllocationEffect.md) \| [`SelectUnitsEffect`](SelectUnitsEffect.md) \| [`ForEachUnitEffect`](ForEachUnitEffect.md) \| `MovementModifierEffect` \| [`AuraEffect`](AuraEffect.md) \| [`DesignateTargetEffect`](DesignateTargetEffect.md) \| [`RiskRewardEffect`](RiskRewardEffect.md) \| [`IssueOrdersEffect`](IssueOrdersEffect.md) \| [`ResourceActionMenuEffect`](ResourceActionMenuEffect.md) \| [`LeaderModelAbilityGrantEffect`](LeaderModelAbilityGrantEffect.md) \| [`PersistentDesignationEffect`](PersistentDesignationEffect.md) \| [`NoEffectEffect`](NoEffectEffect.md) \| [`SelectObjectiveEffect`](SelectObjectiveEffect.md) \| [`ForEachObjectiveEffect`](ForEachObjectiveEffect.md) \| [`PairedDesignationEffect`](PairedDesignationEffect.md) \| [`MiracleDieOperationEffect`](MiracleDieOperationEffect.md) \| [`FormationAttachmentGrantEffect`](FormationAttachmentGrantEffect.md) \| [`AttachmentEligibilityInheritEffect`](AttachmentEligibilityInheritEffect.md)

Defined in: [generated.ts:2760](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2760)

Resolve this effect only after the target actually completes the granted move (including a legal zero-distance move). Declining to make the move does not resolve this effect. Uses the enclosing duration for lasting follow-up effects.
