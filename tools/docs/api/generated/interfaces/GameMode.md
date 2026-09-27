[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GameMode

# Interface: GameMode

Defined in: [generated.ts:1444](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1444)

A 40k game mode — one axis of army-construction scope, parallel to the game_version edition axis. Army-construction entities carry an optional `game_modes` array of these ids; an absent array means the entity belongs to matched-play only. `is_competitive` marks which modes count toward the dataset's headline competitive-coverage metric.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "game-mode".

## Properties

### id

> **id**: `"matched-play"` \| `"combat-patrol"` \| `"boarding-actions"` \| `"crusade"`

Defined in: [generated.ts:1448](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1448)

The game mode an army-construction entity is legal or authored for, parallel to the game_version edition axis. 'matched-play' is the competitive default: when an entity omits `game_modes`, treat it as matched-play only. 'combat-patrol', 'boarding-actions', and 'crusade' are non-competitive modes; of these only combat-patrol currently has an ingest source and coverage measurement (the others are schema-homed for hand-authoring).

***

### name

> **name**: `string`

Defined in: [generated.ts:1449](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1449)

***

### description?

> `optional` **description?**: `string`

Defined in: [generated.ts:1453](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1453)

Community-authored summary of the mode (original prose only — no reproduced rules text).

***

### is\_competitive

> **is\_competitive**: `boolean`

Defined in: [generated.ts:1457](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1457)

Whether this mode counts toward the dataset's headline competitive-coverage metric. Only matched-play is competitive; non-competitive modes are tracked on their own coverage dimension.

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1458](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1458)
