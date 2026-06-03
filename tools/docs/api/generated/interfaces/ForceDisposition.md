[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ForceDisposition

# Interface: ForceDisposition

Defined in: [generated.ts:396](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L396)

A 11e strategic-intent tag granted by detachments. Players compare dispositions at game start to determine the shared mission; asymmetric primary objectives result.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "force-disposition".

## Properties

### id

> **id**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:400](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L400)

One of the five confirmed launch Force Dispositions.

***

### name

> **name**: `string`

Defined in: [generated.ts:401](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L401)

***

### text?

> `optional` **text?**: `string`

Defined in: [generated.ts:405](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L405)

Community-authored description of the disposition's effect (original prose only — no reproduced rules text).

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:406](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L406)
