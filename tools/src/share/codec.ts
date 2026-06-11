/**
 * The `share-v1` compact list codec.
 *
 * A {@link ShareList} — the lossless essential subset of a roster — is packed
 * into unsigned LEB128 varints over registry indices (see {@link ShareRegistry})
 * and base64url-encoded. Entity ids become 1–3 byte integers instead of full
 * kebab-case strings, so a 2000-pt list fits in a few hundred URL-safe chars.
 *
 * The format is deliberately gzip-free: at list sizes the deflate header costs
 * more than it saves, and a raw varint buffer is trivially reproducible
 * byte-for-byte across the TS, Rust, and Python implementations (the
 * `conformance/share` corpus pins it). Free text (`name`, `grants`) rides along
 * as length-prefixed UTF-8 — the only incompressible part.
 *
 * Wire layout (all integers unsigned LEB128 unless noted):
 * ```
 *   formatVersion    1 byte (= SHARE_FORMAT_VERSION)
 *   registryVersion  varint
 *   name             varint len + UTF-8 bytes
 *   factionRef       varint  (0 = none; else faction index + 1)
 *   battleSize       varint  (0 = incursion, 1 = strike-force)
 *   dispositionRef   varint  (0 = none; else disposition index + 1)
 *   detachments      varint count, then [detachment index]...
 *   units            varint count, then per unit:
 *     unitIdx        varint
 *     modelCount     varint
 *     flags          varint  bit0 warlord | bit1 enh | bit2 attach | bit3 ally | bit4 grants
 *     [enhIdx]       varint            if enh
 *     [attachOrd]    varint            if attach  (ordinal into THIS unit list)
 *     [allyFaction,allyRule] varint×2  if ally
 *     [grants]       varint count, then [varint len + UTF-8]...   if grants
 *     loadout        varint count, then [wargearIdx varint, count varint]...
 * ```
 *
 * @packageDocumentation
 */
import { ShareRegistryIndex, type ShareKind } from "./registry.js";

/** Current wire-format version. Bumped only if the byte layout changes. */
export const SHARE_FORMAT_VERSION = 1;

/** Battle sizes, encoded by position. */
const BATTLE_SIZES = ["incursion", "strike-force"] as const;
export type ShareBattleSize = (typeof BATTLE_SIZES)[number];

/** One weapon/wargear selection: id and how many. */
export type ShareLoadoutEntry = [wargearId: string, count: number];

/** One unit in a {@link ShareList}. Mirrors the builder's per-row essentials. */
export interface ShareUnit {
  datasheetId: string;
  modelCount: number;
  isWarlord: boolean;
  enhancementId: string | null;
  /** Source faction id when this is an *allied* unit; null for own-faction. */
  allyFactionId: string | null;
  /** Allied-rule id this unit was included under; null when not an ally. */
  allyRuleId: string | null;
  /** Ordinal (into {@link ShareList.units}) of the bodyguard this leader joins. */
  attachedToOrdinal: number | null;
  /** Detachment keyword grants the player assigned to this unit. */
  grants: string[];
  loadout: ShareLoadoutEntry[];
}

/** The lossless, serializable essence of a list — what a share link carries. */
export interface ShareList {
  name: string;
  factionId: string | null;
  detachmentIds: string[];
  battleSize: ShareBattleSize;
  disposition: string | null;
  units: ShareUnit[];
}

/** Outcome of {@link decodeShareList}: a list, or why it couldn't be read. */
export type DecodeResult =
  | { ok: true; list: ShareList }
  | { ok: false; reason: "malformed" | "stale-registry" };

// ── varint + buffer helpers ──────────────────────────────────────────────────

/** Growable byte sink with LEB128 + length-prefixed UTF-8 writers. */
class ByteWriter {
  private bytes: number[] = [];
  private readonly enc = new TextEncoder();

  byte(b: number): void {
    this.bytes.push(b & 0xff);
  }

  /** Unsigned LEB128. */
  varint(value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`varint expects a non-negative integer, got ${value}`);
    }
    let v = value;
    while (v >= 0x80) {
      this.bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.bytes.push(v);
  }

  /** Length-prefixed UTF-8 string. */
  str(s: string): void {
    const utf8 = this.enc.encode(s);
    this.varint(utf8.length);
    for (const b of utf8) this.bytes.push(b);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Cursor over a byte buffer. Throws {@link MalformedError} past the end. */
class ByteReader {
  private pos = 0;
  private readonly dec = new TextDecoder("utf-8", { fatal: false });
  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.bytes.length) throw new MalformedError();
    return this.bytes[this.pos++];
  }

  varint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = this.byte();
      result += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) return result;
      shift *= 0x80;
      if (shift > Number.MAX_SAFE_INTEGER) throw new MalformedError();
    }
  }

  str(): string {
    const len = this.varint();
    if (this.pos + len > this.bytes.length) throw new MalformedError();
    const slice = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return this.dec.decode(slice);
  }

  atEnd(): boolean {
    return this.pos >= this.bytes.length;
  }
}

/** Internal: thrown when the byte stream is truncated or self-inconsistent. */
class MalformedError extends Error {}
/** Internal: thrown when an index isn't in the decoder's registry. */
class StaleRegistryError extends Error {}

// ── base64url (no padding) ────────────────────────────────────────────────────

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(token: string): Uint8Array {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── encode ────────────────────────────────────────────────────────────────────

const FLAG_WARLORD = 1 << 0;
const FLAG_ENH = 1 << 1;
const FLAG_ATTACH = 1 << 2;
const FLAG_ALLY = 1 << 3;
const FLAG_GRANTS = 1 << 4;

/** Resolve an id to its registry slot, or fail loudly (registry is behind). */
function requireIndex(idx: ShareRegistryIndex, kind: ShareKind, id: string): number {
  const i = idx.index(kind, id);
  if (i === undefined) {
    throw new Error(
      `share registry has no ${kind} id "${id}" — run \`npm run registry:build\` and commit the result`,
    );
  }
  return i;
}

/** Encode a {@link ShareList} into a URL-safe `share-v1` token. */
export function encodeShareList(list: ShareList, registry: ShareRegistryIndex): string {
  const w = new ByteWriter();
  w.byte(SHARE_FORMAT_VERSION);
  w.varint(registry.version);
  w.str(list.name);

  w.varint(list.factionId === null ? 0 : requireIndex(registry, "faction", list.factionId) + 1);
  w.varint(BATTLE_SIZES.indexOf(list.battleSize) < 0 ? 0 : BATTLE_SIZES.indexOf(list.battleSize));
  w.varint(
    list.disposition === null ? 0 : requireIndex(registry, "disposition", list.disposition) + 1,
  );

  w.varint(list.detachmentIds.length);
  for (const id of list.detachmentIds) w.varint(requireIndex(registry, "detachment", id));

  w.varint(list.units.length);
  for (const u of list.units) {
    w.varint(requireIndex(registry, "unit", u.datasheetId));
    w.varint(u.modelCount);
    const flags =
      (u.isWarlord ? FLAG_WARLORD : 0) |
      (u.enhancementId ? FLAG_ENH : 0) |
      (u.attachedToOrdinal !== null ? FLAG_ATTACH : 0) |
      (u.allyRuleId || u.allyFactionId ? FLAG_ALLY : 0) |
      (u.grants.length > 0 ? FLAG_GRANTS : 0);
    w.varint(flags);
    if (u.enhancementId) w.varint(requireIndex(registry, "enhancement", u.enhancementId));
    if (u.attachedToOrdinal !== null) w.varint(u.attachedToOrdinal);
    if (flags & FLAG_ALLY) {
      // An ally carries both its source faction and the rule it came in under;
      // either may be absent in odd data, so encode 0 = none with +1 offset.
      w.varint(u.allyFactionId === null ? 0 : requireIndex(registry, "faction", u.allyFactionId) + 1);
      w.varint(u.allyRuleId === null ? 0 : requireIndex(registry, "ally_rule", u.allyRuleId) + 1);
    }
    if (u.grants.length > 0) {
      w.varint(u.grants.length);
      for (const g of u.grants) w.str(g);
    }
    w.varint(u.loadout.length);
    for (const [wid, count] of u.loadout) {
      w.varint(requireIndex(registry, "wargear", wid));
      w.varint(count);
    }
  }

  return bytesToBase64url(w.toBytes());
}

// ── decode ─────────────────────────────────────────────────────────────────────

/** Look up a slot's id, treating an out-of-range slot as a stale registry. */
function requireId(idx: ShareRegistryIndex, kind: ShareKind, slot: number): string {
  const id = idx.id(kind, slot);
  if (id === undefined) throw new StaleRegistryError();
  return id;
}

/** Decode a `share-v1` token, or report why it can't be read. */
export function decodeShareList(token: string, registry: ShareRegistryIndex): DecodeResult {
  try {
    const r = new ByteReader(base64urlToBytes(token));
    if (r.byte() !== SHARE_FORMAT_VERSION) return { ok: false, reason: "malformed" };
    r.varint(); // registryVersion — informational; bounds checks below gate staleness.

    const name = r.str();
    const factionRef = r.varint();
    const factionId = factionRef === 0 ? null : requireId(registry, "faction", factionRef - 1);
    const battleSize = BATTLE_SIZES[r.varint()] ?? "strike-force";
    const dispositionRef = r.varint();
    const disposition =
      dispositionRef === 0 ? null : requireId(registry, "disposition", dispositionRef - 1);

    const detCount = r.varint();
    const detachmentIds: string[] = [];
    for (let i = 0; i < detCount; i++) {
      detachmentIds.push(requireId(registry, "detachment", r.varint()));
    }

    const unitCount = r.varint();
    const units: ShareUnit[] = [];
    for (let i = 0; i < unitCount; i++) {
      const datasheetId = requireId(registry, "unit", r.varint());
      const modelCount = r.varint();
      const flags = r.varint();
      const enhancementId =
        flags & FLAG_ENH ? requireId(registry, "enhancement", r.varint()) : null;
      const attachedToOrdinal = flags & FLAG_ATTACH ? r.varint() : null;
      let allyFactionId: string | null = null;
      let allyRuleId: string | null = null;
      if (flags & FLAG_ALLY) {
        const fRef = r.varint();
        allyFactionId = fRef === 0 ? null : requireId(registry, "faction", fRef - 1);
        const rRef = r.varint();
        allyRuleId = rRef === 0 ? null : requireId(registry, "ally_rule", rRef - 1);
      }
      const grants: string[] = [];
      if (flags & FLAG_GRANTS) {
        const gCount = r.varint();
        for (let g = 0; g < gCount; g++) grants.push(r.str());
      }
      const loadout: ShareLoadoutEntry[] = [];
      const lCount = r.varint();
      for (let l = 0; l < lCount; l++) {
        const wid = requireId(registry, "wargear", r.varint());
        loadout.push([wid, r.varint()]);
      }
      units.push({
        datasheetId,
        modelCount,
        isWarlord: Boolean(flags & FLAG_WARLORD),
        enhancementId,
        allyFactionId,
        allyRuleId,
        attachedToOrdinal,
        grants,
        loadout,
      });
    }

    return { ok: true, list: { name, factionId, detachmentIds, battleSize, disposition, units } };
  } catch (e) {
    if (e instanceof StaleRegistryError) return { ok: false, reason: "stale-registry" };
    return { ok: false, reason: "malformed" };
  }
}
