[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ResourceActionMenuEffect

# Interface: ResourceActionMenuEffect

Defined in: [generated.ts:3812](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3812)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "resource-action-menu-effect".

## Properties

### type

> **type**: `"resource-action-menu"`

Defined in: [generated.ts:3813](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3813)

***

### menu\_id

> **menu\_id**: `string`

Defined in: [generated.ts:3814](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3814)

***

### pool\_id

> **pool\_id**: `string`

Defined in: [generated.ts:3815](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3815)

***

### shared\_usage?

> `optional` **shared\_usage?**: `object`

Defined in: [generated.ts:3816](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3816)

#### unit\_max\_manoeuvres\_per\_phase?

> `optional` **unit\_max\_manoeuvres\_per\_phase?**: `number`

#### default\_manoeuvre\_max\_per\_phase?

> `optional` **default\_manoeuvre\_max\_per\_phase?**: `number`

***

### capacity?

> `optional` **capacity?**: `object`

Defined in: [generated.ts:3820](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3820)

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

> **actions**: \[\{ `id`: `string`; `label`: `string`; `when`: [`ResourceActionMenuTrigger`](ResourceActionMenuTrigger.md) \| \[[`ResourceActionMenuTrigger`](ResourceActionMenuTrigger.md), `...ResourceActionMenuTrigger[]`\]; `cost`: \{ `pool_id`: `string`; `amount`: `number`; `resource_label?`: `string`; \}; `eligibility?`: \{ `filter?`: [`UnitFilter`](UnitFilter.md); `count?`: [`CountBounds`](CountBounds.md); `requires?`: \[[`AbilityDSLCondition1`](../type-aliases/AbilityDSLCondition1.md), `...AbilityDSLCondition1[]`\]; \}; `usage?`: \{ `repeatable_if_different_unit?`: `boolean`; \}; `duration?`: `"phase"` \| `"turn"` \| `"resolution"`; `effect`: [`EffectNode`](../type-aliases/EffectNode.md); \}, ...\{ id: string; label: string; when: ResourceActionMenuTrigger \| \[ResourceActionMenuTrigger, ...ResourceActionMenuTrigger\[\]\]; cost: \{ pool\_id: string; amount: number; resource\_label?: string \}; eligibility?: \{ filter?: UnitFilter; count?: CountBounds; requires?: \[AbilityDSLCondition1, ...AbilityDSLCondition1\[\]\] \}; usage?: \{ repeatable\_if\_different\_unit?: boolean \}; duration?: "phase" \| "turn" \| "resolution"; effect: EffectNode \}\[\]\]

Defined in: [generated.ts:3829](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3829)

#### Min Items

1
