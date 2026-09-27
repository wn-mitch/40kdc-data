[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PersistentDesignationEffect

# Interface: PersistentDesignationEffect

Defined in: [generated.ts:3098](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3098)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "persistent-designation-effect".

## Properties

### type

> **type**: `"persistent-designation"`

Defined in: [generated.ts:3099](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3099)

***

### operation?

> `optional` **operation?**: `"replace"` \| `"establish"`

Defined in: [generated.ts:3100](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3100)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:3101](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3101)

***

### select

> **select**: `object`

Defined in: [generated.ts:3102](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3102)

#### scope

> **scope**: `"enemy-unit"` \| `"objective-marker"`

#### count?

> `optional` **count?**: `1`

#### timing

> **timing**: `string`

#### selection\_policy

> **selection\_policy**: `"one-time"` \| `"replace-on-destroyed"`

#### allow\_while\_embarked?

> `optional` **allow\_while\_embarked?**: `boolean`

#### bind\_as?

> `optional` **bind\_as?**: `string`

***

### consumer?

> `optional` **consumer?**: `object`

Defined in: [generated.ts:3113](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3113)

Resolve the declared bearer-model or unit beneficiary against the exact retained reference.

#### relation

> **relation**: `"attacks-selected-unit"` \| `"within-selected-marker"`

Resolve this relation from the declared beneficiary to its retained unit or marker, not a generic target or nearby object.

#### beneficiary

> **beneficiary**: `"bearer"` \| `"unit"`

#### effect

> **effect**: [`SingleEffect`](../type-aliases/SingleEffect.md) \| [`StanceSelectEffect`](StanceSelectEffect.md) \| [`StanceSelectionCapacityEffect`](StanceSelectionCapacityEffect.md) \| [`ChoiceEffect`](ChoiceEffect.md) \| [`SequenceEffect`](SequenceEffect.md) \| [`RulesBundleEffect`](RulesBundleEffect.md) \| [`NamedEffect`](NamedEffect.md) \| [`AbilityPart`](AbilityPart.md) \| [`DiceGatedEffect`](DiceGatedEffect.md) \| [`DiceTableEffect`](DiceTableEffect.md) \| [`ConditionalEffect`](ConditionalEffect.md) \| [`DicePoolAllocationEffect`](DicePoolAllocationEffect.md) \| [`SelectUnitsEffect`](SelectUnitsEffect.md) \| [`ForEachUnitEffect`](ForEachUnitEffect.md) \| [`MovementModifierEffect`](MovementModifierEffect.md) \| [`AuraEffect`](AuraEffect.md) \| [`DesignateTargetEffect`](DesignateTargetEffect.md) \| [`RiskRewardEffect`](RiskRewardEffect.md) \| [`IssueOrdersEffect`](IssueOrdersEffect.md) \| [`ResourceActionMenuEffect`](ResourceActionMenuEffect.md) \| [`LeaderModelAbilityGrantEffect`](LeaderModelAbilityGrantEffect.md) \| `PersistentDesignationEffect` \| [`NoEffectEffect`](NoEffectEffect.md) \| [`SelectObjectiveEffect`](SelectObjectiveEffect.md) \| [`ForEachObjectiveEffect`](ForEachObjectiveEffect.md) \| [`PairedDesignationEffect`](PairedDesignationEffect.md) \| [`MiracleDieOperationEffect`](MiracleDieOperationEffect.md) \| [`FormationAttachmentGrantEffect`](FormationAttachmentGrantEffect.md) \| [`AttachmentEligibilityInheritEffect`](AttachmentEligibilityInheritEffect.md)

Nested effects apply to the declared beneficiary. An Objective Control set operation assigns the value, not a signed delta.

#### reference?

> `optional` **reference?**: [`SelectionReference`](SelectionReference.md)

***

### duration

> **duration**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"` \| `"until-next-command-phase"`

Defined in: [generated.ts:3154](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3154)

***

### lifecycle?

> `optional` **lifecycle?**: `object`

Defined in: [generated.ts:3155](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3155)

#### replace

> **replace**: `object`

##### replace.event

> **event**: `"on-unit-destroyed"`

##### replace.reference

> **reference**: [`SelectionReference`](SelectionReference.md)

##### replace.optional

> **optional**: `boolean`

#### exclusivity

> **exclusivity**: `"one-active-per-bearer-unit"`

#### expiry

> **expiry**: `"battle-end"`
