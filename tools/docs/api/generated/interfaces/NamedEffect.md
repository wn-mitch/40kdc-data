[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedEffect

# Interface: NamedEffect

Defined in: [generated.ts:2354](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2354)

Deprecated: use `ability-part`, which is the same node with an optional name. A named sub-ability embedded in a larger rules bundle.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-effect".

## Properties

### type

> **type**: `"named-effect"`

Defined in: [generated.ts:2355](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2355)

***

### name

> **name**: `string`

Defined in: [generated.ts:2356](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2356)

***

### kind?

> `optional` **kind?**: `"psychic"`

Defined in: [generated.ts:2357](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2357)

***

### level?

> `optional` **level?**: `number`

Defined in: [generated.ts:2358](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2358)

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:2359](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2359)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:2363](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2363)

Whether the controlling player may decline to use this named sub-ability.

***

### cost?

> `optional` **cost?**: [`SingleEffect`](../type-aliases/SingleEffect.md) \| [`StanceSelectEffect`](StanceSelectEffect.md) \| [`StanceSelectionCapacityEffect`](StanceSelectionCapacityEffect.md) \| [`ChoiceEffect`](ChoiceEffect.md) \| [`SequenceEffect`](SequenceEffect.md) \| [`RulesBundleEffect`](RulesBundleEffect.md) \| `NamedEffect` \| [`AbilityPart`](AbilityPart.md) \| [`DiceGatedEffect`](DiceGatedEffect.md) \| [`DiceTableEffect`](DiceTableEffect.md) \| [`ConditionalEffect`](ConditionalEffect.md) \| [`DicePoolAllocationEffect`](DicePoolAllocationEffect.md) \| [`SelectUnitsEffect`](SelectUnitsEffect.md) \| [`ForEachUnitEffect`](ForEachUnitEffect.md) \| [`MovementModifierEffect`](MovementModifierEffect.md) \| [`AuraEffect`](AuraEffect.md) \| [`DesignateTargetEffect`](DesignateTargetEffect.md) \| [`RiskRewardEffect`](RiskRewardEffect.md) \| [`IssueOrdersEffect`](IssueOrdersEffect.md) \| [`ResourceActionMenuEffect`](ResourceActionMenuEffect.md) \| [`LeaderModelAbilityGrantEffect`](LeaderModelAbilityGrantEffect.md) \| [`PersistentDesignationEffect`](PersistentDesignationEffect.md) \| [`NoEffectEffect`](NoEffectEffect.md) \| [`SelectObjectiveEffect`](SelectObjectiveEffect.md) \| [`ForEachObjectiveEffect`](ForEachObjectiveEffect.md) \| [`PairedDesignationEffect`](PairedDesignationEffect.md) \| [`MiracleDieOperationEffect`](MiracleDieOperationEffect.md) \| [`FormationAttachmentGrantEffect`](FormationAttachmentGrantEffect.md) \| [`AttachmentEligibilityInheritEffect`](AttachmentEligibilityInheritEffect.md)

Defined in: [generated.ts:2367](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2367)

A prerequisite cost: the nested effect is granted only after this complete cost is paid. An optional named effect may be declined without paying it.

***

### duration?

> `optional` **duration?**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"`

Defined in: [generated.ts:2400](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2400)

Expiration of this sub-effect, independently of sibling rules in an enclosing bundle.

***

### trigger?

> `optional` **trigger?**: [`Trigger`](Trigger.md) \| \[[`Trigger`](Trigger.md), `...Trigger[]`\]

Defined in: [generated.ts:2416](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2416)

Reactive event for this sub-ability. When nested inside an activated effect, the subscription exists only for the enclosing effect duration.

***

### usage?

> `optional` **usage?**: [`AbilityUsage1`](AbilityUsage1.md)

Defined in: [generated.ts:2417](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2417)
