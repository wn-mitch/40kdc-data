[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WargearOption

# Interface: WargearOption

Defined in: [generated.ts:8180](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8180)

An item-level weapon/wargear swap, addition, or choice available to models within a unit. An option transforms a model's default or selected whole-model loadout only when its model constraints and replacement prerequisites are satisfied. Whole-model alternatives belong in the composition's loadout_variants; applying an option must not bypass the resulting variant's selection limits or the unit's equipment budgets.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wargear-option".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:8181](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8181)

***

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:8182](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8182)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:8186](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8186)

Kebab-case identifier

***

### model\_constraint?

> `optional` **model\_constraint?**: \{ `model_name?`: `string`; `per_n_models?`: `number`; `max_count?`: `number`; `any_number?`: `boolean`; \} \| `null`

Defined in: [generated.ts:8187](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8187)

#### Union Members

##### Type Literal

\{ `model_name?`: `string`; `per_n_models?`: `number`; `max_count?`: `number`; `any_number?`: `boolean`; \}

##### model\_name?

> `optional` **model\_name?**: `string`

##### per\_n\_models?

> `optional` **per\_n\_models?**: `number`

##### max\_count?

> `optional` **max\_count?**: `number`

##### any\_number?

> `optional` **any\_number?**: `boolean`

When true, every model in the unit may take the option ('Any number of models can each ...'). Mutually exclusive in spirit with `per_n_models`.

***

`null`

***

### replaces?

> `optional` **replaces?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:8201](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8201)

Weapon or wargear IDs removed from the model. Omit for a pure add-on (the option only equips new wargear).

#### Min Items

1

***

### replacement?

> `optional` **replacement?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:8207](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8207)

Weapon or wargear IDs added to the model — all of them. Exactly one of `replacement` / `replacement_choice` is present.

#### Min Items

1

***

### replacement\_choice?

> `optional` **replacement\_choice?**: \[\[`string`, `...string[]`\], \[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:8213](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8213)

A choice of replacements ('one of the following'): pick exactly one inner group; each group's IDs are all added together. Exactly one of `replacement` / `replacement_choice` is present.

#### Min Items

2

***

### is\_free?

> `optional` **is\_free?**: `boolean`

Defined in: [generated.ts:8214](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8214)

***

### additional\_cost?

> `optional` **additional\_cost?**: `number` \| `null`

Defined in: [generated.ts:8215](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8215)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:8216](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8216)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes6`](../type-aliases/GameModes6.md)

Defined in: [generated.ts:8217](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/generated.ts#L8217)
