[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / OathModifier

# Interface: OathModifier

Defined in: [generated.ts:4926](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4926)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "oath-modifier".

## Properties

### ability

> **ability**: `string`

Defined in: [generated.ts:4927](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4927)

***

### aspect

> **aspect**: `"selection"` \| `"quality-persistence"` \| `"deed-reward"`

Defined in: [generated.ts:4928](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4928)

***

### domains?

> `optional` **domains?**: \[`"deed"` \| `"quality"`, ...("deed" \| "quality")\[\]\]

Defined in: [generated.ts:4932](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4932)

#### Min Items

1

***

### exclude\_previously\_selected?

> `optional` **exclude\_previously\_selected?**: `true`

Defined in: [generated.ts:4933](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4933)

***

### duplicate\_roll?

> `optional` **duplicate\_roll?**: `"choose-unselected"`

Defined in: [generated.ts:4934](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4934)

***

### stop\_when?

> `optional` **stop\_when?**: `"all-domains-exhausted"`

Defined in: [generated.ts:4935](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4935)

***

### from?

> `optional` **from?**: `"fulfilled"`

Defined in: [generated.ts:4936](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4936)

***

### duration?

> `optional` **duration?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4937](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4937)

***

### applies\_to?

> `optional` **applies\_to?**: `"additional"`

Defined in: [generated.ts:4938](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4938)

***

### operation?

> `optional` **operation?**: `"replace"`

Defined in: [generated.ts:4939](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4939)

***

### selection\_method?

> `optional` **selection\_method?**: `"any"` \| `"chosen"` \| `"random"`

Defined in: [generated.ts:4940](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4940)

***

### effect?

> `optional` **effect?**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:4941](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4941)
