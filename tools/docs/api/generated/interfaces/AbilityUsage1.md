[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityUsage1

# Interface: AbilityUsage1

Defined in: [generated.ts:3384](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3384)

How often the ability may be used, beyond what scope.duration captures. `scope.duration: one-use` already models 'once per battle'; this models finer limits (once per turn/phase, N per battle) and an optional per-army/unit/model granularity.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-usage".

## Properties

### frequency

> **frequency**: `"once-per-turn"` \| `"once-per-phase"` \| `"once-per-battle-round"` \| `"once-per-command-phase"` \| `"once-per-opponent-turn"` \| `"n-per-battle"` \| `"first-this-battle"` \| `"first-time-this-phase"`

Defined in: [generated.ts:3385](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3385)

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:3394](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3394)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"` \| `"army"`

Defined in: [generated.ts:3395](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3395)
