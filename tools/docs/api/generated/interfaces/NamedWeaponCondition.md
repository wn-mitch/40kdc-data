[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedWeaponCondition

# Interface: NamedWeaponCondition

Defined in: [generated.ts:2009](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2009)

[composition] This model (subject this-model) carries exactly count weapons with the printed name `name`. With subject this-unit and models, count bounds how many models in this unit each carry count such weapons (state carry), or each carry fewer than count (state lack).

## Properties

### type

> **type**: `"named-weapon"`

Defined in: [generated.ts:2010](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2010)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2011](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2011)

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
