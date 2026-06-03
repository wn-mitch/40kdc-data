[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / optionCap

# Function: optionCap()

> **optionCap**(`option`, `modelCount`): `number`

Defined in: [data/loadout.ts:42](https://github.com/alpaca-software/40kdc-data/blob/8142c2c1ee9b76b8bb6b93c47c11cdb583e5d4c2/tools/src/data/loadout.ts#L42)

The maximum number of models that may take `option` in a unit of `modelCount`
models: `any_number` → all models; else `per_n_models` → floor(n / per); else
`max_count ?? 1`; then clamped by `max_count` when set. A null constraint is
treated as unrestricted (every model). Never negative.

## Parameters

### option

[`WargearOption`](../../generated/interfaces/WargearOption.md)

### modelCount

`number`

## Returns

`number`
