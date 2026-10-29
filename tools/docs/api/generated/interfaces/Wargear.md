[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wargear

# Interface: Wargear

Defined in: [generated.ts:7685](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7685)

A non-weapon item a model may carry — an icon, attachment, or other piece of equipment with no weapon profile. Weapons live in weapon.schema.json; this entity exists so wargear-option swaps and add-ons can reference equipment that is not a weapon.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wargear".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:7686](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7686)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:7687](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7687)

***

### name

> **name**: `string`

Defined in: [generated.ts:7688](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7688)

***

### category?

> `optional` **category?**: `string` \| `null`

Defined in: [generated.ts:7689](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7689)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7690](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7690)
