[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedWeaponCondition

# Interface: NamedWeaponCondition

Defined in: [generated.ts:2105](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2105)

[composition] This model (subject this-model) carries exactly count weapons with the printed name `name`. With subject this-unit and models, count bounds how many models in this unit each carry count such weapons (state carry), or each carry fewer than count (state lack).

## Properties

### type

> **type**: `"named-weapon"`

Defined in: [generated.ts:2106](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2106)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2107](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2107)

#### subject

> **subject**: [`UnitRef`](../type-aliases/UnitRef.md)

#### name

> **name**: `string`

#### count

> **count**: `number`

#### models?

> `optional` **models?**: `object`

##### models.count

> **count**: [`CountBounds1`](CountBounds1.md)

##### models.state

> **state**: `"carry"` \| `"lack"`
