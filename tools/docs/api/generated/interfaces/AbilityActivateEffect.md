[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / AbilityActivateEffect

# Interface: AbilityActivateEffect

Defined in: [generated.ts:5023](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5023)

[ability] Make a named ability resolve now, or make options of it active: option (one), options (two or more together) or all_options (every one). select: which option is picked now (by a fresh roll, by the player, or by event: the option the triggering use of another ability selected, "the selected combat doctrine is active for this unit" after a Strategic Acumen use; excluding: army-active, never the option active for your army; count: how many, from: only among these; option_var: the pick is made once and bound under this name, so every unit a surrounding aura or loop applies it to shares it). exclusive: the activated options replace any already active; without it they join them. ignore_consumed: the option may be picked even if a once-per-battle selection already used it. override: the activation resolves with this amount instead of its own.

## Properties

### type

> **type**: `"ability-activate"`

Defined in: [generated.ts:5024](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5024)

***

### target

> **target**: [`UnitRef`](../type-aliases/UnitRef.md)

Defined in: [generated.ts:5025](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5025)

***

### modifier

> **modifier**: `object`

Defined in: [generated.ts:5026](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5026)

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

Defined in: [generated.ts:5054](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L5054)
