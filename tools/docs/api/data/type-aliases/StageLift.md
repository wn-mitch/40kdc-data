[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StageLift

# Type Alias: StageLift

> **StageLift** = `object`

Defined in: [cruncher/attribution.ts:26](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/attribution.ts#L26)

One toggleable buff group's marginal effect on a single stage.

## Properties

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [cruncher/attribution.ts:28](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/attribution.ts#L28)

Representative source of the group (all its `Buff`s share a group key).

***

### delta

> **delta**: `number`

Defined in: [cruncher/attribution.ts:30](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/cruncher/attribution.ts#L30)

`stageValue(all buffs) − stageValue(all buffs minus this group)`.
