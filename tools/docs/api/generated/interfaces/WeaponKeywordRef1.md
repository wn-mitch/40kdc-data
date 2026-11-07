[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WeaponKeywordRef1

# Interface: WeaponKeywordRef1

Defined in: [generated.ts:2784](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2784)

A catalog-backed weapon keyword selector. Parameters may omit a rating when matching any rating.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "weapon-keyword-selector".

## Properties

### keyword\_id

> **keyword\_id**: `string`

Defined in: [generated.ts:2785](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2785)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2786](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2786)

#### value?

> `optional` **value?**: [`Quantity`](../type-aliases/Quantity.md)

#### target\_keyword?

> `optional` **target\_keyword?**: `string`

#### threshold?

> `optional` **threshold?**: `number`

#### required\_target\_keywords\_any?

> `optional` **required\_target\_keywords\_any?**: [`KeywordList4`](../type-aliases/KeywordList4.md)

#### excluded\_target\_keywords?

> `optional` **excluded\_target\_keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)
