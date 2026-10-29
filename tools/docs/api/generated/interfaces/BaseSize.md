[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BaseSize

# Interface: BaseSize

Defined in: [generated.ts:1257](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1257)

A model's base. 'round' carries 'diameter'; 'oval' carries 'width'+'length'. 'flying-base' (with 'size': small/large), 'hull', and 'unique' are categories the GW base-size guide gives without standard millimetre dimensions; entries carrying such a category, or any millimetre value not taken from an authoritative source, set 'draft': true to mark them for later hand-authoring.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "base-size".

## Properties

### shape

> **shape**: `"round"` \| `"oval"` \| `"flying-base"` \| `"hull"` \| `"unique"`

Defined in: [generated.ts:1258](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1258)

***

### diameter?

> `optional` **diameter?**: `number`

Defined in: [generated.ts:1259](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1259)

***

### width?

> `optional` **width?**: `number`

Defined in: [generated.ts:1260](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1260)

***

### length?

> `optional` **length?**: `number`

Defined in: [generated.ts:1261](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1261)

***

### size?

> `optional` **size?**: `"small"` \| `"large"`

Defined in: [generated.ts:1265](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1265)

Flying-base size class, when 'shape' is 'flying-base'.

***

### draft?

> `optional` **draft?**: `boolean`

Defined in: [generated.ts:1269](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L1269)

True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
