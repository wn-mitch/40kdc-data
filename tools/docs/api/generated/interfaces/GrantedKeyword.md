[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GrantedKeyword

# Interface: GrantedKeyword

Defined in: [generated.ts:2580](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2580)

A construction keyword a detachment grants to units matching a keyword filter. Blanket by default (every matching unit gains it); when `max_selected` is set, the keyword is instead granted to up to that many matching units of the player's choice (e.g. Houndpack Lance: 'select three WAR DOG units; they gain CHARACTER').

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "granted-keyword".

## Properties

### keyword

> **keyword**: `string`

Defined in: [generated.ts:2581](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2581)

***

### to\_keywords

> **to\_keywords**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:2582](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2582)

***

### max\_selected?

> `optional` **max\_selected?**: `number`

Defined in: [generated.ts:2586](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2586)

When present, the grant is not blanket: the player selects up to this many matching units to receive `keyword` (e.g. 3 WAR DOG units gain CHARACTER under Houndpack Lance). Absent = every matching unit gains it.
