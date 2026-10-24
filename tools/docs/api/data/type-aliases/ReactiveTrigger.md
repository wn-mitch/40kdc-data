[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ReactiveTrigger

# Type Alias: ReactiveTrigger

> **ReactiveTrigger** = `object`

Defined in: [data/dataset.ts:124](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L124)

One reactive ability resolved for event dispatch: the ability's id, the
[GameEvent](../../generated/type-aliases/GameEvent.md) it fires on, the units that carry it (sorted; empty for
faction/detachment rules), and the full (non-null) `trigger` block.

## See

 - [Dataset.reactiveTriggers](../classes/Dataset.md#reactivetriggers)
 - [Dataset.triggerIndex](../classes/Dataset.md#triggerindex)

## Properties

### abilityId

> **abilityId**: `string`

Defined in: [data/dataset.ts:125](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L125)

***

### event

> **event**: [`GameEvent`](../../generated/type-aliases/GameEvent.md)

Defined in: [data/dataset.ts:126](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L126)

***

### unitIds

> **unitIds**: `string`[]

Defined in: [data/dataset.ts:127](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L127)

***

### trigger

> **trigger**: `NonNullable`\<[`RawData`](../interfaces/RawData.md)\[`"abilities"`\]\[`number`\]\[`"trigger"`\]\>

Defined in: [data/dataset.ts:128](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/dataset.ts#L128)
