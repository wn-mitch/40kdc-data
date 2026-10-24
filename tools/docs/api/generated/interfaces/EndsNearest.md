[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EndsNearest

# Interface: EndsNearest

Defined in: [generated.ts:2387](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2387)

Where a move must end: as close as possible to the closest unit matching `of`, or to the closest objective matching `of.objective` (`{objective: {}}` is any objective marker; `{objective: {selection_var}}` is the objective a select-objective bound). per: model applies the end to each model of the unit. instead_of: closest-enemy-unit names the enemy unit the move need not end closer to. waives: closest-enemy-model lets the unit end without being closer to the closest enemy model when it does end as close as possible to `of` (either end is legal); it is a unit-only form.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ends-nearest".

## Properties

### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \}

Defined in: [generated.ts:2388](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2388)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"`

Defined in: [generated.ts:2393](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2393)

***

### instead\_of?

> `optional` **instead\_of?**: `"closest-enemy-unit"`

Defined in: [generated.ts:2394](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2394)

***

### waives?

> `optional` **waives?**: `"closest-enemy-model"`

Defined in: [generated.ts:2395](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2395)
