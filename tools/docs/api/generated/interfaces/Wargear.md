[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wargear

# Interface: Wargear

Defined in: [generated.ts:8225](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8225)

A non-weapon item a model may carry — an icon, attachment, or other piece of equipment with no weapon profile. Weapons live in weapon.schema.json; this entity exists so wargear-option swaps and add-ons can reference equipment that is not a weapon.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wargear".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:8226](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8226)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:8227](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8227)

***

### name

> **name**: `string`

Defined in: [generated.ts:8228](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8228)

***

### category?

> `optional` **category?**: `string` \| `null`

Defined in: [generated.ts:8229](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8229)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:8230](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8230)
