[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / StatModifierEffect

# Interface: StatModifierEffect

Defined in: [generated.ts:3134](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3134)

[characteristic] Change a characteristic of the target's models or their weapons. incoming: the change applies to attacks made against the target.

## Properties

### type

> **type**: `"stat-modifier"`

Defined in: [generated.ts:3135](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3135)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3136](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3136)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3137](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3137)

#### stat

> **stat**: `"M"` \| `"T"` \| `"Sv"` \| `"W"` \| `"Ld"` \| `"OC"` \| `"A"` \| `"WS"` \| `"BS"` \| `"S"` \| `"AP"` \| `"D"` \| `"Range"` \| `"detection-range"` \| `"psyker-level"`

#### operation

> **operation**: `"add"` \| `"subtract"` \| `"set"` \| `"improve"` \| `"worsen"` \| `"multiply"` \| `"halve"`

#### value?

> `optional` **value?**: [`Quantity`](../type-aliases/Quantity.md)

#### incoming?

> `optional` **incoming?**: `true`

#### minimum?

> `optional` **minimum?**: `number`

#### maximum?

> `optional` **maximum?**: `number`

#### weapons?

> `optional` **weapons?**: [`WeaponScope`](WeaponScope.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3161](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L3161)
