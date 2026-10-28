[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedPointsLimit

# Interface: AlliedPointsLimit

Defined in: [generated.ts:2736](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2736)

The combined points cap for units included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-points-limit".

## Properties

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:2740](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2740)

Battle size this cap applies at. Includes 'onslaught' (3000 pts), which ally rules reference even though the core roster battle-size enum lists only incursion/strike-force.

***

### max\_points

> **max\_points**: `number`

Defined in: [generated.ts:2744](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L2744)

Maximum combined points of units included via the rule at this battle size.
