[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RegionRef

# Type Alias: RegionRef

> **RegionRef** = \{ `territory`: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"` \| `"attacker-territory"`; \} \| \{ `terrain_area`: \{ `designated?`: `string`; `footprint?`: `string`; \}; \} \| \{ `rule_region`: \{ `region_id`: [`EntityId`](EntityId.md); `owner_faction?`: [`EntityId`](EntityId.md); \}; \}

Defined in: [generated.ts:261](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L261)

A region of the battlefield.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "region-ref".
