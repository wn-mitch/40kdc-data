[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MissionMatchup

# Interface: MissionMatchup

Defined in: [generated.ts:439](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L439)

One cell of the 11e Force Disposition matrix: given the player's own Force Disposition and their opponent's, the mission that player plays. Mirrors a single row on a physical Force Disposition card. The (disposition, opponent_disposition) pair is the conceptual key; compound uniqueness across entries is a data convention, not enforced by this schema.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission-matchup".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:440](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L440)

***

### disposition

> **disposition**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:444](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L444)

The player's own Force Disposition.

***

### opponent\_disposition

> **opponent\_disposition**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:448](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L448)

The opponent's Force Disposition.

***

### mission\_id

> **mission\_id**: `string`

Defined in: [generated.ts:452](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L452)

Kebab-case identifier

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:453](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L453)
