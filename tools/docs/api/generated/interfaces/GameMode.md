[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GameMode

# Interface: GameMode

Defined in: [generated.ts:3257](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3257)

A 40k game mode — one axis of army-construction scope, parallel to the game_version edition axis. Army-construction entities carry an optional `game_modes` array of these ids; an absent array means the entity belongs to matched-play only. `is_competitive` marks which modes count toward the dataset's headline competitive-coverage metric.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "game-mode".

## Properties

### id

> **id**: `"matched-play"` \| `"combat-patrol"` \| `"boarding-actions"` \| `"crusade"`

Defined in: [generated.ts:3261](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3261)

The game mode an army-construction entity is legal or authored for, parallel to the game_version edition axis. 'matched-play' is the competitive default: when an entity omits `game_modes`, treat it as matched-play only. 'combat-patrol', 'boarding-actions', and 'crusade' are non-competitive modes; of these only combat-patrol currently has an ingest source and coverage measurement (the others are schema-homed for hand-authoring).

***

### name

> **name**: `string`

Defined in: [generated.ts:3262](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3262)

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:3266](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3266)

Community-authored summary of the mode (original prose only — no reproduced rules text).

***

### is\_competitive

> **is\_competitive**: `boolean`

Defined in: [generated.ts:3270](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3270)

Whether this mode counts toward the dataset's headline competitive-coverage metric. Only matched-play is competitive; non-competitive modes are tracked on their own coverage dimension.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3271](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3271)
