[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / RegionRef

# Type Alias: RegionRef

> **RegionRef** = \{ `territory`: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"` \| `"your-deployment-zone"` \| `"enemy-deployment-zone"` \| `"attacker-territory"`; \} \| \{ `terrain_area`: \{ `designated?`: [`DesignationId`](DesignationId.md); `footprint?`: `string`; \}; \} \| \{ `rule_region`: \{ `region_id`: [`EntityId`](EntityId.md); `owner_faction?`: [`EntityId`](EntityId.md); \}; \}

Defined in: [generated.ts:394](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L394)

A region of the battlefield.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "region-ref".
