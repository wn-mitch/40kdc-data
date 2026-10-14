[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / rosterToShareList

# Function: rosterToShareList()

> **rosterToShareList**(`roster`): [`ShareList`](../interfaces/ShareList.md)

Defined in: [share/index.ts:58](https://github.com/wn-mitch/40kdc-data/blob/a2eb8df438860bb8af02958d2ac93851b300db39/tools/src/share/index.ts#L58)

Adapt an imported Roster to a [ShareList](../interfaces/ShareList.md) against the embedded
registry, keeping only resolved, registry-known ids. Pair with
[encodeShareToken](encodeShareToken.md) (inside a try/catch) to turn a parsed list into a
share link; see rosterToShareListImpl for the partial-mapping contract.

## Parameters

### roster

`Roster`

## Returns

[`ShareList`](../interfaces/ShareList.md)
