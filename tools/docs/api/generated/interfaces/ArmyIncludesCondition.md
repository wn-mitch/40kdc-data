[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyIncludesCondition

# Interface: ArmyIncludesCondition

Defined in: [generated.ts:2572](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2572)

[army] Your army includes at least `min` (default 1) units matching `filter`; with every: true, every unit (or model, with filter level: model) in your army matches it.

## Properties

### type

> **type**: `"army-includes"`

Defined in: [generated.ts:2573](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2573)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2574](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2574)

#### filter

> **filter**: [`UnitFilter`](UnitFilter.md)

#### min?

> `optional` **min?**: `number`

#### every?

> `optional` **every?**: `true`
