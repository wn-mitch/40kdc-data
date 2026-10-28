[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RollResultEffect

# Interface: RollResultEffect

Defined in: [generated.ts:3615](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3615)

[roll] Fix a roll's result (pass, fail or a value; unmodified: it counts as that unmodified result), make it succeed only on an unmodified N+, fail on an unmodified N or less, or make it critical on N+ or on any success.

## Properties

### type

> **type**: `"roll-result"`

Defined in: [generated.ts:3616](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3616)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3617](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3617)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3618](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3618)

#### Index Signature

\[`k`: `string`\]: `unknown`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3621](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3621)
