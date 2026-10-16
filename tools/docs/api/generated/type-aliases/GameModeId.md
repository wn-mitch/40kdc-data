[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GameModeId

# Type Alias: GameModeId

> **GameModeId** = `"matched-play"` \| `"combat-patrol"` \| `"boarding-actions"` \| `"crusade"`

Defined in: [generated.ts:252](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L252)

The game mode an army-construction entity is legal or authored for, parallel to the game_version edition axis. 'matched-play' is the competitive default: when an entity omits `game_modes`, treat it as matched-play only. 'combat-patrol', 'boarding-actions', and 'crusade' are non-competitive modes; of these only combat-patrol currently has an ingest source and coverage measurement (the others are schema-homed for hand-authoring).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "game-mode-id".
