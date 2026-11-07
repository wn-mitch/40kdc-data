[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / BaseSize1

# Interface: BaseSize1

Defined in: [generated.ts:7947](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7947)

This model's base. Absent when no base could be resolved for the model.

## Properties

### shape

> **shape**: `"round"` \| `"oval"` \| `"flying-base"` \| `"hull"` \| `"unique"`

Defined in: [generated.ts:7948](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7948)

***

### diameter?

> `optional` **diameter?**: `number`

Defined in: [generated.ts:7949](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7949)

***

### width?

> `optional` **width?**: `number`

Defined in: [generated.ts:7950](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7950)

***

### length?

> `optional` **length?**: `number`

Defined in: [generated.ts:7951](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7951)

***

### size?

> `optional` **size?**: `"small"` \| `"large"`

Defined in: [generated.ts:7955](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7955)

Flying-base size class, when 'shape' is 'flying-base'.

***

### draft?

> `optional` **draft?**: `boolean`

Defined in: [generated.ts:7959](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7959)

True when the entry is provisional/guessed (e.g. a category without authoritative dimensions) and should be revisited.
