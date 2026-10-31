[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EndsNearest

# Interface: EndsNearest

Defined in: [generated.ts:2831](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2831)

Where a move must end: as close as possible to the closest unit matching `of`, or to the closest objective matching `of.objective` (`{objective: {}}` is any objective marker; `{objective: {selection_var}}` is the objective a select-objective bound). per: model applies the end to each model of the unit. instead_of: closest-enemy-unit names the enemy unit the move need not end closer to. optional (only with instead_of): the unit can choose this end instead, so either end is legal ("can end that move as close as possible to the closest objective marker instead of the closest enemy unit"). waives: closest-enemy-model lets the unit end without being closer to the closest enemy model when it does end as close as possible to `of` (either end is legal); it is a unit-only form.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ends-nearest".

## Properties

### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \}

Defined in: [generated.ts:2832](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2832)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"`

Defined in: [generated.ts:2837](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2837)

***

### instead\_of?

> `optional` **instead\_of?**: `"closest-enemy-unit"`

Defined in: [generated.ts:2838](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2838)

***

### optional?

> `optional` **optional?**: `true`

Defined in: [generated.ts:2839](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2839)

***

### waives?

> `optional` **waives?**: `"closest-enemy-model"`

Defined in: [generated.ts:2840](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L2840)
