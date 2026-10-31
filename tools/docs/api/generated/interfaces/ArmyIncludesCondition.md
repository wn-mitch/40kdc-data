[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyIncludesCondition

# Interface: ArmyIncludesCondition

Defined in: [generated.ts:2693](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2693)

[army] Your army includes at least `min` (default 1) units matching `filter`; with every: true, every unit (or model, with filter level: model) in your army matches it.

## Properties

### type

> **type**: `"army-includes"`

Defined in: [generated.ts:2694](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2694)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2695](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2695)

#### filter

> **filter**: [`UnitFilter`](UnitFilter.md)

#### min?

> `optional` **min?**: `number`

#### every?

> `optional` **every?**: `true`
