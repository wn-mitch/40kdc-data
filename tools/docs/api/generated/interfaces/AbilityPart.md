[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityPart

# Interface: AbilityPart

Defined in: [generated.ts:2425](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2425)

One part of a compound ability: an effect with its own moment (trigger), usage limit, cost or choice, shown as one bullet of the ability it belongs to. The ability's own trigger is its firing moment; a part's trigger is the moment of that part alone, in the same trigger shape. `name` is only for a part the rules name (a psychic power, a named rule in a bundle).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-part".

## Properties

### type

> **type**: `"ability-part"`

Defined in: [generated.ts:2426](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2426)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:2430](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2430)

The part's own name, only when the rules give it one.

***

### kind?

> `optional` **kind?**: `"psychic"`

Defined in: [generated.ts:2431](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2431)

***

### level?

> `optional` **level?**: `number`

Defined in: [generated.ts:2432](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2432)

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:2433](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2433)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:2437](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2437)

Whether the controlling player may decline this part.

***

### cost?

> `optional` **cost?**: [`SingleEffect`](../type-aliases/SingleEffect.md) \| [`StanceSelectEffect`](StanceSelectEffect.md) \| [`StanceSelectionCapacityEffect`](StanceSelectionCapacityEffect.md) \| [`ChoiceEffect`](ChoiceEffect.md) \| [`SequenceEffect`](SequenceEffect.md) \| [`RulesBundleEffect`](RulesBundleEffect.md) \| [`NamedEffect`](NamedEffect.md) \| `AbilityPart` \| [`DiceGatedEffect`](DiceGatedEffect.md) \| [`DiceTableEffect`](DiceTableEffect.md) \| [`ConditionalEffect`](ConditionalEffect.md) \| [`DicePoolAllocationEffect`](DicePoolAllocationEffect.md) \| [`SelectUnitsEffect`](SelectUnitsEffect.md) \| [`ForEachUnitEffect`](ForEachUnitEffect.md) \| [`MovementModifierEffect`](MovementModifierEffect.md) \| [`AuraEffect`](AuraEffect.md) \| [`DesignateTargetEffect`](DesignateTargetEffect.md) \| [`RiskRewardEffect`](RiskRewardEffect.md) \| [`IssueOrdersEffect`](IssueOrdersEffect.md) \| [`ResourceActionMenuEffect`](ResourceActionMenuEffect.md) \| [`LeaderModelAbilityGrantEffect`](LeaderModelAbilityGrantEffect.md) \| [`PersistentDesignationEffect`](PersistentDesignationEffect.md) \| [`NoEffectEffect`](NoEffectEffect.md) \| [`SelectObjectiveEffect`](SelectObjectiveEffect.md) \| [`ForEachObjectiveEffect`](ForEachObjectiveEffect.md) \| [`PairedDesignationEffect`](PairedDesignationEffect.md) \| [`MiracleDieOperationEffect`](MiracleDieOperationEffect.md) \| [`FormationAttachmentGrantEffect`](FormationAttachmentGrantEffect.md) \| [`AttachmentEligibilityInheritEffect`](AttachmentEligibilityInheritEffect.md)

Defined in: [generated.ts:2441](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2441)

A prerequisite cost: the part's effect applies only after this complete cost is paid. An optional part may be declined without paying it.

***

### duration?

> `optional` **duration?**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"`

Defined in: [generated.ts:2474](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2474)

Expiration of this sub-effect, independently of sibling rules in an enclosing bundle.

***

### trigger?

> `optional` **trigger?**: [`Trigger`](Trigger.md) \| \[[`Trigger`](Trigger.md), `...Trigger[]`\]

Defined in: [generated.ts:2490](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2490)

The moment this part fires on, in the ability trigger's shape. When the part sits inside an activated effect, it applies only for the enclosing effect's duration.

***

### usage?

> `optional` **usage?**: [`AbilityUsage`](AbilityUsage.md)

Defined in: [generated.ts:2491](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2491)
