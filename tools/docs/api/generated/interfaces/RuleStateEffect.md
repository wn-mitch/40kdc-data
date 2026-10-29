[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RuleStateEffect

# Interface: RuleStateEffect

Defined in: [generated.ts:4963](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4963)

[permission] Switch a named rule on or off for the target.

## Properties

### type

> **type**: `"rule-state"`

Defined in: [generated.ts:4964](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4964)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4965](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4965)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4966](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4966)

#### direction

> **direction**: `"granted"` \| `"suppressed"` \| `"exchanged"`

#### rule\_kind

> **rule\_kind**: `"ability"` \| `"faction-rule"` \| `"core-rule"` \| `"keyword"`

#### rule

> **rule**: `string` \| [`StanceOptionRef`](StanceOptionRef.md) \| [`NamedAbilityRef`](NamedAbilityRef.md)

#### exchange\_with?

> `optional` **exchange\_with?**: [`NamedAbilityRef`](NamedAbilityRef.md)

#### except\_from?

> `optional` **except\_from?**: `"this-ability"`

#### any\_army\_faction?

> `optional` **any\_army\_faction?**: `true`

A granted faction rule the holder can use whatever your Army Faction is ("even though your Army Faction is not X"): the rule's own Army Faction requirement does not apply to it.

#### attacks?

> `optional` **attacks?**: [`EventBoundReference3`](EventBoundReference3.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4978](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4978)
