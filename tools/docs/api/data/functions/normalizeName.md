[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / normalizeName

# Function: normalizeName()

> **normalizeName**(`input`): `string`

Defined in: [data/normalize.ts:30](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/normalize.ts#L30)

Reduce a display name to a canonical lookup key.

The transform, in order:
1. Unicode NFD-decompose, then strip combining marks — `Khârn` → `Kharn`.
2. Casefold to lower case.
3. Remove apostrophe and quote variants (`' ’ ‘ \` " “ ”`) — `T'au` → `Tau`.
4. Collapse any run of whitespace or hyphens to a single space, then trim —
   `Be'lakor` → `belakor`, `the   betrayer` → `the betrayer`.

The result is intended only for comparison; it is not a display value.

## Parameters

### input

`string`

## Returns

`string`

## Example

```ts
normalizeName("Khârn the Betrayer"); // "kharn the betrayer"
normalizeName("T'au");               // "tau"
```
