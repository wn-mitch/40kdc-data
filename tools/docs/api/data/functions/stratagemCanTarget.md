[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / stratagemCanTarget

# Function: stratagemCanTarget()

> **stratagemCanTarget**(`stratagem`, `keywords`): `boolean`

Defined in: [abilities-resolver/resolver.ts:270](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/abilities-resolver/resolver.ts#L270)

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
