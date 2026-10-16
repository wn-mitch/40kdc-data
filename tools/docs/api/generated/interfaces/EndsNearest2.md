[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EndsNearest2

# Interface: EndsNearest2

Defined in: [generated.ts:4829](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4829)

Where each move in applies_to_moves must end: as close as possible to the closest unit matching `of`. Does not change the move's distance.

## Properties

### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \}

Defined in: [generated.ts:4830](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4830)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"`

Defined in: [generated.ts:4835](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4835)

***

### instead\_of?

> `optional` **instead\_of?**: `"closest-enemy-unit"`

Defined in: [generated.ts:4836](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4836)

***

### waives?

> `optional` **waives?**: `"closest-enemy-model"`

Defined in: [generated.ts:4837](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4837)
