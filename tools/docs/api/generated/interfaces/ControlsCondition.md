[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ControlsCondition

# Interface: ControlsCondition

Defined in: [generated.ts:2052](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2052)

[board] A player (default you) controls objectives matching the filter: at least count_min (default 1), at most count_max. compare: more-than-opponent means more objectives than the opponent.

## Properties

### type

> **type**: `"controls"`

Defined in: [generated.ts:2053](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2053)

***

### parameters?

> `optional` **parameters?**: `object`

Defined in: [generated.ts:2054](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2054)

#### by?

> `optional` **by?**: `"friendly"` \| `"enemy"`

#### objective?

> `optional` **objective?**: [`ObjectiveFilter`](ObjectiveFilter.md)

#### count\_min?

> `optional` **count\_min?**: `number`

#### count\_max?

> `optional` **count\_max?**: `number`

#### compare?

> `optional` **compare?**: `"more-than-opponent"`
