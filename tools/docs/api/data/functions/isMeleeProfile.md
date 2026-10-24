[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / isMeleeProfile

# Function: isMeleeProfile()

> **isMeleeProfile**(`profile`): `boolean`

Defined in: [data/weapon-profile.ts:33](https://github.com/wn-mitch/40kdc-data/blob/b7ac7531588eb50347a5a2c83b5cdd320c728eb0/tools/src/data/weapon-profile.ts#L33)

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
