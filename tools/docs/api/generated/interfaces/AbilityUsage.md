[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityUsage

# Interface: AbilityUsage

Defined in: [generated.ts:3365](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3365)

How often the ability may be used, beyond what scope.duration captures. `scope.duration: one-use` already models 'once per battle'; this models finer limits (once per turn/phase, N per battle) and an optional per-army/unit/model granularity.

## Properties

### frequency

> **frequency**: `"once-per-turn"` \| `"once-per-phase"` \| `"once-per-battle-round"` \| `"once-per-command-phase"` \| `"once-per-opponent-turn"` \| `"n-per-battle"` \| `"first-this-battle"` \| `"first-time-this-phase"`

Defined in: [generated.ts:3366](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3366)

***

### count?

> `optional` **count?**: `number`

Defined in: [generated.ts:3375](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3375)

***

### per?

> `optional` **per?**: `"unit"` \| `"model"` \| `"army"`

Defined in: [generated.ts:3376](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L3376)
