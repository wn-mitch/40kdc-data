[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MortalWoundsEffect

# Interface: MortalWoundsEffect

Defined in: [generated.ts:4379](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4379)

[protection] The target suffers mortal wounds: a count, or a count per success on a roll per model.

## Properties

### type

> **type**: `"mortal-wounds"`

Defined in: [generated.ts:4380](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4380)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4381](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4381)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4382](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4382)

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

Defined in: [generated.ts:4395](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4395)
