[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceActionMenuEffect

# Interface: ResourceActionMenuEffect

Defined in: [generated.ts:4485](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4485)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "resource-action-menu-effect".

## Properties

### type

> **type**: `"resource-action-menu"`

Defined in: [generated.ts:4486](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4486)

***

### menu\_id

> **menu\_id**: `string`

Defined in: [generated.ts:4487](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4487)

***

### pool\_id

> **pool\_id**: `string`

Defined in: [generated.ts:4488](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4488)

***

### shared\_usage?

> `optional` **shared\_usage?**: `object`

Defined in: [generated.ts:4489](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4489)

#### unit\_max\_manoeuvres\_per\_phase?

> `optional` **unit\_max\_manoeuvres\_per\_phase?**: `number`

#### default\_manoeuvre\_max\_per\_phase?

> `optional` **default\_manoeuvre\_max\_per\_phase?**: `number`

***

### capacity?

> `optional` **capacity?**: `object`

Defined in: [generated.ts:4493](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4493)

#### amount

> **amount**: `number`

#### resource\_label

> **resource\_label**: `string`

#### ability\_noun

> **ability\_noun**: `string`

#### refresh

> **refresh**: `"battle-round"` \| `"phase"` \| `"turn"` \| `"battle"`

***

### actions

> **actions**: \[\{ `id`: `string`; `label`: `string`; `when`: [`ResourceActionMenuTrigger`](ResourceActionMenuTrigger.md) \| \[[`ResourceActionMenuTrigger`](ResourceActionMenuTrigger.md), `...ResourceActionMenuTrigger[]`\]; `cost`: \{ `pool_id`: `string`; `amount`: `number`; `resource_label?`: `string`; \}; `eligibility?`: \{ `filter?`: [`UnitFilter`](UnitFilter.md); `count?`: [`CountBounds`](CountBounds.md); `requires?`: \[[`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md), `...AbilityDSLCondition1[]`\]; \}; `usage?`: \{ `repeatable_if_different_unit?`: `boolean`; \}; `duration?`: `"battle-round"` \| `"phase"` \| `"turn"` \| `"battle"` \| `"until-next-command-phase"` \| `"until-next-movement-phase"` \| `"until-next-battle-round"` \| `"until-start-next-turn"` \| `"one-use"` \| `"permanent"` \| `"attack-sequence"` \| `"resolution"` \| `"while-leading"` \| `"after-resolving"` \| `"until-next-shooting-phase"` \| `"until-end-of-your-next-turn"` \| `"until-end-of-opponent-next-turn"` \| `"until-end-of-next-turn"` \| `"until-this-unit-has-shot"` \| `"control-lost"` \| `"until-end-of-your-next-fight-phase"` \| `"until-end-of-your-next-shooting-phase"` \| `"until-end-of-your-next-movement-phase"` \| `"until-end-of-opponent-next-movement-phase"` \| `"until-start-of-opponent-next-command-phase"`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, ...\{ id: string; label: string; when: ResourceActionMenuTrigger \| \[ResourceActionMenuTrigger, ...ResourceActionMenuTrigger\[\]\]; cost: \{ pool\_id: string; amount: number; resource\_label?: string \}; eligibility?: \{ filter?: UnitFilter; count?: CountBounds; requires?: \[AbilityDSLCondition1, ...AbilityDSLCondition1\[\]\] \}; usage?: \{ repeatable\_if\_different\_unit?: boolean \}; duration?: "battle-round" \| "phase" \| "turn" \| "battle" \| "until-next-command-phase" \| "until-next-movement-phase" \| "until-next-battle-round" \| "until-start-next-turn" \| "one-use" \| "permanent" \| "attack-sequence" \| "resolution" \| "while-leading" \| "after-resolving" \| "until-next-shooting-phase" \| "until-end-of-your-next-turn" \| "until-end-of-opponent-next-turn" \| "until-end-of-next-turn" \| "until-this-unit-has-shot" \| "control-lost" \| "until-end-of-your-next-fight-phase" \| "until-end-of-your-next-shooting-phase" \| "until-end-of-your-next-movement-phase" \| "until-end-of-opponent-next-movement-phase" \| "until-start-of-opponent-next-command-phase"; effect: EffectNode \}\[\]\]

Defined in: [generated.ts:4502](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L4502)

#### Min Items

1
