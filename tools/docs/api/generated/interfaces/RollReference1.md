[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollReference1

# Interface: RollReference1

Defined in: [generated.ts:4113](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4113)

The result of a roll an enclosing `roll` step bound: its total, or (with successes_on) how many of its dice rolled that value or higher, or (with comparison lte) that value or lower ("for each 1").

## Properties

### roll\_var

> **roll\_var**: `string`

Defined in: [generated.ts:4114](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4114)

***

### successes\_on?

> `optional` **successes\_on?**: `number`

Defined in: [generated.ts:4115](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4115)

***

### comparison?

> `optional` **comparison?**: `"lte"`

Defined in: [generated.ts:4119](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4119)

Count the dice that rolled successes_on or lower, not higher.
