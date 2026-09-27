[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedPointsLimit

# Interface: AlliedPointsLimit

Defined in: [generated.ts:1106](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1106)

The combined points cap for units included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-points-limit".

## Properties

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:1110](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1110)

Battle size this cap applies at. Includes 'onslaught' (3000 pts), which ally rules reference even though the core roster battle-size enum lists only incursion/strike-force.

***

### max\_points

> **max\_points**: `number`

Defined in: [generated.ts:1114](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L1114)

Maximum combined points of units included via the rule at this battle size.
