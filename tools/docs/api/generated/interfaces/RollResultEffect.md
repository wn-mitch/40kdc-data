[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollResultEffect

# Interface: RollResultEffect

Defined in: [generated.ts:3280](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3280)

[roll] Fix a roll's result (pass, fail or a value; unmodified: it counts as that unmodified result), make it succeed only on an unmodified N+, fail on an unmodified N or less, or make it critical on N+ or on any success.

## Properties

### type

> **type**: `"roll-result"`

Defined in: [generated.ts:3281](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3281)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3282](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3282)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3283](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3283)

#### Index Signature

\[`k`: `string`\]: `unknown`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3286](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3286)
