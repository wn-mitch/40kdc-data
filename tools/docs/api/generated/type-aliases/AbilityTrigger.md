[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityTrigger

# Type Alias: AbilityTrigger

> **AbilityTrigger** = [`Trigger`](../interfaces/Trigger.md) \| \[[`Trigger`](../interfaces/Trigger.md), `...Trigger[]`\]

Defined in: [generated.ts:765](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L765)

For reactive abilities: the game event(s) this ability fires on, plus structured guards. One trigger object, OR an array of trigger objects — the ability fires on ANY listed trigger (models multi-event reactions like 'set up OR ends a move'). See `$defs/trigger`.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-trigger".
