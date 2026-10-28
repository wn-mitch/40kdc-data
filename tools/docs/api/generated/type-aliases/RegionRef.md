[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RegionRef

# Type Alias: RegionRef

> **RegionRef** = \{ `territory`: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"` \| `"attacker-territory"`; \} \| \{ `terrain_area`: \{ `designated?`: [`DesignationId`](DesignationId.md); `footprint?`: `string`; \}; \} \| \{ `rule_region`: \{ `region_id`: [`EntityId`](EntityId.md); `owner_faction?`: [`EntityId`](EntityId.md); \}; \}

Defined in: [generated.ts:394](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L394)

A region of the battlefield.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "region-ref".
