/**
 * Decode a ListForge share payload into a JSON object.
 *
 * ListForge packs a roster as `base64( gzip( utf8(json) ) )` and embeds it in a
 * URL hash fragment: `https://app/#/listforge/<BASE64>`. The fragment is used
 * deliberately so browsers never send it to a server, preserving the payload
 * verbatim. A valid gzipped payload always base64-encodes to a string starting
 * with `H4sIAAAAAAAAA`.
 *
 * {@link decodeListForge} accepts any of three forms and returns the parsed JSON:
 * - a full URL (the segment after the last `/` is taken),
 * - a bare base64 segment,
 * - an already-decoded JSON string (passed straight to `JSON.parse`).
 *
 * Decompression uses `fflate` (a tiny, dependency-free inflate) rather than
 * `node:zlib` so the importer works in browsers as well as Node — this module
 * is reachable from the package's root barrel and must stay universal.
 *
 * @packageDocumentation
 */
import { gunzipSync } from "fflate";

/**
 * Universal base64 → bytes. Node decodes via Buffer; browsers via atob.
 * (`Uint8Array.fromBase64` is still too new to rely on.)
 */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The base64 prefix every ListForge gzip payload begins with. */
const GZIP_BASE64_PREFIX = "H4sIA";

/** The path marker ListForge uses ahead of the payload. */
const LISTFORGE_MARKER = "/listforge/";

/**
 * Extract the payload segment from an input that may be a URL.
 *
 * The base64 alphabet includes `/`, so a bare base64 segment cannot be split on
 * `/`. We only treat the input as a URL when it carries the `/listforge/` marker
 * or an `http(s)://` scheme; otherwise it is returned unchanged.
 */
function extractSegment(input: string): string {
  const markerIndex = input.indexOf(LISTFORGE_MARKER);
  if (markerIndex !== -1) {
    return input.slice(markerIndex + LISTFORGE_MARKER.length);
  }
  if (/^https?:\/\//i.test(input)) {
    const lastSlash = input.lastIndexOf("/");
    return lastSlash === -1 ? input : input.slice(lastSlash + 1);
  }
  return input;
}

/**
 * Decode a ListForge payload (URL, bare base64, or raw JSON) into a JSON value.
 *
 * @throws if the input is neither valid JSON nor a decodable gzip payload.
 */
export function decodeListForge(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("decodeListForge: empty input");
  }

  // Raw JSON object passed directly.
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const segment = extractSegment(trimmed);

  if (!segment.startsWith(GZIP_BASE64_PREFIX)) {
    throw new Error(
      "decodeListForge: input is not a ListForge payload (expected raw JSON, " +
        `or a gzip+base64 segment beginning with "${GZIP_BASE64_PREFIX}…")`,
    );
  }

  let json: string;
  try {
    const bytes = base64ToBytes(segment);
    json = new TextDecoder().decode(gunzipSync(bytes));
  } catch (cause) {
    throw new Error("decodeListForge: failed to gunzip base64 payload", {
      cause,
    });
  }

  return JSON.parse(json);
}
