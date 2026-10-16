[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / OathModifier

# Interface: OathModifier

Defined in: [generated.ts:4134](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4134)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "oath-modifier".

## Properties

### ability

> **ability**: `string`

Defined in: [generated.ts:4135](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4135)

***

### aspect

> **aspect**: `"selection"` \| `"quality-persistence"` \| `"deed-reward"`

Defined in: [generated.ts:4136](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4136)

***

### domains?

> `optional` **domains?**: \[`"deed"` \| `"quality"`, ...("deed" \| "quality")\[\]\]

Defined in: [generated.ts:4140](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4140)

#### Min Items

1

***

### exclude\_previously\_selected?

> `optional` **exclude\_previously\_selected?**: `true`

Defined in: [generated.ts:4141](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4141)

***

### duplicate\_roll?

> `optional` **duplicate\_roll?**: `"choose-unselected"`

Defined in: [generated.ts:4142](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4142)

***

### stop\_when?

> `optional` **stop\_when?**: `"all-domains-exhausted"`

Defined in: [generated.ts:4143](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4143)

***

### from?

> `optional` **from?**: `"fulfilled"`

Defined in: [generated.ts:4144](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4144)

***

### duration?

> `optional` **duration?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

Defined in: [generated.ts:4145](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4145)

***

### applies\_to?

> `optional` **applies\_to?**: `"additional"`

Defined in: [generated.ts:4146](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4146)

***

### operation?

> `optional` **operation?**: `"replace"`

Defined in: [generated.ts:4147](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4147)

***

### selection\_method?

> `optional` **selection\_method?**: `"any"` \| `"chosen"` \| `"random"`

Defined in: [generated.ts:4148](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4148)

***

### effect?

> `optional` **effect?**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:4149](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4149)
