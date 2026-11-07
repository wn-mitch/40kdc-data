[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / ReactiveTrigger

# Type Alias: ReactiveTrigger

> **ReactiveTrigger** = `object`

Defined in: [data/dataset-triggers.ts:19](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-triggers.ts#L19)

One reactive ability resolved for event dispatch: the ability's id, the
[GameEvent](../../generated/type-aliases/GameEvent.md) it fires on, the units that carry it (sorted; empty for
faction/detachment rules), and the full (non-null) `trigger` block.

## See

 - [Dataset.reactiveTriggers](../classes/Dataset.md#reactivetriggers)
 - [Dataset.triggerIndex](../classes/Dataset.md#triggerindex)

## Properties

### abilityId

> **abilityId**: `string`

Defined in: [data/dataset-triggers.ts:20](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-triggers.ts#L20)

***

### event

> **event**: [`GameEvent`](../../generated/type-aliases/GameEvent.md)

Defined in: [data/dataset-triggers.ts:21](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-triggers.ts#L21)

***

### unitIds

> **unitIds**: `string`[]

Defined in: [data/dataset-triggers.ts:22](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-triggers.ts#L22)

***

### trigger

> **trigger**: `NonNullable`\<[`RawData`](../interfaces/RawData.md)\[`"abilities"`\]\[`number`\]\[`"trigger"`\]\>

Defined in: [data/dataset-triggers.ts:23](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/dataset-triggers.ts#L23)
