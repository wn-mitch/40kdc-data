[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / AffordabilitySpec

# Interface: AffordabilitySpec

Defined in: [data/affordability.ts:35](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/affordability.ts#L35)

Compact input shared by [candidateAffordability](../functions/candidateAffordability.md) and the runner op.

## Properties

### factionId

> **factionId**: `string` \| `null`

Defined in: [data/affordability.ts:36](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/affordability.ts#L36)

***

### battleSize

> **battleSize**: `BattleSize` \| `null`

Defined in: [data/affordability.ts:37](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/affordability.ts#L37)

***

### pointsLimitOverride?

> `optional` **pointsLimitOverride?**: `number` \| `null`

Defined in: [data/affordability.ts:39](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/affordability.ts#L39)

Explicit points limit; overrides the battle-size default when set.

***

### units

> **units**: [`AffordabilityUnit`](AffordabilityUnit.md)[]

Defined in: [data/affordability.ts:40](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/affordability.ts#L40)

***

### candidateUnitIds?

> `optional` **candidateUnitIds?**: `string`[] \| `null`

Defined in: [data/affordability.ts:42](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/affordability.ts#L42)

Units to price; defaults to every unit in `factionId` when omitted.
