[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CostModifierEffect

# Interface: CostModifierEffect

Defined in: [generated.ts:5062](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5062)

[resource] Change what a Stratagem, manoeuvre or ability costs.

## Properties

### type

> **type**: `"cost-modifier"`

Defined in: [generated.ts:5063](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5063)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5064](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5064)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5065](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5065)

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

Defined in: [generated.ts:5072](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5072)
