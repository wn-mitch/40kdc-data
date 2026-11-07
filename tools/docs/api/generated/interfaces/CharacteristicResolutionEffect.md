[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CharacteristicResolutionEffect

# Interface: CharacteristicResolutionEffect

Defined in: [generated.ts:7221](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7221)

[characteristic] How a characteristic that differs between the target's models is resolved: the value most models have (ties: the higher or lower), or the highest or lowest. applies_to: only for that purpose.

## Properties

### type

> **type**: `"characteristic-resolution"`

Defined in: [generated.ts:7222](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7222)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:7223](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7223)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:7224](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7224)

#### stat

> **stat**: [`Stat`](../type-aliases/Stat.md)

#### rule

> **rule**: `"highest"` \| `"majority"` \| `"lowest"`

#### tie?

> `optional` **tie?**: `"highest"` \| `"lowest"`

#### applies\_to?

> `optional` **applies\_to?**: `"all"` \| `"wound-roll"`

#### incoming?

> `optional` **incoming?**: `true`

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:7231](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L7231)
