[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedWeaponCondition

# Interface: NamedWeaponCondition

Defined in: [generated.ts:1709](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1709)

[composition] This model (subject this-model) carries exactly count weapons with the printed name `name`. With subject this-unit and models, count bounds how many models in this unit each carry count such weapons (state carry), or each carry fewer than count (state lack).

## Properties

### type

> **type**: `"named-weapon"`

Defined in: [generated.ts:1710](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1710)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:1711](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L1711)

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
