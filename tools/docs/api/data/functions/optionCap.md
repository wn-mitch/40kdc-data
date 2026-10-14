[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / optionCap

# Function: optionCap()

> **optionCap**(`option`, `modelCount`, `models?`): `number`

Defined in: [data/loadout.ts:50](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/loadout.ts#L50)

The maximum number of TIMES `option` may be taken in a unit of `modelCount`
models: `any_number` alone → once per model; `any_number` WITH `max_count: L`
→ up to L per model (a multi-take mount: "up to 2 seeker missiles", "up to
three of the following, and can take duplicates"); else `per_n_models` →
floor(n / per), clamped by `max_count` when set; else `max_count ?? 1`
(a flat allowance). A null constraint is treated as unrestricted (every
model). Never negative.

## Parameters

### option

[`WargearOption`](../../generated/interfaces/WargearOption.md)

### modelCount

`number`

### models?

readonly [`LoadoutModel`](../interfaces/LoadoutModel.md)[]

## Returns

`number`
