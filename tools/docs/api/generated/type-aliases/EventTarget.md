[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / EventTarget

# Type Alias: EventTarget

> **EventTarget** = [`UnitRef`](UnitRef.md) \| \{ `objective`: [`ObjectiveFilter`](../interfaces/ObjectiveFilter.md); \} \| \{ `terrain_area`: \{ `territory?`: `"your-territory"` \| `"enemy-territory"` \| `"no-mans-land"`; \}; \}

Defined in: [generated.ts:497](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L497)

What the event was aimed at: a unit, or (for actions) an objective or terrain area.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "event-target".
