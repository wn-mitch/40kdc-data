[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EndsNearest

# Interface: EndsNearest

Defined in: [generated.ts:2710](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2710)

Where a move must end: as close as possible to the closest unit matching `of`, or to the closest objective matching `of.objective` (`{objective: {}}` is any objective marker; `{objective: {selection_var}}` is the objective a select-objective bound). per: model applies the end to each model of the unit. instead_of: closest-enemy-unit names the enemy unit the move need not end closer to. optional (only with instead_of): the unit can choose this end instead, so either end is legal ("can end that move as close as possible to the closest objective marker instead of the closest enemy unit"). waives: closest-enemy-model lets the unit end without being closer to the closest enemy model when it does end as close as possible to `of` (either end is legal); it is a unit-only form.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ends-nearest".

## Properties

### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \}

Defined in: [generated.ts:2711](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2711)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"`

Defined in: [generated.ts:2716](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2716)

***

### instead\_of?

> `optional` **instead\_of?**: `"closest-enemy-unit"`

Defined in: [generated.ts:2717](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2717)

***

### optional?

> `optional` **optional?**: `true`

Defined in: [generated.ts:2718](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2718)

***

### waives?

> `optional` **waives?**: `"closest-enemy-model"`

Defined in: [generated.ts:2719](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2719)
