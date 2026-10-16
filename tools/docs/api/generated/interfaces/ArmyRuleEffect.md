[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyRuleEffect

# Interface: ArmyRuleEffect

Defined in: [generated.ts:5185](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5185)

[army] A rule that applies when mustering the army.

## Properties

### type

> **type**: `"army-rule"`

Defined in: [generated.ts:5186](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5186)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5187](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5187)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5188](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5188)

#### rule

> **rule**: `"unique"` \| `"attachment"` \| `"warlord-required"` \| `"warlord-forbidden"` \| `"enhancement-forbidden"` \| `"enhancement-slot"` \| `"composition"` \| `"faction-forbidden"` \| `"single-chapter"` \| `"detachment-forbidden"` \| `"detachment-tag-exclusive"` \| `"enhancement-source"` \| `"limit-exemption"`

#### with?

> `optional` **with?**: [`UnitFilter`](UnitFilter.md)

#### datasheets?

> `optional` **datasheets?**: \[`string`, `...string[]`\]

composition/unique: units of any of these datasheets (unit ids); with `with`, units matching both.

##### Min Items

1

#### max?

> `optional` **max?**: `number` \| [`BattleSizeValue`](BattleSizeValue.md)

#### measure?

> `optional` **measure?**: `"units"` \| `"models"` \| `"points"`

What max counts (default units).

#### per?

> `optional` **per?**: [`UnitFilter1`](UnitFilter1.md)

#### exempt\_from?

> `optional` **exempt\_from?**: \[`"retinue-limit"` \| `"enhancement-limit"` \| `"strategic-reserves-points"`, ...("retinue-limit" \| "enhancement-limit" \| "strategic-reserves-points")\[\]\]

Limits the rule's units are left out of: retinue-limit (composition: the Retinue cap), enhancement-limit (limit-exemption: the army's Enhancement cap), strategic-reserves-points (limit-exemption: the points cap for Strategic Reserves).

##### Min Items

1

#### attach\_as?

> `optional` **attach\_as?**: [`UnitFilter2`](UnitFilter2.md)

#### can\_lead?

> `optional` **can\_lead?**: [`UnitFilter3`](UnitFilter3.md)

#### detachment?

> `optional` **detachment?**: `string`

#### tag?

> `optional` **tag?**: `string`

#### led\_by?

> `optional` **led\_by?**: `string`

#### mandatory?

> `optional` **mandatory?**: `true`

#### faction?

> `optional` **faction?**: `string`

#### enhancement\_kind?

> `optional` **enhancement\_kind?**: `string`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:5234](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5234)
