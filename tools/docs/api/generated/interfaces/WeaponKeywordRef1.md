[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponKeywordRef1

# Interface: WeaponKeywordRef1

Defined in: [generated.ts:2340](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2340)

A catalog-backed weapon keyword selector. Parameters may omit a rating when matching any rating.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon-keyword-selector".

## Properties

### keyword\_id

> **keyword\_id**: `string`

Defined in: [generated.ts:2341](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2341)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2342](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2342)

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
