[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceActionMenuEffect

# Interface: ResourceActionMenuEffect

Defined in: [generated.ts:2932](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2932)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "resource-action-menu-effect".

## Properties

### type

> **type**: `"resource-action-menu"`

Defined in: [generated.ts:2933](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2933)

***

### menu\_id

> **menu\_id**: `string`

Defined in: [generated.ts:2934](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2934)

***

### pool\_id

> **pool\_id**: `string`

Defined in: [generated.ts:2935](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2935)

***

### shared\_usage?

> `optional` **shared\_usage?**: `object`

Defined in: [generated.ts:2936](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2936)

#### unit\_max\_manoeuvres\_per\_phase?

> `optional` **unit\_max\_manoeuvres\_per\_phase?**: `number`

#### default\_manoeuvre\_max\_per\_phase?

> `optional` **default\_manoeuvre\_max\_per\_phase?**: `number`

***

### capacity?

> `optional` **capacity?**: `object`

Defined in: [generated.ts:2940](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2940)

#### amount

> **amount**: `number`

#### resource\_label

> **resource\_label**: `string`

#### ability\_noun

> **ability\_noun**: `string`

#### refresh

> **refresh**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"`

***

### actions

> **actions**: \[\{ `id`: `string`; `label`: `string`; `when`: [`ResourceActionMenuTrigger`](ResourceActionMenuTrigger.md) \| \[[`ResourceActionMenuTrigger`](ResourceActionMenuTrigger.md), `...ResourceActionMenuTrigger[]`\]; `cost`: \{ `pool_id`: `string`; `amount`: `number`; `resource_label?`: `string`; \}; `eligibility?`: \{ `requires_keyword?`: \[`string`, `...string[]`\]; `excludes_keyword?`: \[`string`, `...string[]`\]; `selector_count?`: `number`; `requires?`: \[[`AbilityDSLCondition2`](../type-aliases/AbilityDSLCondition2.md), `...AbilityDSLCondition2[]`\]; \}; `usage?`: \{ `repeatable_if_different_unit?`: `boolean`; \}; `duration?`: `"immediate"` \| `"until-end-of-phase"` \| `"until-end-of-turn"`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, ...\{ id: string; label: string; when: ResourceActionMenuTrigger \| \[ResourceActionMenuTrigger, ...ResourceActionMenuTrigger\[\]\]; cost: \{ pool\_id: string; amount: number; resource\_label?: string \}; eligibility?: \{ requires\_keyword?: \[string, ...string\[\]\]; excludes\_keyword?: \[string, ...string\[\]\]; selector\_count?: number; requires?: \[AbilityDSLCondition2, ...AbilityDSLCondition2\[\]\] \}; usage?: \{ repeatable\_if\_different\_unit?: boolean \}; duration?: "immediate" \| "until-end-of-phase" \| "until-end-of-turn"; effect: EffectNode \}\[\]\]

Defined in: [generated.ts:2949](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2949)

#### Min Items

1
