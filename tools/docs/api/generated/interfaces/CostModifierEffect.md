[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CostModifierEffect

# Interface: CostModifierEffect

Defined in: [generated.ts:6062](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6062)

[resource] Change what a Stratagem, manoeuvre or ability costs.

## Properties

### type

> **type**: `"cost-modifier"`

Defined in: [generated.ts:6063](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6063)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6064](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6064)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6065](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6065)

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

Defined in: [generated.ts:6072](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6072)
