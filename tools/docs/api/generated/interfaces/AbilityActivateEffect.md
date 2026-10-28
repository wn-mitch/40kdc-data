[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityActivateEffect

# Interface: AbilityActivateEffect

Defined in: [generated.ts:4708](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4708)

[ability] Make a named ability resolve now, or make options of it active: option (one), options (two or more together) or all_options (every one). select: which option is picked now (by a fresh roll, by the player, or by event: the option the triggering use of another ability selected, "the selected combat doctrine is active for this unit" after a Strategic Acumen use; excluding: army-active, never the option active for your army; count: how many, from: only among these; option_var: the pick is made once and bound under this name, so every unit a surrounding aura or loop applies it to shares it). exclusive: the activated options replace any already active; without it they join them. ignore_consumed: the option may be picked even if a once-per-battle selection already used it. override: the activation resolves with this amount instead of its own.

## Properties

### type

> **type**: `"ability-activate"`

Defined in: [generated.ts:4709](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4709)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:4710](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4710)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:4711](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4711)

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

> **by**: `"event"` \| `"roll"` \| `"player"`

##### select.count?

> `optional` **count?**: `number`

##### select.excluding?

> `optional` **excluding?**: `"army-active"`

The pick cannot be the option active for your army. It reads a selection made once and fixed for the battle (a faction rule's option picked at the start of the first battle round); an army option that can change mid-battle has no meaning here.

##### select.from?

> `optional` **from?**: \[`string`, `string`, `...string[]`\]

###### Min Items

2

##### select.option\_var?

> `optional` **option\_var?**: `string`

#### ignore\_consumed?

> `optional` **ignore\_consumed?**: `true`

#### override?

> `optional` **override?**: `object`

##### override.amount

> **amount**: [`Quantity`](../type-aliases/Quantity.md)

***

### scaling?

> `optional` **scaling?**: [`Scaling`](Scaling.md)

Defined in: [generated.ts:4739](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L4739)
