[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignatedCondition

# Interface: DesignatedCondition

Defined in: [generated.ts:2154](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2154)

[designation] The subject carries this designation. With count_min/count_max, counts how many units or objectives carry it.

## Properties

### type

> **type**: `"designated"`

Defined in: [generated.ts:2155](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2155)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2156](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2156)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \}

#### tag

> **tag**: `string`

#### count\_min?

> `optional` **count\_min?**: `number`

#### count\_max?

> `optional` **count\_max?**: `number`
