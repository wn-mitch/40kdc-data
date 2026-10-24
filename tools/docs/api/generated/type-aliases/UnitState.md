[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / UnitState

# Type Alias: UnitState

> **UnitState** = `"engaged"` \| `"battle-shocked"` \| `"embarked"` \| `"in-strategic-reserves"` \| `"in-cult-ambush"` \| `"on-battlefield"` \| `"hidden"` \| `"fights-first"` \| `"benefit-of-cover"`

Defined in: [generated.ts:306](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L306)

Core-rules states a unit is in. Each state's opposite is the state under `not` (unengaged is not engaged). in-strategic-reserves: in Strategic Reserves, which the rules also call Reserves. in-cult-ambush: in the Genestealer Cults' Cult Ambush, a type of Strategic Reserves, so a unit in Cult Ambush is also in-strategic-reserves.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "unit-state".
