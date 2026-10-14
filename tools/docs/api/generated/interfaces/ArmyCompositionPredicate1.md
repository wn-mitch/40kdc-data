[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyCompositionPredicate1

# Interface: ArmyCompositionPredicate1

Defined in: [generated.ts:1771](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1771)

Draw-time army-composition predicate gating the operation (e.g. redraw when the opponent lacks a qualifying unit).

## Properties

### subject

> **subject**: `"self"` \| `"opponent"`

Defined in: [generated.ts:1775](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1775)

Whose army list the predicate inspects.

***

### quantifier

> **quantifier**: `"any"` \| `"none"`

Defined in: [generated.ts:1779](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1779)

Whether the army must contain ('any') or lack ('none') a unit matching unit_filter for the predicate to hold.

***

### unit\_filter

> **unit\_filter**: `object`

Defined in: [generated.ts:1783](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1783)

Criteria a unit in the army must satisfy to match. All present criteria must hold (logical AND).

#### model\_count\_min?

> `optional` **model\_count\_min?**: `number`

#### model\_count\_max?

> `optional` **model\_count\_max?**: `number`

#### wounds\_min?

> `optional` **wounds\_min?**: `number`

#### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)
