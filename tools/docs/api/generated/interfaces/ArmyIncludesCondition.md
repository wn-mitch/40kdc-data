[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyIncludesCondition

# Interface: ArmyIncludesCondition

Defined in: [generated.ts:2252](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2252)

[army] Your army includes at least `min` (default 1) units matching `filter`; with every: true, every unit (or model, with filter level: model) in your army matches it.

## Properties

### type

> **type**: `"army-includes"`

Defined in: [generated.ts:2253](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2253)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2254](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2254)

#### filter

> **filter**: [`UnitFilter`](UnitFilter.md)

#### min?

> `optional` **min?**: `number`

#### every?

> `optional` **every?**: `true`
