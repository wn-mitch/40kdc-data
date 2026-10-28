[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / inGameMode

# Function: inGameMode()

> **inGameMode**(`gameModes`, `mode`): `boolean`

Defined in: [data/collection.ts:65](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/data/collection.ts#L65)

Whether a record with these `game_modes` is listed in `mode`. An absent or
empty `game_modes` means matched play only; `"all"` lists everything.

## Parameters

### gameModes

readonly `string`[] \| `null` \| `undefined`

### mode

[`GameModeView`](../type-aliases/GameModeView.md)

## Returns

`boolean`
