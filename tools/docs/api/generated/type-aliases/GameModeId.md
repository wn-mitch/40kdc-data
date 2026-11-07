[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GameModeId

# Type Alias: GameModeId

> **GameModeId** = `"matched-play"` \| `"combat-patrol"` \| `"boarding-actions"` \| `"crusade"`

Defined in: [generated.ts:255](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L255)

The game mode an army-construction entity is legal or authored for, parallel to the game_version edition axis. 'matched-play' is the competitive default: when an entity omits `game_modes`, treat it as matched-play only. 'combat-patrol', 'boarding-actions', and 'crusade' are non-competitive modes; of these only combat-patrol currently has an ingest source and coverage measurement (the others are schema-homed for hand-authoring).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "game-mode-id".
