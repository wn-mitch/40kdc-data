[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / stripLeadingThe

# Function: stripLeadingThe()

> **stripLeadingThe**(`input`): `string` \| `null`

Defined in: [data/normalize.ts:63](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/data/normalize.ts#L63)

Strip a leading "The " (case-insensitive, after trimming) from a display
name, returning the remainder. Returns `null` when there is no leading
"The " to strip, so callers can cheaply tell whether a retry is worthwhile.

Used only by roster import to bridge the leading-article mismatch between
data names and roster exports in BOTH directions ("The Bloody Twins" ↔
"Bloody Twins", "Fire Axe" ↔ "The Fire Axe"). This is deliberately NOT
folded into [normalizeName](normalizeName.md): that key is shared by unit, faction, and
ability lookup, where dropping a leading "The" would collide distinct
entities (e.g. "The Emperor's Champion").

## Parameters

### input

`string`

## Returns

`string` \| `null`

## Example

```ts
stripLeadingThe("The Bloody Twins"); // "Bloody Twins"
stripLeadingThe("Bloody Twins");     // null
```
