[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ReactiveTrigger

# Type Alias: ReactiveTrigger

> **ReactiveTrigger** = `object`

Defined in: [data/dataset.ts:97](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L97)

One reactive ability resolved for event dispatch: the ability's id, the
[GameEvent](../../generated/type-aliases/GameEvent.md) it fires on, the units that carry it (sorted; empty for
faction/detachment rules), and the full (non-null) `trigger` block.

## See

 - [Dataset.reactiveTriggers](../classes/Dataset.md#reactivetriggers)
 - [Dataset.triggerIndex](../classes/Dataset.md#triggerindex)

## Properties

### abilityId

> **abilityId**: `string`

Defined in: [data/dataset.ts:98](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L98)

***

### event

> **event**: [`GameEvent`](../../generated/type-aliases/GameEvent.md)

Defined in: [data/dataset.ts:99](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L99)

***

### unitIds

> **unitIds**: `string`[]

Defined in: [data/dataset.ts:100](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L100)

***

### trigger

> **trigger**: `NonNullable`\<[`RawData`](../interfaces/RawData.md)\[`"abilities"`\]\[`number`\]\[`"trigger"`\]\>

Defined in: [data/dataset.ts:101](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/dataset.ts#L101)
