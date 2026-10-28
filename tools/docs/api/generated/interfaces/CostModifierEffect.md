[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CostModifierEffect

# Interface: CostModifierEffect

Defined in: [generated.ts:5687](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5687)

[resource] Change what a Stratagem, manoeuvre or ability costs.

## Properties

### type

> **type**: `"cost-modifier"`

Defined in: [generated.ts:5688](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5688)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5689](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5689)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5690](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5690)

#### of

> **of**: `"ability"` \| `"stratagem"` \| `"manoeuvre"`

#### id?

> `optional` **id?**: `string`

#### operation

> **operation**: `"set"` \| `"multiply"` \| `"increase"` \| `"decrease"` \| `"waive"`

#### amount?

> `optional` **amount?**: `number`

#### applies\_to?

> `optional` **applies\_to?**: `"any"` \| `"targeting-this-unit"` \| `"used-by-this-unit"` \| `"the-triggering-use"`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5697](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5697)
