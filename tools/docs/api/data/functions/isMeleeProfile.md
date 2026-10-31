[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / isMeleeProfile

# Function: isMeleeProfile()

> **isMeleeProfile**(`profile`): `boolean`

Defined in: [data/weapon-profile.ts:33](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/weapon-profile.ts#L33)

Whether a weapon profile is a melee profile (`range === "Melee"`).

## Parameters

### profile

`Pick`\<[`WeaponProfile`](../type-aliases/WeaponProfile.md), `"range"`\>

## Returns

`boolean`

## Example

```ts
isMeleeProfile({ range: "Melee", ... }); // true
isMeleeProfile({ range: 24, ... });      // false
```
