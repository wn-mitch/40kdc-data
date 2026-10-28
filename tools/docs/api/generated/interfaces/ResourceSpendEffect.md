[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceSpendEffect

# Interface: ResourceSpendEffect

Defined in: [generated.ts:5715](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5715)

[resource] Spend from a resource pool only when it has sufficient balance; the spend fails as a whole rather than producing a negative or clamped pool. face: spend dice showing this value; requirement: spend dice forming this pair, triple or run.

## Properties

### type

> **type**: `"resource-spend"`

Defined in: [generated.ts:5716](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5716)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5717](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5717)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5718](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5718)

#### pool

> **pool**: `string`

#### amount

> **amount**: [`Quantity`](../type-aliases/Quantity.md)

#### label?

> `optional` **label?**: `string`

#### face?

> `optional` **face?**: `number`

#### requirement?

> `optional` **requirement?**: [`DiceRequirementSpec`](../type-aliases/DiceRequirementSpec.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5725](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5725)
