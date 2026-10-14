[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BaseSize

# Interface: BaseSize

Defined in: [generated.ts:910](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L910)

A model's base. 'round' carries 'diameter'; 'oval' carries 'width'+'length'. 'flying-base' (with 'size': small/large), 'hull', and 'unique' are categories the GW base-size guide gives without standard millimetre dimensions; entries carrying such a category, or any millimetre value not taken from an authoritative source, set 'draft': true to mark them for later hand-authoring.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "base-size".

## Properties

### shape

> **shape**: `"round"` \| `"oval"` \| `"flying-base"` \| `"hull"` \| `"unique"`

Defined in: [generated.ts:911](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L911)

***

### diameter?

> `optional` **diameter?**: `number`

Defined in: [generated.ts:912](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L912)

***

### width?

> `optional` **width?**: `number`

Defined in: [generated.ts:913](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L913)

***

### length?

> `optional` **length?**: `number`

Defined in: [generated.ts:914](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L914)

***

### size?

> `optional` **size?**: `"small"` \| `"large"`

Defined in: [generated.ts:918](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L918)

Flying-base size class, when 'shape' is 'flying-base'.

***

### draft?

> `optional` **draft?**: `boolean`

Defined in: [generated.ts:922](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L922)

True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
