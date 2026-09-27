[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / DesignateTargetEffect

# Interface: DesignateTargetEffect

Defined in: [generated.ts:2837](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2837)

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "designate-target-effect".

## Properties

### type

> **type**: `"designate-target"`

Defined in: [generated.ts:2838](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2838)

***

### designation

> **designation**: `string`

Defined in: [generated.ts:2839](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2839)

***

### select

> **select**: `object`

Defined in: [generated.ts:2840](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2840)

#### scope

> **scope**: `"enemy-unit"` \| `"friendly-unit"`

#### count?

> `optional` **count?**: `number`

#### timing?

> `optional` **timing?**: `string`

#### within\_inches?

> `optional` **within\_inches?**: `number`

#### reference?

> `optional` **reference?**: `"bearer"` \| `"bearer-unit"` \| `"bearer-transport"`

Explicit built-in origin of range and visibility gates, matching select-units. bearer-transport measures from the Transport the origin unit is embarked within.

#### visibility\_required?

> `optional` **visibility\_required?**: `boolean`

#### keywords?

> `optional` **keywords?**: \[`string`, `...string[]`\]

##### Min Items

1

#### keyword\_match?

> `optional` **keyword\_match?**: `"any"` \| `"all"`

#### eligibility?

> `optional` **eligibility?**: [`AbilityDSLCondition3`](../type-aliases/AbilityDSLCondition3.md)

#### visible\_to?

> `optional` **visible\_to?**: [`SelectionReference`](SelectionReference.md)

#### excluded\_keywords?

> `optional` **excluded\_keywords?**: \[`string`, `...string[]`\]

##### Min Items

1

#### bind\_as?

> `optional` **bind\_as?**: `string`

#### within\_inches\_from?

> `optional` **within\_inches\_from?**: [`SelectionReference`](SelectionReference.md)

#### selection\_limit?

> `optional` **selection\_limit?**: `object`

Maximum selections of this same target by this ability across the whole army in the named period.

##### selection\_limit.count

> **count**: `number`

##### selection\_limit.period

> **period**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"`

***

### applies

> **applies**: `object`

Defined in: [generated.ts:2871](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2871)

#### to

> **to**: `"target"` \| `"attackers-of-target"` \| `"bearer-attacks-target"` \| `"bound-unit-attacks-reference"`

#### effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

#### attacker\_keywords?

> `optional` **attacker\_keywords?**: \[`string`, `...string[]`\]

All keywords required on each individual friendly attacking MODEL, not on its unit. Only meaningful with to:attackers-of-target.

##### Min Items

1

#### attacker\_unit\_keywords?

> `optional` **attacker\_unit\_keywords?**: \[`string`, `...string[]`\]

All keywords required on the attacking model's UNIT, including attached-unit keyword unions. Does not require those keywords on the individual model. Only meaningful with to:attackers-of-target.

##### Min Items

1

#### beneficiary?

> `optional` **beneficiary?**: [`EventOrSelectionReference`](../type-aliases/EventOrSelectionReference.md)

#### reference?

> `optional` **reference?**: [`SelectionReference`](SelectionReference.md)

***

### duration?

> `optional` **duration?**: `"phase"` \| `"turn"` \| `"battle"` \| `"battle-round"` \| `"until-next-command-phase"`

Defined in: [generated.ts:2889](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/generated.ts#L2889)
