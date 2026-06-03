[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyCompositionPredicate1

# Interface: ArmyCompositionPredicate1

Defined in: [generated.ts:649](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L649)

Draw-time army-composition predicate gating the operation (e.g. redraw when the opponent lacks a qualifying unit).

## Properties

### subject

> **subject**: `"self"` \| `"opponent"`

Defined in: [generated.ts:653](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L653)

Whose army list the predicate inspects.

***

### quantifier

> **quantifier**: `"any"` \| `"none"`

Defined in: [generated.ts:657](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L657)

Whether the army must contain ('any') or lack ('none') a unit matching unit_filter for the predicate to hold.

***

### unit\_filter

> **unit\_filter**: `object`

Defined in: [generated.ts:661](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L661)

Criteria a unit in the army must satisfy to match. All present criteria must hold (logical AND).

#### model\_count\_min?

> `optional` **model\_count\_min?**: `number`

#### model\_count\_max?

> `optional` **model\_count\_max?**: `number`

#### wounds\_min?

> `optional` **wounds\_min?**: `number`

#### keywords?

> `optional` **keywords?**: [`KeywordList`](../type-aliases/KeywordList.md)
