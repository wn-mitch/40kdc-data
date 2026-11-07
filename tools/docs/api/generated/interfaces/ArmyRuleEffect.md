[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / ArmyRuleEffect

# Interface: ArmyRuleEffect

Defined in: [generated.ts:6316](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6316)

[army] A rule that applies when mustering the army.

## Properties

### type

> **type**: `"army-rule"`

Defined in: [generated.ts:6317](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6317)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6318](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6318)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6319](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6319)

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

Defined in: [generated.ts:6365](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L6365)
