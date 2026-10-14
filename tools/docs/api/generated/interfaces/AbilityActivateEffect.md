[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityActivateEffect

# Interface: AbilityActivateEffect

Defined in: [generated.ts:4173](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4173)

[ability] Make a named ability resolve now, or make options of it active: option (one), options (two or more together) or all_options (every one). select: which option is picked now (by a fresh roll, or by the player; count: how many, from: only among these). exclusive: the activated options replace any already active; without it they join them. ignore_consumed: the option may be picked even if a once-per-battle selection already used it. override: the activation resolves with this amount instead of its own.

## Properties

### type

> **type**: `"ability-activate"`

Defined in: [generated.ts:4174](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4174)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4175](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4175)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4176](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4176)

#### ability

> **ability**: `string`

#### procedure?

> `optional` **procedure?**: `"oath"`

#### option?

> `optional` **option?**: `string`

#### options?

> `optional` **options?**: \[`string`, `string`, `...string[]`\]

##### Min Items

2

#### all\_options?

> `optional` **all\_options?**: `true`

#### exclusive?

> `optional` **exclusive?**: `true`

#### select?

> `optional` **select?**: `object`

##### select.by

> **by**: `"roll"` \| `"player"`

##### select.count?

> `optional` **count?**: `number`

##### select.from?

> `optional` **from?**: \[`string`, `string`, `...string[]`\]

###### Min Items

2

#### ignore\_consumed?

> `optional` **ignore\_consumed?**: `true`

#### override?

> `optional` **override?**: `object`

##### override.amount

> **amount**: [`Quantity`](../type-aliases/Quantity.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4199](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/generated.ts#L4199)
