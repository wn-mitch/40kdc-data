[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CharacteristicResolutionEffect

# Interface: CharacteristicResolutionEffect

Defined in: [generated.ts:6681](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6681)

[characteristic] How a characteristic that differs between the target's models is resolved: the value most models have (ties: the higher or lower), or the highest or lowest. applies_to: only for that purpose.

## Properties

### type

> **type**: `"characteristic-resolution"`

Defined in: [generated.ts:6682](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6682)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:6683](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6683)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6684](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6684)

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

Defined in: [generated.ts:6691](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L6691)
