[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ScopeDuration

# Type Alias: ScopeDuration

> **ScopeDuration** = `"phase"` \| `"turn"` \| `"battle-round"` \| `"battle"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"`

Defined in: [generated.ts:772](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L772)

attack-sequence expires when the currently selected unit finishes resolving its shooting or fighting attacks; resolution lasts only while resolving this activation and is not a battle/phase usage limit.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scope-duration".
