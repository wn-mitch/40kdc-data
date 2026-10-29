[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / OathModifier

# Interface: OathModifier

Defined in: [generated.ts:4669](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4669)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "oath-modifier".

## Properties

### ability

> **ability**: `string`

Defined in: [generated.ts:4670](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4670)

***

### aspect

> **aspect**: `"selection"` \| `"quality-persistence"` \| `"deed-reward"`

Defined in: [generated.ts:4671](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4671)

***

### domains?

> `optional` **domains?**: \[`"deed"` \| `"quality"`, ...("deed" \| "quality")\[\]\]

Defined in: [generated.ts:4675](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4675)

#### Min Items

1

***

### exclude\_previously\_selected?

> `optional` **exclude\_previously\_selected?**: `true`

Defined in: [generated.ts:4676](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4676)

***

### duplicate\_roll?

> `optional` **duplicate\_roll?**: `"choose-unselected"`

Defined in: [generated.ts:4677](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4677)

***

### stop\_when?

> `optional` **stop\_when?**: `"all-domains-exhausted"`

Defined in: [generated.ts:4678](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4678)

***

### from?

> `optional` **from?**: `"fulfilled"`

Defined in: [generated.ts:4679](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4679)

***

### duration?

> `optional` **duration?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4680](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4680)

***

### applies\_to?

> `optional` **applies\_to?**: `"additional"`

Defined in: [generated.ts:4681](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4681)

***

### operation?

> `optional` **operation?**: `"replace"`

Defined in: [generated.ts:4682](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4682)

***

### selection\_method?

> `optional` **selection\_method?**: `"any"` \| `"chosen"` \| `"random"`

Defined in: [generated.ts:4683](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4683)

***

### effect?

> `optional` **effect?**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:4684](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4684)
