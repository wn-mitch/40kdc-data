[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / StageLift

# Type Alias: StageLift

> **StageLift** = `object`

Defined in: [cruncher/attribution.ts:26](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L26)

One toggleable buff group's marginal effect on a single stage.

## Properties

### source

> **source**: [`BuffSource`](BuffSource.md)

Defined in: [cruncher/attribution.ts:28](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L28)

Representative source of the group (all its `Buff`s share a group key).

***

### delta

> **delta**: `number`

Defined in: [cruncher/attribution.ts:30](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/cruncher/attribution.ts#L30)

`stageValue(all buffs) − stageValue(all buffs minus this group)`.
