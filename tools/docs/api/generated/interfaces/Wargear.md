[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / Wargear

# Interface: Wargear

Defined in: [generated.ts:4267](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4267)

A non-weapon item a model may carry — an icon, attachment, or other piece of equipment with no weapon profile. Weapons live in weapon.schema.json; this entity exists so wargear-option swaps and add-ons can reference equipment that is not a weapon.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wargear".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:4268](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4268)

***

### external\_refs?

> `optional` **external\_refs?**: [`ExternalReferenceList`](../type-aliases/ExternalReferenceList.md)

Defined in: [generated.ts:4269](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4269)

***

### name

> **name**: `string`

Defined in: [generated.ts:4270](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4270)

***

### category?

> `optional` **category?**: `string` \| `null`

Defined in: [generated.ts:4271](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4271)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:4272](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4272)
