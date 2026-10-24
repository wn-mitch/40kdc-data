[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RuleStateEffect

# Interface: RuleStateEffect

Defined in: [generated.ts:4357](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4357)

[permission] Switch a named rule on or off for the target.

## Properties

### type

> **type**: `"rule-state"`

Defined in: [generated.ts:4358](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4358)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4359](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4359)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4360](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4360)

#### direction

> **direction**: `"granted"` \| `"suppressed"` \| `"exchanged"`

#### rule\_kind

> **rule\_kind**: `"ability"` \| `"faction-rule"` \| `"core-rule"` \| `"keyword"`

#### rule

> **rule**: `string` \| [`NamedAbilityRef`](NamedAbilityRef.md)

#### exchange\_with?

> `optional` **exchange\_with?**: [`NamedAbilityRef`](NamedAbilityRef.md)

#### except\_from?

> `optional` **except\_from?**: `"this-ability"`

#### attacks?

> `optional` **attacks?**: [`EventBoundReference3`](EventBoundReference3.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4368](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4368)
