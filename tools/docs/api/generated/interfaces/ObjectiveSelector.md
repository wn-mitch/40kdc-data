[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ObjectiveSelector

# Interface: ObjectiveSelector

Defined in: [generated.ts:3187](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3187)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "objective-selector".

## Properties

### count

> **count**: `1`

Defined in: [generated.ts:3188](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3188)

***

### range\_inches?

> `optional` **range\_inches?**: `number`

Defined in: [generated.ts:3189](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3189)

***

### origin?

> `optional` **origin?**: `"bearer"` \| `"bearer-unit"`

Defined in: [generated.ts:3190](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3190)

***

### controlled\_by?

> `optional` **controlled\_by?**: `"opponent"` \| `"your-army"`

Defined in: [generated.ts:3191](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3191)

***

### requires\_unit?

> `optional` **requires\_unit?**: `object`

Defined in: [generated.ts:3192](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3192)

#### owner

> **owner**: `"friendly"` \| `"enemy"`

#### requires\_ability

> **requires\_ability**: `string`

#### relation

> **relation**: `"within-range"`

***

### selection\_limit?

> `optional` **selection\_limit?**: `object`

Defined in: [generated.ts:3197](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3197)

#### count

> **count**: `number`

#### period

> **period**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"`

***

### bind\_as

> **bind\_as**: `string`

Defined in: [generated.ts:3201](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3201)
