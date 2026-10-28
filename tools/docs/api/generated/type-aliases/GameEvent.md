[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / GameEvent

# Type Alias: GameEvent

> **GameEvent** = `"army-selected"` \| `"battle-started"` \| `"battle-formations-declared"` \| `"deployment-ended"` \| `"round-started"` \| `"round-ended"` \| `"turn-started"` \| `"turn-ended"` \| `"phase-started"` \| `"phase-ended"` \| `"step-started"` \| `"selected"` \| `"targets-selected"` \| `"move-started"` \| `"move-ended"` \| `"set-up"` \| `"disembarked"` \| `"before-roll"` \| `"after-roll"` \| `"damage-allocated"` \| `"attacks-resolved"` \| `"destroyed"` \| `"model-destroyed"` \| `"used"` \| `"state-changed"` \| `"designation-changed"` \| `"designation-resolved"` \| `"marker-removed"` \| `"objective-gained"` \| `"resource-gained"` \| `"resource-spent"`

Defined in: [generated.ts:195](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L195)

The event families a trigger fires on and a `happened` condition looks back at. Each family takes typed parameters in the trigger's `filter` (which move, which roll, which Stratagem) and names who acted (`subject`) and what it was aimed at (`object`), so an event name never packs a subject or object. move-started fires as a unit starts a move (before it is made); move-ended as it finishes one.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "game-event".
