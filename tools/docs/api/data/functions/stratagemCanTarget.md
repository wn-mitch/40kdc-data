[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / stratagemCanTarget

# Function: stratagemCanTarget()

> **stratagemCanTarget**(`stratagem`, `keywords`): `boolean`

Defined in: [abilities-resolver/resolver.ts:274](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/abilities-resolver/resolver.ts#L274)

Whether a unit with `keywords` (lower-cased) can be a stratagem's friendly target. A stratagem
with no friendly target (none printed, or only enemy targets) does not restrict its user here;
with several friendly targets, matching any one is enough. The resolver does not know which
model is the Warlord, so a Warlord target only needs a unit that could contain it: one with
CHARACTER, the keyword every Warlord carries.

## Parameters

### stratagem

[`Stratagem`](../../generated/interfaces/Stratagem.md)

### keywords

`ReadonlySet`\<`string`\>

## Returns

`boolean`
