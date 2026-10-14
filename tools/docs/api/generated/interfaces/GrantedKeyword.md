[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GrantedKeyword

# Interface: GrantedKeyword

Defined in: [generated.ts:1270](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1270)

A construction keyword a detachment grants to units matching a keyword filter. Blanket by default (every matching unit gains it); when `max_selected` is set, the keyword is instead granted to up to that many matching units of the player's choice (e.g. Houndpack Lance: 'select three WAR DOG units; they gain CHARACTER').

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "granted-keyword".

## Properties

### keyword

> **keyword**: `string`

Defined in: [generated.ts:1271](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1271)

***

### to\_keywords

> **to\_keywords**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:1272](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1272)

***

### max\_selected?

> `optional` **max\_selected?**: `number`

Defined in: [generated.ts:1276](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1276)

When present, the grant is not blanket: the player selects up to this many matching units to receive `keyword` (e.g. 3 WAR DOG units gain CHARACTER under Houndpack Lance). Absent = every matching unit gains it.
