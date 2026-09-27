[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / LeaderModelAbilityGrantEffect

# Interface: LeaderModelAbilityGrantEffect

Defined in: [generated.ts:3062](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3062)

Resolve the attached qualifying leader model and dispatch a targetless effect to that model while it leads the bearer unit.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "leader-model-ability-grant-effect".

## Properties

### type

> **type**: `"leader-model-ability-grant"`

Defined in: [generated.ts:3063](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3063)

***

### source

> **source**: `"bearer-unit"`

Defined in: [generated.ts:3064](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3064)

***

### beneficiary

> **beneficiary**: `"leading-leader-model"` \| `"attached-character-leader"`

Defined in: [generated.ts:3065](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3065)

***

### leader\_filter?

> `optional` **leader\_filter?**: `object`

Defined in: [generated.ts:3066](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3066)

#### identity?

> `optional` **identity?**: `string`

#### keywords?

> `optional` **keywords?**: \[`string`, `...string[]`\]

##### Min Items

1

***

### attached\_unit\_filter

> **attached\_unit\_filter**: \[`string`, `...string[]`\] \| `null`

Defined in: [generated.ts:3073](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3073)

***

### duration

> **duration**: `"while-leading"`

Defined in: [generated.ts:3074](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3074)

***

### grant

> **grant**: `object`

Defined in: [generated.ts:3075](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3075)

#### recipient

> **recipient**: `"beneficiary"`

#### effect

> **effect**: [`BeneficiaryBoundEffectNode`](BeneficiaryBoundEffectNode.md)

***

### recipient\_binding

> **recipient\_binding**: `"beneficiary-only"`

Defined in: [generated.ts:3079](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3079)
