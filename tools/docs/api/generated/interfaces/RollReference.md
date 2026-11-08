[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollReference

# Interface: RollReference

Defined in: [generated.ts:1195](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1195)

The result of a roll an enclosing `roll` step bound: its total, or (with successes_on) how many of its dice rolled that value or higher, or (with comparison lte) that value or lower ("for each 1").

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "roll-reference".

## Properties

### roll\_var

> **roll\_var**: `string`

Defined in: [generated.ts:1196](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1196)

***

### successes\_on?

> `optional` **successes\_on?**: `number`

Defined in: [generated.ts:1197](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1197)

***

### comparison?

> `optional` **comparison?**: `"lte"`

Defined in: [generated.ts:1201](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L1201)

Count the dice that rolled successes_on or lower, not higher.
