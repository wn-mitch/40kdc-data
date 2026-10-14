[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableGroupRef

# Type Alias: ActivatableGroupRef

> **ActivatableGroupRef** = `object`

Defined in: [cruncher/from-dsl.ts:53](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L53)

A mutually-limited pool of [ActivatableBuff](ActivatableBuff.md) levers. Dice-pool
allocations cap how many options fire at once (`max_activations`); a `choice`
lets the player pick exactly one. Levers sharing a `group.id` are subject to
that cap — the SPA greys out further checkboxes once it's reached, and an
optimizer enumerates subsets within it.

## Properties

### id

> **id**: `string`

Defined in: [cruncher/from-dsl.ts:54](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L54)

***

### maxActivations

> **maxActivations**: `number`

Defined in: [cruncher/from-dsl.ts:55](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/cruncher/from-dsl.ts#L55)
