[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityUsageLimit

# Interface: AbilityUsageLimit

Defined in: [generated.ts:4692](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4692)

One usage limit: once per turn/phase/battle round, N per battle, with an optional per-army/unit/model granularity. Once per battle is frequency n-per-battle, count 1 (scope.duration one-use is retired).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-usage-limit".

## Properties

### frequency

> **frequency**: `"n-per-battle"` \| `"once-per-turn"` \| `"once-per-phase"` \| `"once-per-battle-round"` \| `"once-per-command-phase"` \| `"once-per-opponent-turn"` \| `"first-this-battle"` \| `"first-time-this-phase"`

Defined in: [generated.ts:4693](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4693)

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:4702](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4702)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"` \| `"army"`

Defined in: [generated.ts:4703](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4703)
