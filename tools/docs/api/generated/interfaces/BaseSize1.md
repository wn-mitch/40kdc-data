[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BaseSize1

# Interface: BaseSize1

Defined in: [generated.ts:1147](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1147)

This model's base. Absent when no base could be resolved for the model.

## Properties

### shape

> **shape**: `"round"` \| `"oval"` \| `"flying-base"` \| `"hull"` \| `"unique"`

Defined in: [generated.ts:1148](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1148)

***

### diameter?

> `optional` **diameter?**: `number`

Defined in: [generated.ts:1149](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1149)

***

### width?

> `optional` **width?**: `number`

Defined in: [generated.ts:1150](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1150)

***

### length?

> `optional` **length?**: `number`

Defined in: [generated.ts:1151](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1151)

***

### size?

> `optional` **size?**: `"small"` \| `"large"`

Defined in: [generated.ts:1155](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1155)

Flying-base size class, when 'shape' is 'flying-base'.

***

### draft?

> `optional` **draft?**: `boolean`

Defined in: [generated.ts:1159](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1159)

True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
