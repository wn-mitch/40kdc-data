[**@alpaca-software/40kdc-data**](../../README.md)

***

[@alpaca-software/40kdc-data](../../README.md) / [data](../README.md) / DecodeResult

# Type Alias: DecodeResult

> **DecodeResult** = \{ `ok`: `true`; `list`: [`ShareList`](../interfaces/ShareList.md); \} \| \{ `ok`: `false`; `reason`: `"malformed"` \| `"stale-registry"`; \}

Defined in: [share/codec.ts:77](https://github.com/wn-mitch/40kdc-data/blob/421139971c86ec118e72d39959ebf2264a8a8f2b/tools/src/share/codec.ts#L77)

Outcome of decodeShareList: a list, or why it couldn't be read.
