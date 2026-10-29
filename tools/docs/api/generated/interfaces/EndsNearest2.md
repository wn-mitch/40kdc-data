[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EndsNearest2

# Interface: EndsNearest2

Defined in: [generated.ts:5453](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5453)

Where each move in applies_to_moves must end: as close as possible to the closest unit matching `of`. Does not change the move's distance.

## Properties

### of

> **of**: [`UnitRef`](../type-aliases/UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](ObjectiveFilter.md); \}

Defined in: [generated.ts:5454](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5454)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"`

Defined in: [generated.ts:5459](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5459)

***

### instead\_of?

> `optional` **instead\_of?**: `"closest-enemy-unit"`

Defined in: [generated.ts:5460](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5460)

***

### optional?

> `optional` **optional?**: `true`

Defined in: [generated.ts:5461](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5461)

***

### waives?

> `optional` **waives?**: `"closest-enemy-model"`

Defined in: [generated.ts:5462](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5462)
