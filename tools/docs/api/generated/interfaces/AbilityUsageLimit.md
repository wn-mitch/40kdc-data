[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityUsageLimit

# Interface: AbilityUsageLimit

Defined in: [generated.ts:4157](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4157)

One usage limit: once per turn/phase/battle round, N per battle, with an optional per-army/unit/model granularity. Once per battle is frequency n-per-battle, count 1 (scope.duration one-use is retired).

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-usage-limit".

## Properties

### frequency

> **frequency**: `"n-per-battle"` \| `"once-per-turn"` \| `"once-per-phase"` \| `"once-per-battle-round"` \| `"once-per-command-phase"` \| `"once-per-opponent-turn"` \| `"first-this-battle"` \| `"first-time-this-phase"`

Defined in: [generated.ts:4158](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4158)

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:4167](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4167)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"` \| `"army"`

Defined in: [generated.ts:4168](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4168)
