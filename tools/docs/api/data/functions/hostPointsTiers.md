[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / hostPointsTiers

# Function: hostPointsTiers()

> **hostPointsTiers**(`unit`, `hostFaction?`): readonly `CostTier`[]

Defined in: [data/pricing.ts:91](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/pricing.ts#L91)

The points tiers in effect for a unit fielded in `hostFaction`'s army.

A unit native to the host army (its `faction_id` IS the army's faction)
always prices from `points` — `allied_points` only ever applies to a unit
included in ANOTHER faction's army. For a foreign unit, an entry whose
`host_faction` names the army's faction id exactly wins (a chapter reprice:
an `adeptus-astartes` datasheet priced for `blood-angels`); otherwise an
entry naming a super-faction keyword the army's faction carries applies (an
Agents unit's `imperium` price in any Imperium army). With no matching
entry — or no army context at all — the native table stands, matching
consumers that ignore allied pricing.

## Parameters

### unit

[`Unit`](../../generated/interfaces/Unit.md)

### hostFaction?

[`Faction`](../../generated/interfaces/Faction.md) \| `null`

## Returns

readonly `CostTier`[]
