[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WithinCondition

# Interface: WithinCondition

Defined in: [generated.ts:2005](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2005)

[position] The subject is within `range` of `of`. models: every means every model of the subject; wholly means wholly within. `at` reads the position at an earlier point.

## Properties

### type

> **type**: `"within"`

Defined in: [generated.ts:2006](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2006)

***

### parameters

> **parameters**: `object`

Defined in: [generated.ts:2007](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2007)

#### subject?

> `optional` **subject?**: [`UnitRef`](../type-aliases/UnitRef.md)

#### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \} \| \{ `marker`: `string`; \} \| `"battlefield-edge"`

#### range?

> `optional` **range?**: [`RangeRef`](../type-aliases/RangeRef.md)

#### wholly?

> `optional` **wholly?**: `true`

#### models?

> `optional` **models?**: `"any"` \| `"every"`

#### at?

> `optional` **at?**: `"now"` \| `"phase-start"`

#### count\_min?

> `optional` **count\_min?**: `number`
