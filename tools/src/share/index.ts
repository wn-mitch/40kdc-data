/**
 * Compact, URL-safe list sharing for the 40kdc list builder.
 *
 * {@link encodeShareToken} packs a {@link ShareList} into a `share-v1` token
 * (registry-indexed varints, base64url); {@link decodeShareToken} reverses it
 * against the embedded {@link SHARE_REGISTRY}. The wire format and registry are
 * documented in `docs/share-token.md` so other tools can interoperate.
 *
 * @example
 * import { encodeShareToken, decodeShareToken } from "@alpaca-software/40kdc-data";
 *
 * const token = encodeShareToken(myList);            // → "AQ..." (URL-safe)
 * const result = decodeShareToken(token);
 * if (result.ok) useList(result.list);
 *
 * @packageDocumentation
 */
import { decodeShareList, encodeShareList, type DecodeResult, type ShareList } from "./codec.js";
import { SHARE_REGISTRY } from "./registry.generated.js";
import { ShareRegistryIndex } from "./registry.js";

export { SHARE_FORMAT_VERSION } from "./codec.js";
export type {
  DecodeResult,
  ShareBattleSize,
  ShareList,
  ShareLoadoutEntry,
  ShareUnit,
} from "./codec.js";
export { SHARE_KINDS } from "./registry.js";
export type { ShareKind, ShareRegistry } from "./registry.js";
export { ShareRegistryIndex } from "./registry.js";

/** The id index built once from the package's embedded registry. */
const embeddedIndex = new ShareRegistryIndex(SHARE_REGISTRY);

/** Registry version this package embeds (stamped into every token it writes). */
export const shareRegistryVersion: number = SHARE_REGISTRY.version;

/** Encode a list into a URL-safe `share-v1` token using the embedded registry. */
export function encodeShareToken(list: ShareList): string {
  return encodeShareList(list, embeddedIndex);
}

/** Decode a `share-v1` token using the embedded registry. */
export function decodeShareToken(token: string): DecodeResult {
  return decodeShareList(token, embeddedIndex);
}
