[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyRuleEffect

# Interface: ArmyRuleEffect

Defined in: [generated.ts:5869](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5869)

[army] A rule that applies when mustering the army.

## Properties

### type

> **type**: `"army-rule"`

Defined in: [generated.ts:5870](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5870)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5871](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5871)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5872](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5872)

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

> `optional` **per?**: [`UnitFilter2`](UnitFilter2.md)

#### exempt\_from?

> `optional` **exempt\_from?**: \[`"retinue-limit"` \| `"enhancement-limit"` \| `"strategic-reserves-points"`, ...("retinue-limit" \| "enhancement-limit" \| "strategic-reserves-points")\[\]\]

Limits the rule's units are left out of: retinue-limit (composition: the Retinue cap), enhancement-limit (limit-exemption: the army's Enhancement cap), strategic-reserves-points (limit-exemption: the points cap for Strategic Reserves).

##### Min Items

1

#### attach\_as?

> `optional` **attach\_as?**: [`UnitFilter3`](UnitFilter3.md)

#### can\_lead?

> `optional` **can\_lead?**: [`UnitFilter4`](UnitFilter4.md)

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

Defined in: [generated.ts:5918](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L5918)
