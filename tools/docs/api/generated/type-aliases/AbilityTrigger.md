[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityTrigger

# Type Alias: AbilityTrigger

> **AbilityTrigger** = [`Trigger`](../interfaces/Trigger.md) \| \[[`Trigger`](../interfaces/Trigger.md), `...Trigger[]`\]

Defined in: [generated.ts:914](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L914)

For reactive abilities: the game event(s) this ability fires on, plus structured guards. One trigger object, OR an array of trigger objects — the ability fires on ANY listed trigger (models multi-event reactions like 'set up OR ends a move'). See `$defs/trigger`.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "ability-trigger".
