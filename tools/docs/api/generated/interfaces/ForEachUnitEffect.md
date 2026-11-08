[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ForEachUnitEffect

# Interface: ForEachUnitEffect

Defined in: [generated.ts:4225](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4225)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "for-each-unit-effect".

## Properties

### type

> **type**: `"for-each-unit"`

Defined in: [generated.ts:4226](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4226)

***

### selector

> **selector**: [`UnitSelector`](UnitSelector.md)

Defined in: [generated.ts:4227](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4227)

***

### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:4228](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4228)

***

### max\_affected?

> `optional` **max\_affected?**: `string` \| `number` \| [`BattleSizeValue`](BattleSizeValue.md) \| [`RollReference`](RollReference.md) \| [`CountOf`](CountOf.md) \| [`UnitRating`](UnitRating.md)

Defined in: [generated.ts:4232](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4232)

A count, amount or value: a number, a dice expression (D3, 2D6, D6+1), one value per battle size, the result of a bound roll, or a count of something on the battlefield, or the rating the unit prints for this rule.
