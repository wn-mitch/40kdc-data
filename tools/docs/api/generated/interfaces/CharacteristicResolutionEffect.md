[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / CharacteristicResolutionEffect

# Interface: CharacteristicResolutionEffect

Defined in: [generated.ts:5997](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5997)

[characteristic] How a characteristic that differs between the target's models is resolved: the value most models have (ties: the higher or lower), or the highest or lowest. applies_to: only for that purpose.

## Properties

### type

> **type**: `"characteristic-resolution"`

Defined in: [generated.ts:5998](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5998)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5999](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L5999)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:6000](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6000)

#### stat

> **stat**: `"M"` \| `"T"` \| `"Sv"` \| `"W"` \| `"Ld"` \| `"OC"` \| `"A"` \| `"WS"` \| `"BS"` \| `"S"` \| `"AP"` \| `"D"` \| `"Range"` \| `"detection-range"` \| `"psyker-level"`

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

Defined in: [generated.ts:6022](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L6022)
