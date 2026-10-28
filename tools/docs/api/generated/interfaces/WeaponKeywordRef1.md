[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponKeywordRef1

# Interface: WeaponKeywordRef1

Defined in: [generated.ts:2663](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2663)

A catalog-backed weapon keyword selector. Parameters may omit a rating when matching any rating.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon-keyword-selector".

## Properties

### keyword\_id

> **keyword\_id**: `string`

Defined in: [generated.ts:2664](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2664)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2665](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2665)

#### value?

> `optional` **value?**: [`Quantity`](../type-aliases/Quantity.md)

#### target\_keyword?

> `optional` **target\_keyword?**: `string`

#### threshold?

> `optional` **threshold?**: `number`

#### required\_target\_keywords\_any?

> `optional` **required\_target\_keywords\_any?**: [`KeywordList2`](../type-aliases/KeywordList2.md)

#### excluded\_target\_keywords?

> `optional` **excluded\_target\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)
