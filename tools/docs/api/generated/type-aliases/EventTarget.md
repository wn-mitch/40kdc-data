[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EventTarget

# Type Alias: EventTarget

> **EventTarget** = [`UnitRef`](UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](../interfaces/ObjectiveFilter.md); \} \| \{ `terrain_area`: \{ `territory?`: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"`; \}; \}

Defined in: [generated.ts:412](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L412)

What the event was aimed at: a unit, or (for actions) an objective or terrain area.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "event-target".
