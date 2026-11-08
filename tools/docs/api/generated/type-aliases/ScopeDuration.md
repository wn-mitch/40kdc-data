[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ScopeDuration

# Type Alias: ScopeDuration

> **ScopeDuration** = `"phase"` \| `"turn"` \| `"battle-round"` \| `"battle"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"` \| `"while-leading"` \| `"after-resolving"` \| `"until-next-shooting-phase"` \| `"until-end-of-your-next-turn"` \| `"until-end-of-opponent-next-turn"` \| `"until-end-of-next-turn"` \| `"until-this-unit-has-shot"` \| `"control-lost"` \| `"until-end-of-your-next-fight-phase"` \| `"until-end-of-your-next-shooting-phase"` \| `"until-end-of-your-next-movement-phase"` \| `"until-end-of-opponent-next-movement-phase"` \| `"until-start-of-opponent-next-command-phase"`

Defined in: [generated.ts:782](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L782)

How long an effect, a part or a designation lasts; resolution lasts only while resolving this activation; while-leading ends when the bearer stops leading; after-resolving ends after this activation resolves. The remaining values are phase, turn, battle-round, battle, explicit phase edges, attack-sequence, permanent, and domain-specific expiry windows.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "scope-duration".
