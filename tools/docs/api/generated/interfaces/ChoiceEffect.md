[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ChoiceEffect

# Interface: ChoiceEffect

Defined in: [generated.ts:3979](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3979)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "choice-effect".

## Properties

### type

> **type**: `"choice"`

Defined in: [generated.ts:3980](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3980)

***

### options

> **options**: \[[`EffectNode`](../type-aliases/EffectNode.md), [`EffectNode`](../type-aliases/EffectNode.md), `...EffectNode[]`\]

Defined in: [generated.ts:3984](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3984)

#### Min Items

2

***

### choice\_label?

> `optional` **choice\_label?**: `string`

Defined in: [generated.ts:3985](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3985)

***

### choice\_prompt?

> `optional` **choice\_prompt?**: `string`

Defined in: [generated.ts:3986](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3986)

***

### min\_choices?

> `optional` **min\_choices?**: `number`

Defined in: [generated.ts:3990](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3990)

Minimum number of distinct options selected at this activation; defaults to one.

***

### max\_choices?

> `optional` **max\_choices?**: `number`

Defined in: [generated.ts:3994](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3994)

Maximum number of distinct options selected at this activation; defaults to one.

***

### chosen\_by?

> `optional` **chosen\_by?**: `"opponent"`

Defined in: [generated.ts:3998](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3998)

Who picks the option: the opponent ("your opponent must decide whether that unit will take cover or stand firm"). Absent, the player using the ability picks.
