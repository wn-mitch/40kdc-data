[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / NamedObjectiveState

# Interface: NamedObjectiveState

Defined in: [generated.ts:8474](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8474)

A named state carried by a specific objective marker: the state resolves when its ability-level trigger fires, and may clear itself. Distinct from `objective-tag`, which only marks the objective without carrying a resolution.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "named-objective-state".

## Properties

### state\_label

> **state\_label**: `string`

Defined in: [generated.ts:8475](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8475)

***

### resolution

> **resolution**: [`EffectNode`](../type-aliases/EffectNode.md)

Defined in: [generated.ts:8476](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8476)

***

### clears?

> `optional` **clears?**: `"battle-round"` \| `"phase"` \| `"turn"` \| `"battle"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"` \| `"while-leading"` \| `"after-resolving"` \| `"until-next-shooting-phase"` \| `"until-end-of-your-next-turn"` \| `"until-end-of-opponent-next-turn"` \| `"until-end-of-next-turn"` \| `"until-this-unit-has-shot"` \| `"control-lost"` \| `"until-end-of-your-next-fight-phase"` \| `"until-end-of-your-next-shooting-phase"` \| `"until-end-of-your-next-movement-phase"` \| `"until-end-of-opponent-next-movement-phase"` \| `"until-start-of-opponent-next-command-phase"`

Defined in: [generated.ts:8480](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8480)

How long an effect, a part or a designation lasts; resolution lasts only while resolving this activation; while-leading ends when the bearer stops leading; after-resolving ends after this activation resolves. The remaining values are phase, turn, battle-round, battle, explicit phase edges, attack-sequence, permanent, and domain-specific expiry windows.
