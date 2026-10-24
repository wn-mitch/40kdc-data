[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityPart

# Interface: AbilityPart

Defined in: [generated.ts:3524](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3524)

One part of a compound ability: an effect with its own moment (trigger), usage limit, cost or choice, shown as one bullet of the ability it belongs to. The ability's own trigger is its firing moment; a part's trigger is the moment of that part alone, in the same trigger shape. `name` is only for a part the rules name (a psychic power, a named rule in a bundle).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-part".

## Properties

### type

> **type**: `"ability-part"`

Defined in: [generated.ts:3525](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3525)

***

### name?

> `optional` **name?**: `string`

Defined in: [generated.ts:3529](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3529)

The part's own name, only when the rules give it one.

***

### kind?

> `optional` **kind?**: `"psychic"`

Defined in: [generated.ts:3530](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3530)

***

### level?

> `optional` **level?**: `number`

Defined in: [generated.ts:3531](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3531)

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:3532](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3532)

***

### optional?

> `optional` **optional?**: `boolean`

Defined in: [generated.ts:3536](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3536)

Whether the controlling player may decline this part.

***

### cost?

> `optional` **cost?**: [`SingleEffect`](../type-aliases/SingleEffect.md) \| [`StanceSelectEffect`](StanceSelectEffect.md) \| [`StanceSelectionCapacityEffect`](StanceSelectionCapacityEffect.md) \| [`ChoiceEffect`](ChoiceEffect.md) \| [`SequenceEffect`](SequenceEffect.md) \| [`RulesBundleEffect`](RulesBundleEffect.md) \| `AbilityPart` \| [`DiceGatedEffect`](../type-aliases/DiceGatedEffect.md) \| [`DiceTableEffect`](DiceTableEffect.md) \| [`ConditionalEffect`](ConditionalEffect.md) \| [`DicePoolAllocationEffect`](DicePoolAllocationEffect.md) \| [`SelectUnitsEffect`](SelectUnitsEffect.md) \| [`ForEachUnitEffect`](ForEachUnitEffect.md) \| [`AuraEffect`](AuraEffect.md) \| [`DesignateTargetEffect`](DesignateTargetEffect.md) \| [`RiskRewardEffect`](RiskRewardEffect.md) \| [`IssueOrdersEffect`](IssueOrdersEffect.md) \| [`ResourceActionMenuEffect`](ResourceActionMenuEffect.md) \| [`NamedRegionStateEffect`](NamedRegionStateEffect.md) \| [`PersistentDesignationEffect`](PersistentDesignationEffect.md) \| [`NoEffectEffect`](NoEffectEffect.md) \| [`RollEffect`](RollEffect.md) \| [`SelectObjectiveEffect`](SelectObjectiveEffect.md) \| [`OathModifierEffect`](OathModifierEffect.md)

Defined in: [generated.ts:3540](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3540)

A prerequisite cost: the part's effect applies only after this complete cost is paid. An optional part may be declined without paying it.

***

### duration?

> `optional` **duration?**: `"battle-round"` \| `"phase"` \| `"turn"` \| `"battle"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"` \| `"while-leading"` \| `"after-resolving"` \| `"until-next-shooting-phase"` \| `"until-end-of-your-next-turn"` \| `"until-end-of-opponent-next-turn"` \| `"until-this-unit-has-shot"` \| `"control-lost"` \| `"until-end-of-your-next-fight-phase"` \| `"until-end-of-your-next-shooting-phase"` \| `"until-end-of-your-next-movement-phase"` \| `"until-end-of-opponent-next-movement-phase"` \| `"until-start-of-opponent-next-command-phase"`

Defined in: [generated.ts:3568](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3568)

Expiration of this sub-effect, independently of sibling rules in an enclosing bundle.

***

### trigger?

> `optional` **trigger?**: [`Trigger`](Trigger.md) \| \[[`Trigger`](Trigger.md), `...Trigger[]`\]

Defined in: [generated.ts:3596](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3596)

The moment this part fires on, in the ability trigger's shape. When the part sits inside an activated effect, it applies only for the enclosing effect's duration.

***

### usage?

> `optional` **usage?**: [`AbilityUsageLimit`](AbilityUsageLimit.md) \| \[[`AbilityUsageLimit`](AbilityUsageLimit.md), [`AbilityUsageLimit`](AbilityUsageLimit.md), `...AbilityUsageLimit[]`\]

Defined in: [generated.ts:3600](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3600)

How often this part may be used, when the limit is the part's and not the whole ability's.
