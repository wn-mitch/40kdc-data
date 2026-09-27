[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / PairedDesignationEffect

# Interface: PairedDesignationEffect

Defined in: [generated.ts:3216](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3216)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "paired-designation-effect".

## Properties

### type

> **type**: `"paired-designation"`

Defined in: [generated.ts:3217](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3217)

***

### duration

> **duration**: `"phase"`

Defined in: [generated.ts:3218](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3218)

***

### observer

> **observer**: `object`

Defined in: [generated.ts:3219](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3219)

#### role

> **role**: `"observer"`

#### selector

> **selector**: `object` & [`PairedUnitSelector1`](../type-aliases/PairedUnitSelector1.md) & `object`

##### Type Declaration

###### owner

> **owner**: `"friendly"` \| `"enemy"`

###### count?

> `optional` **count?**: `1`

###### selection\_mode?

> `optional` **selection\_mode?**: `"any-number"`

###### requires\_ability?

> `optional` **requires\_ability?**: `string`

###### visible\_to?

> `optional` **visible\_to?**: [`SelectionReference`](SelectionReference.md)

###### selection\_limit?

> `optional` **selection\_limit?**: `object`

###### selection\_limit.count

> **count**: `number`

###### selection\_limit.period

> **period**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"`

###### bind\_as

> **bind\_as**: `string`

##### Type Declaration

###### owner?

> `optional` **owner?**: `"friendly"`

###### selection\_mode

> **selection\_mode**: `"any-number"`

***

### spotted

> **spotted**: `object`

Defined in: [generated.ts:3227](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3227)

#### role

> **role**: `"spotted"`

#### selector

> **selector**: `object` & [`PairedUnitSelector1`](../type-aliases/PairedUnitSelector1.md) & `object`

##### Type Declaration

###### owner

> **owner**: `"friendly"` \| `"enemy"`

###### count?

> `optional` **count?**: `1`

###### selection\_mode?

> `optional` **selection\_mode?**: `"any-number"`

###### requires\_ability?

> `optional` **requires\_ability?**: `string`

###### visible\_to?

> `optional` **visible\_to?**: [`SelectionReference`](SelectionReference.md)

###### selection\_limit?

> `optional` **selection\_limit?**: `object`

###### selection\_limit.count

> **count**: `number`

###### selection\_limit.period

> **period**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"`

###### bind\_as

> **bind\_as**: `string`

##### Type Declaration

###### owner?

> `optional` **owner?**: `"enemy"`

###### count

> **count**: `1`

***

### guided

> **guided**: `object`

Defined in: [generated.ts:3235](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3235)

#### role

> **role**: `"guided"`

#### owner

> **owner**: `"friendly"`

#### requires\_ability

> **requires\_ability**: `string`

#### excludes

> **excludes**: [`SelectionReference`](SelectionReference.md)

#### while\_attacking

> **while\_attacking**: [`SelectionReference`](SelectionReference.md)

***

### observer\_eligibility

> **observer\_eligibility**: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md)

Defined in: [generated.ts:3242](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3242)

***

### effects

> **effects**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:3243](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3243)
