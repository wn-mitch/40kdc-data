/**
 * Id assignment for the export. An entity takes its BSData id from the
 * committed map when it has one and no earlier entity has claimed it;
 * otherwise it gets an id minted from a stable key, in BSData's four-group hex
 * form, so ids stay the same from release to release.
 */
import { createHash } from "node:crypto";
import idsJson from "./bsdata-ids.json" with { type: "json" };
import type { BsdataIds } from "./extract-ids.js";

export const BSDATA_IDS = idsJson as unknown as BsdataIds;

/** BSData's id form: four groups of one to four lowercase hex digits. */
export const BSDATA_ID_PATTERN = /^[0-9a-f]{1,4}(-[0-9a-f]{1,4}){3}$/;

/** A four-group hex id derived from `key`. */
export function mintId(key: string): string {
  const hex = createHash("sha256").update(`40kdc-bsdata:${key}`).digest("hex");
  return [0, 4, 8, 12].map((i) => hex.slice(i, i + 4)).join("-");
}

export class IdAllocator {
  private readonly owners = new Map<string, string>();

  /**
   * The id for the entity named by `key`: `preferred` (a BSData id) when it is
   * given and unclaimed, else the minted id. One key always gets one id.
   */
  id(key: string, preferred?: string): string {
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const chosen = preferred && !this.owners.has(preferred) ? preferred : mintId(key);
    const owner = this.owners.get(chosen);
    if (owner !== undefined && owner !== key) {
      throw new Error(`bsdata export: id ${chosen} minted for both ${owner} and ${key}`);
    }
    this.owners.set(chosen, key);
    this.byKey.set(key, chosen);
    return chosen;
  }

  private readonly byKey = new Map<string, string>();
}
