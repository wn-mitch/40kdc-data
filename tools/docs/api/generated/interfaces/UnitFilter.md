[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitFilter

# Interface: UnitFilter

Defined in: [generated.ts:930](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L930)

Any unit (or model, with level: model) matching every listed property. Reads as 'a unit that…'.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-filter".

## Properties

### owner?

> `optional` **owner?**: [`Owner`](../type-aliases/Owner.md)

Defined in: [generated.ts:931](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L931)

***

### all\_of?

> `optional` **all\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:932](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L932)

***

### any\_of?

> `optional` **any\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:933](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L933)

***

### none\_of?

> `optional` **none\_of?**: [`KeywordList`](../type-aliases/KeywordList.md)

Defined in: [generated.ts:934](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L934)

***

### designated?

> `optional` **designated?**: `string`

Defined in: [generated.ts:938](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L938)

The unit carries this designation (a tag an effect applied).

***

### state?

> `optional` **state?**: [`UnitState`](../type-aliases/UnitState.md)

Defined in: [generated.ts:939](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L939)

***

### level?

> `optional` **level?**: `"unit"` \| `"model"`

Defined in: [generated.ts:943](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L943)

model: the filter matches individual models. Default unit.

***

### visible?

> `optional` **visible?**: `true`

Defined in: [generated.ts:947](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L947)

Only units visible to the subject of the enclosing predicate.
