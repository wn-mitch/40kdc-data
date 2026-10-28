[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / rosterToShareList

# Function: rosterToShareList()

> **rosterToShareList**(`roster`): [`ShareList`](../interfaces/ShareList.md)

Defined in: [share/index.ts:58](https://github.com/wn-mitch/40kdc-data/blob/8559c3d1e7f22290453eb0e2572d8cbc3c6c9bb7/tools/src/share/index.ts#L58)

Adapt an imported Roster to a [ShareList](../interfaces/ShareList.md) against the embedded
registry, keeping only resolved, registry-known ids. Pair with
[encodeShareToken](encodeShareToken.md) (inside a try/catch) to turn a parsed list into a
share link; see rosterToShareListImpl for the partial-mapping contract.

## Parameters

### roster

`Roster`

## Returns

[`ShareList`](../interfaces/ShareList.md)
