[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AlliedPointsLimit

# Interface: AlliedPointsLimit

Defined in: [generated.ts:2412](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2412)

The combined points cap for units included via an allied rule at one battle size.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "allied-points-limit".

## Properties

### battle\_size

> **battle\_size**: `"incursion"` \| `"strike-force"` \| `"onslaught"`

Defined in: [generated.ts:2416](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2416)

Battle size this cap applies at. Includes 'onslaught' (3000 pts), which ally rules reference even though the core roster battle-size enum lists only incursion/strike-force.

***

### max\_points

> **max\_points**: `number`

Defined in: [generated.ts:2420](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L2420)

Maximum combined points of units included via the rule at this battle size.
