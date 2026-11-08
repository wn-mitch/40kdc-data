[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RuleStateEffect

# Interface: RuleStateEffect

Defined in: [generated.ts:5314](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5314)

[permission] Switch a named rule on or off for the target.

## Properties

### type

> **type**: `"rule-state"`

Defined in: [generated.ts:5315](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5315)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5316](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5316)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5317](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5317)

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

Defined in: [generated.ts:5329](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5329)
