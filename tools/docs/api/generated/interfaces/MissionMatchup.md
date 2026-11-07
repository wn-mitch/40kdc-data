[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MissionMatchup

# Interface: MissionMatchup

Defined in: [generated.ts:3369](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3369)

One cell of the 11e Force Disposition matrix: given the player's own Force Disposition and their opponent's, the mission that player plays. Mirrors a single row on a physical Force Disposition card. The (disposition, opponent_disposition) pair is the conceptual key; compound uniqueness across entries is a data convention, not enforced by this schema.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission-matchup".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:3370](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3370)

***

### disposition

> **disposition**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:3374](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3374)

The player's own Force Disposition.

***

### opponent\_disposition

> **opponent\_disposition**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:3378](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3378)

The opponent's Force Disposition.

***

### mission\_id

> **mission\_id**: `string`

Defined in: [generated.ts:3382](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3382)

Kebab-case identifier

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:3383](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L3383)
