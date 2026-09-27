[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedRegionConsumer

# Interface: NamedRegionConsumer

Defined in: [generated.ts:4663](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4663)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-region-consumer".

## Properties

### state\_ref

> **state\_ref**: [`NamedRegionRef`](NamedRegionRef.md)

Defined in: [generated.ts:4664](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4664)

***

### beneficiary\_gate

> **beneficiary\_gate**: `object`

Defined in: [generated.ts:4665](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4665)

#### Index Signature

\[`k`: `string`\]: `unknown`

#### owner

> **owner**: `string`

#### faction?

> `optional` **faction?**: `string`

#### operator

> **operator**: `"and"` \| `"or"`

#### keywords

> **keywords**: \[`string`, `...string[]`\]

##### Min Items

1

***

### membership

> **membership**: [`NamedRegionMembership`](NamedRegionMembership.md)

Defined in: [generated.ts:4675](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4675)

***

### qualified\_condition

> **qualified\_condition**: [`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md)

Defined in: [generated.ts:4676](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4676)

***

### default\_branch

> **default\_branch**: [`NamedRegionBranch`](NamedRegionBranch.md)

Defined in: [generated.ts:4677](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4677)

***

### qualified\_branch

> **qualified\_branch**: [`NamedRegionBranch`](NamedRegionBranch.md)

Defined in: [generated.ts:4678](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4678)

***

### attack\_condition?

> `optional` **attack\_condition?**: [`AbilityDSLCondition7`](../type-aliases/AbilityDSLCondition7.md)

Defined in: [generated.ts:4679](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4679)
