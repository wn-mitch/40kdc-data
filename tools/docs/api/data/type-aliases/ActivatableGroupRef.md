[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ActivatableGroupRef

# Type Alias: ActivatableGroupRef

> **ActivatableGroupRef** = `object`

Defined in: [cruncher/from-dsl.ts:85](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L85)

A mutually-limited pool of [ActivatableBuff](ActivatableBuff.md) levers. Dice-pool
allocations cap how many options fire at once (`max_activations`); a `choice`
lets the player pick exactly one. Levers sharing a `group.id` are subject to
that cap — the SPA greys out further checkboxes once it's reached, and an
optimizer enumerates subsets within it.

## Properties

### id

> **id**: `string`

Defined in: [cruncher/from-dsl.ts:86](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L86)

***

### maxActivations

> **maxActivations**: `number`

Defined in: [cruncher/from-dsl.ts:87](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/from-dsl.ts#L87)
