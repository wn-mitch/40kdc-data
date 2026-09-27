[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GameEvent

# Type Alias: GameEvent

> **GameEvent** = `"battle-started"` \| `"battle-formations-declared"` \| `"deployment-ended"` \| `"round-started"` \| `"round-ended"` \| `"turn-started"` \| `"turn-ended"` \| `"phase-started"` \| `"phase-ended"` \| `"step-started"` \| `"selected"` \| `"targets-selected"` \| `"move-ended"` \| `"set-up"` \| `"disembarked"` \| `"before-roll"` \| `"after-roll"` \| `"damage-allocated"` \| `"attacks-resolved"` \| `"destroyed"` \| `"model-destroyed"` \| `"used"` \| `"state-changed"` \| `"designation-changed"` \| `"designation-resolved"` \| `"marker-removed"` \| `"objective-gained"` \| `"resource-gained"` \| `"resource-spent"`

Defined in: [generated.ts:89](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L89)

The event families a trigger fires on and a `happened` condition looks back at. Each family takes typed parameters in the trigger's `filter` (which move, which roll, which Stratagem) and names who acted (`subject`) and what it was aimed at (`object`), so an event name never packs a subject or object.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "game-event".
