[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedObjectiveState

# Interface: NamedObjectiveState

Defined in: [generated.ts:4687](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4687)

A named state carried by a specific objective marker: the state resolves when its ability-level trigger fires, and may clear itself. Distinct from `objective-tag`, which only marks the objective without carrying a resolution.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-objective-state".

## Properties

### state\_label

> **state\_label**: `string`

Defined in: [generated.ts:4688](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4688)

***

### resolution

> **resolution**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:4689](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4689)

***

### clears?

> `optional` **clears?**: `"end-of-turn"` \| `"never"` \| `"after-resolving"`

Defined in: [generated.ts:4693](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L4693)

When the named state is removed from the objective.
