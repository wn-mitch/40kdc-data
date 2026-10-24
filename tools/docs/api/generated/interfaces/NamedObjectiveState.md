[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedObjectiveState

# Interface: NamedObjectiveState

Defined in: [generated.ts:7238](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7238)

A named state carried by a specific objective marker: the state resolves when its ability-level trigger fires, and may clear itself. Distinct from `objective-tag`, which only marks the objective without carrying a resolution.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-objective-state".

## Properties

### state\_label

> **state\_label**: `string`

Defined in: [generated.ts:7239](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7239)

***

### resolution

> **resolution**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:7240](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7240)

***

### clears?

> `optional` **clears?**: `"phase"` \| `"turn"` \| `"permanent"` \| `"after-resolving"`

Defined in: [generated.ts:7244](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L7244)

When the named state is removed from the objective.
