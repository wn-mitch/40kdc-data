[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityModifierEffect

# Interface: AbilityModifierEffect

Defined in: [generated.ts:3691](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3691)

[ability] Change one named ability: its uses, range, targets, recipients, selections, how many can apply at once, duration, start round, threshold or options.

## Properties

### type

> **type**: `"ability-modifier"`

Defined in: [generated.ts:3692](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3692)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:3693](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3693)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:3694](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3694)

#### ability

> **ability**: `string` \| [`StanceOptionRef1`](StanceOptionRef1.md) \| [`NamedAbilityRef1`](NamedAbilityRef1.md) \| \{ `affecting`: [`UnitFilter`](UnitFilter.md); \} \| \{ `event`: `"used"`; `event_var`: `string`; \} \| \{ `keyword`: `string`; \}

#### aspect

> **aspect**: `"uses"` \| `"range"` \| `"targets"` \| `"recipients"` \| `"selections"` \| `"selection"` \| `"concurrent"` \| `"duration"` \| `"start-round"` \| `"end-round"` \| `"threshold"` \| `"options"`

#### operation

> **operation**: `"add"` \| `"subtract"` \| `"set"` \| `"lift-limit"`

#### value?

> `optional` **value?**: `string` \| `number`

#### cap?

> `optional` **cap?**: `number`

#### recipients?

> `optional` **recipients?**: [`UnitFilter`](UnitFilter.md)

#### selection?

> `optional` **selection?**: [`UnitSelector`](UnitSelector.md)

#### recipient\_duration?

> `optional` **recipient\_duration?**: [`ScopeDuration`](../type-aliases/ScopeDuration.md)

#### add\_option?

> `optional` **add\_option?**: `object`

##### add\_option.name

> **name**: `string`

##### add\_option.effect

> **effect**: [`EffectNode`](../type-aliases/EffectNode.md)

#### cap\_per?

> `optional` **cap\_per?**: `object`

The changed allowance still applies at most count times per period (two uses, but only one per battle round).

##### cap\_per.count

> **count**: `number`

##### cap\_per.period

> **period**: `"battle-round"` \| `"phase"` \| `"turn"`

#### not\_same?

> `optional` **not\_same?**: `"phase"` \| `"turn"`

The extra use cannot be made in the same phase (turn) as the use that triggered it.

#### consumes\_shared\_use?

> `optional` **consumes\_shared\_use?**: `false`

This unit's use does not count toward the shared (once per phase per army) limit for other units.

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:3748](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L3748)
