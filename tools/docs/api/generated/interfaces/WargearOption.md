[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [generated](../README.md) / WargearOption

# Interface: WargearOption

Defined in: [generated.ts:1248](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1248)

A wargear option available to models within a unit: a weapon/wargear swap, a pure add-on, or a choice between alternatives. Models start with the unit's base loadout; an option modifies that loadout for the number of models its `model_constraint` permits.

This interface was referenced by `0KdcBundledSchemas`'s JSON-Schema
via the `definition` "wargear-option".

## Properties

### id

> **id**: `string`

Defined in: [generated.ts:1249](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1249)

***

### unit\_id

> **unit\_id**: `string`

Defined in: [generated.ts:1250](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1250)

***

### model\_constraint?

> `optional` **model\_constraint?**: \{ `model_name?`: `string`; `per_n_models?`: `number`; `max_count?`: `number`; `any_number?`: `boolean`; \} \| `null`

Defined in: [generated.ts:1251](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1251)

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

Defined in: [generated.ts:1265](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1265)

Weapon or wargear IDs removed from the model. Omit for a pure add-on (the option only equips new wargear).

#### Min Items

1

***

### replacement?

> `optional` **replacement?**: \[`string`, `...string[]`\]

Defined in: [generated.ts:1271](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1271)

Weapon or wargear IDs added to the model — all of them. Exactly one of `replacement` / `replacement_choice` is present.

#### Min Items

1

***

### replacement\_choice?

> `optional` **replacement\_choice?**: \[\[`string`, `...string[]`\], \[`string`, `...string[]`\], `...[string, ...string[]][]`\]

Defined in: [generated.ts:1277](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1277)

A choice of replacements ('one of the following'): pick exactly one inner group; each group's IDs are all added together. Exactly one of `replacement` / `replacement_choice` is present.

#### Min Items

2

***

### is\_free?

> `optional` **is\_free?**: `boolean`

Defined in: [generated.ts:1278](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1278)

***

### additional\_cost?

> `optional` **additional\_cost?**: `number` \| `null`

Defined in: [generated.ts:1279](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1279)

***

### game\_version

> **game\_version**: [`GameVersionReference`](GameVersionReference.md)

Defined in: [generated.ts:1280](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/generated.ts#L1280)
