[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MortalWoundsEffect

# Interface: MortalWoundsEffect

Defined in: [generated.ts:4989](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4989)

[protection] The target suffers mortal wounds: a count, or a count per success on a roll per model.

## Properties

### type

> **type**: `"mortal-wounds"`

Defined in: [generated.ts:4990](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4990)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4991](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4991)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4992](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4992)

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

Defined in: [generated.ts:5005](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5005)
