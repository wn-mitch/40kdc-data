[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WargearOption

# Interface: WargearOption

Defined in: [generated.ts:7640](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7640)

An item-level weapon/wargear swap, addition, or choice available to models within a unit. An option transforms a model's default or selected whole-model loadout only when its model constraints and replacement prerequisites are satisfied. Whole-model alternatives belong in the composition's loadout_variants; applying an option must not bypass the resulting variant's selection limits or the unit's equipment budgets.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wargear-option".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:7641](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7641)

***

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:7642](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7642)

***

### faction\_id

> **faction\_id**: `string`

Defined in: [generated.ts:7646](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7646)

Kebab-case identifier

***

### model\_constraint?

> `optional` **model\_constraint?**: \{ `model_name?`: `string`; `per_n_models?`: `number`; `max_count?`: `number`; `any_number?`: `boolean`; \} \| `null`

Defined in: [generated.ts:7647](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7647)

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

Defined in: [generated.ts:7661](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7661)

Weapon or wargear IDs removed from the model. Omit for a pure add-on (the option only equips new wargear).

#### Min Items

1

***

### replacement?

> `optional` **replacement?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:7667](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7667)

Weapon or wargear IDs added to the model — all of them. Exactly one of `replacement` / `replacement_choice` is present.

#### Min Items

1

***

### replacement\_choice?

> `optional` **replacement\_choice?**: \[\[`string`, `...string[]`\], \[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:7673](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7673)

A choice of replacements ('one of the following'): pick exactly one inner group; each group's IDs are all added together. Exactly one of `replacement` / `replacement_choice` is present.

#### Min Items

2

***

### is\_free?

> `optional` **is\_free?**: `boolean`

Defined in: [generated.ts:7674](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7674)

***

### additional\_cost?

> `optional` **additional\_cost?**: `number` \| `null`

Defined in: [generated.ts:7675](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7675)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:7676](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7676)

***

### game\_modes?

> `optional` **game\_modes?**: [`GameModes6`](../type-aliases/GameModes6.md)

Defined in: [generated.ts:7677](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/generated.ts#L7677)
