[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceSpendEffect

# Interface: ResourceSpendEffect

Defined in: [generated.ts:5090](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5090)

[resource] Spend from a resource pool only when it has sufficient balance; the spend fails as a whole rather than producing a negative or clamped pool. face: spend dice showing this value; requirement: spend dice forming this pair, triple or run.

## Properties

### type

> **type**: `"resource-spend"`

Defined in: [generated.ts:5091](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5091)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5092](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5092)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5093](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5093)

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

Defined in: [generated.ts:5100](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5100)
