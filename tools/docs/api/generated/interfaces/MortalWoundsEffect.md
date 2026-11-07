[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MortalWoundsEffect

# Interface: MortalWoundsEffect

Defined in: [generated.ts:5340](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5340)

[protection] The target suffers mortal wounds: a count, or a count per success on a roll per model.

## Properties

### type

> **type**: `"mortal-wounds"`

Defined in: [generated.ts:5341](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5341)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5342](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5342)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5343](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5343)

#### count

> **count**: [`Quantity`](../type-aliases/Quantity.md)

#### max?

> `optional` **max?**: `number`

No more than this many mortal wounds in total ("to a maximum of 6 mortal wounds").

#### per?

> `optional` **per?**: `"success"` \| `"model"`

#### roll?

> `optional` **roll?**: `object`

##### Index Signature

\[`k`: `string`\]: `unknown`

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### psychic?

> `optional` **psychic?**: `true`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5356](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5356)
