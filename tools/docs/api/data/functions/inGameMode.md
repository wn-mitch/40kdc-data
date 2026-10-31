[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / inGameMode

# Function: inGameMode()

> **inGameMode**(`gameModes`, `mode`): `boolean`

Defined in: [data/collection.ts:65](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/data/collection.ts#L65)

Whether a record with these `game_modes` is listed in `mode`. An absent or
empty `game_modes` means matched play only; `"all"` lists everything.

## Parameters

### gameModes

readonly `string`[] \| `null` \| `undefined`

### mode

[`GameModeView`](../type-aliases/GameModeView.md)

## Returns

`boolean`
