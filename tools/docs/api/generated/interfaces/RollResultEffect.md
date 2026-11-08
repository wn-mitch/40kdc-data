[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollResultEffect

# Interface: RollResultEffect

Defined in: [generated.ts:3742](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3742)

[roll] Fix a roll's result (pass, fail or a value; unmodified: it counts as that unmodified result), make it succeed only on an unmodified N+, fail on an unmodified N or less, or make it critical on N+ or on any success.

## Properties

### type

> **type**: `"roll-result"`

Defined in: [generated.ts:3743](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3743)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3744](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3744)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3745](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3745)

#### Index Signature

\[`k`: `string`\]: `unknown`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3748](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3748)
