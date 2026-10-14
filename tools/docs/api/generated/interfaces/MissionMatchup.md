[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / MissionMatchup

# Interface: MissionMatchup

Defined in: [generated.ts:1522](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1522)

One cell of the 11e Force Disposition matrix: given the player's own Force Disposition and their opponent's, the mission that player plays. Mirrors a single row on a physical Force Disposition card. The (disposition, opponent_disposition) pair is the conceptual key; compound uniqueness across entries is a data convention, not enforced by this schema.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "mission-matchup".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1523](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1523)

***

### disposition

> **disposition**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:1527](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1527)

The player's own Force Disposition.

***

### opponent\_disposition

> **opponent\_disposition**: `"take-and-hold"` \| `"disruption"` \| `"purge-the-foe"` \| `"priority-assets"` \| `"reconnaissance"`

Defined in: [generated.ts:1531](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1531)

The opponent's Force Disposition.

***

### mission\_id

> **mission\_id**: `string`

Defined in: [generated.ts:1535](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1535)

Kebab-case identifier

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1536](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1536)
