[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableGroupRef

# Type Alias: ActivatableGroupRef

> **ActivatableGroupRef** = `object`

Defined in: [cruncher/from-dsl.ts:67](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/from-dsl.ts#L67)

A mutually-limited pool of [ActivatableBuff](ActivatableBuff.md) levers. Dice-pool
allocations cap how many options fire at once (`max_activations`); a `choice`
lets the player pick exactly one. Levers sharing a `group.id` are subject to
that cap — the SPA greys out further checkboxes once it's reached, and an
optimizer enumerates subsets within it.

## Properties

### id

> **id**: `string`

Defined in: [cruncher/from-dsl.ts:68](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/from-dsl.ts#L68)

***

### maxActivations

> **maxActivations**: `number`

Defined in: [cruncher/from-dsl.ts:69](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/cruncher/from-dsl.ts#L69)
