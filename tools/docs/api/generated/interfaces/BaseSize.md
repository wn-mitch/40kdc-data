[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BaseSize

# Interface: BaseSize

Defined in: [generated.ts:233](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L233)

A model's base. 'round' carries 'diameter'; 'oval' carries 'width'+'length'. 'flying-base' (with 'size': small/large), 'hull', and 'unique' are categories the GW base-size guide gives without standard millimetre dimensions; entries carrying such a category, or any millimetre value not taken from an authoritative source, set 'draft': true to mark them for later hand-authoring.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "base-size".

## Properties

### shape

> **shape**: `"round"` \| `"oval"` \| `"flying-base"` \| `"hull"` \| `"unique"`

Defined in: [generated.ts:234](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L234)

***

### diameter?

> `optional` **diameter?**: `number`

Defined in: [generated.ts:235](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L235)

***

### width?

> `optional` **width?**: `number`

Defined in: [generated.ts:236](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L236)

***

### length?

> `optional` **length?**: `number`

Defined in: [generated.ts:237](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L237)

***

### size?

> `optional` **size?**: `"small"` \| `"large"`

Defined in: [generated.ts:241](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L241)

Flying-base size class, when 'shape' is 'flying-base'.

***

### draft?

> `optional` **draft?**: `boolean`

Defined in: [generated.ts:245](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L245)

True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
