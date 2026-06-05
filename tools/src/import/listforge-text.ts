/**
 * ListForge plain-text adapter: lower ListForge's copy-paste text export to a
 * {@link ParsedRoster}.
 *
 * This is the bullet-list text users copy out of the ListForge app (distinct
 * from the base64+gzip share-JSON the `listforge` adapter handles). Shape:
 *
 * ```
 * all gas no breaks - Chaos Daemons - Daemonic Incursion (1995 Points)
 *
 * Epic Hero:
 * Rotigus (250 pts)
 *   • Gnarlrod
 *   • Streams of brackish filth
 *
 * Battleline:
 * Bloodletters (110 pts)
 *   • Bloodreaper
 *     • Hellblade
 *   • Daemonic Icon
 *   • 9x Bloodletter
 *     • 9x Hellblade
 * ```
 *
 * - The first non-blank line is `<list name> - <faction> - <detachment>
 *   (<N> Points)`. A list name containing ` - ` breaks the split — a documented
 *   ListForge limitation, not ours.
 * - Sections are mixed-case battlefield-role lines ending with `:`
 *   (`Epic Hero:`, `Character:`, `Battleline:`, …). Units under `Epic Hero:` or
 *   `Character:` are characters.
 * - Bullet classification mirrors the GW adapter: a top-level bullet with
 *   deeper children is a **model group** (its `Nx` count — implicitly 1 —
 *   adds to the model count); without children it's **wargear**. Child-bullet
 *   `Nx` counts are already squad-wide totals; a child without a count is one
 *   item (`• Hellblade` under a lone Bloodreaper).
 * - `E: <name>` is the enhancement annotation (ListForge reports no points for
 *   it, so `enhancement_points` stays null and unit points stay as displayed).
 *   A bare `Warlord` bullet flags the warlord.
 *
 * **Disjointness**: the `(N Points)` first-line suffix is unique to this
 * format — newrecruit-simple's first line ends `- [N pts]`, the GW export
 * opens with a `++++` fence, and the WTC formats carry `N with` lines or no
 * bullets at all.
 *
 * @packageDocumentation
 */
import type { FormatAdapter } from "./adapter.js";
import type { ParsedRoster, ParsedUnit, ParsedWargear } from "./types.js";
import { inferBattleSizeRaw } from "./newrecruit-text.js";

const FIRST_LINE = /^(.+)\s\(\s*(\d+)\s*Points?\s*\)\s*$/i;
const SECTION_HEADER = /^[A-Za-z][A-Za-z0-9 /&'-]*:$/;
const UNIT_HEADER = /^(.+?)\s*\(\s*(\d+)\s*pts?\s*\)\s*$/i;
const BULLET_LINE = /^(\s*)•\s*(.+?)\s*$/u;
const NX_PREFIX = /^(\d+)x\s+(.+)$/;
const BULLET = /^[\t ]*•/mu;
const WITH_LINE = /^[\t ]*\d+\s+with\b/m;

const ENHANCEMENT_PREFIX = "E: ";
const WARLORD_MARKER = "Warlord";
const CHARACTER_SECTIONS = new Set(["epic hero", "character"]);

/** Accept plain text whose first non-blank line is the ListForge
 * `name - faction - detachment (N Points)` header, with `•` bullets and no
 * WTC `N with` lines. */
function isListForgeText(decoded: unknown): string | null {
  if (typeof decoded !== "string") return null;
  const firstNonBlank = decoded
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0);
  if (!firstNonBlank) return null;
  const first = FIRST_LINE.exec(firstNonBlank.trim());
  if (!first || first[1].split(" - ").length < 3) return null;
  if (!BULLET.test(decoded)) return null;
  if (WITH_LINE.test(decoded)) return null;
  return decoded;
}

interface Header {
  name: string;
  faction_raw_name: string | null;
  detachment_raw_name: string | null;
  total_reported: number | null;
}

function parseFirstLine(line: string): Header | null {
  const m = FIRST_LINE.exec(line.trim());
  if (!m) return null;
  const parts = m[1].split(" - ").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  // `<list name> - <faction> - <detachment>`; the name is everything before
  // the trailing two segments so faction names with hyphens stay intact only
  // when ListForge itself doesn't insert ` - ` (it doesn't).
  return {
    name: parts.slice(0, parts.length - 2).join(" - "),
    faction_raw_name: parts[parts.length - 2],
    detachment_raw_name: parts[parts.length - 1],
    total_reported: Number.parseInt(m[2], 10),
  };
}

interface Bullet {
  indent: number;
  count: number | null;
  text: string;
}

interface UnitAcc {
  raw_name: string;
  displayed_pts: number | null;
  is_character: boolean;
  bullets: Bullet[];
}

function finishUnit(acc: UnitAcc): ParsedUnit {
  const topIndent = acc.bullets.length
    ? Math.min(...acc.bullets.map((b) => b.indent))
    : 0;

  const wargear = new Map<string, number>();
  let model_count = 0;
  let is_warlord = false;
  let enhancement_raw_name: string | null = null;

  const addWargear = (raw_name: string, count: number): void => {
    wargear.set(raw_name, (wargear.get(raw_name) ?? 0) + count);
  };

  for (let i = 0; i < acc.bullets.length; i += 1) {
    const b = acc.bullets[i];

    // Child bullet: a model group's weapon. ListForge child counts are
    // squad-wide totals; a count-less child is a single item.
    if (b.indent > topIndent) {
      addWargear(b.text, b.count ?? 1);
      continue;
    }

    // Top-level annotations.
    if (b.count === null) {
      if (b.text === WARLORD_MARKER) {
        is_warlord = true;
        continue;
      }
      if (b.text.startsWith(ENHANCEMENT_PREFIX)) {
        if (enhancement_raw_name === null) {
          enhancement_raw_name = b.text.slice(ENHANCEMENT_PREFIX.length).trim();
        }
        continue;
      }
    }

    // Top-level entry: a model group when it has child bullets beneath it,
    // otherwise plain wargear. Either way a missing `Nx` count means 1.
    const next = acc.bullets[i + 1];
    if (next && next.indent > b.indent) {
      model_count += b.count ?? 1;
    } else {
      addWargear(b.text, b.count ?? 1);
    }
  }

  if (model_count === 0) model_count = 1;

  return {
    raw_name: acc.raw_name,
    is_character: acc.is_character,
    model_count,
    points: acc.displayed_pts,
    is_warlord,
    enhancement_raw_name,
    // ListForge's text export reports no enhancement cost, so the unit's
    // displayed points stay as-is and no enhancement points are claimed.
    enhancement_points: null,
    wargear: [...wargear].map(
      ([raw_name, count]): ParsedWargear => ({ raw_name, count }),
    ),
  };
}

export const listForgeTextAdapter: FormatAdapter = {
  id: "listforge-text",

  matches(decoded: unknown): boolean {
    return isListForgeText(decoded) !== null;
  },

  parse(decoded: unknown): ParsedRoster {
    const text = isListForgeText(decoded);
    if (text === null) {
      throw new Error("listforge-text: input is not a ListForge text export");
    }

    const lines = text.split(/\r?\n/);
    let header: Header | null = null;
    const units: ParsedUnit[] = [];
    let current: UnitAcc | null = null;
    let sectionIsCharacter = false;

    const finalize = (): void => {
      if (current) {
        units.push(finishUnit(current));
        current = null;
      }
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (!header) {
        header = parseFirstLine(line);
        if (header) continue;
      }

      const bulletMatch = BULLET_LINE.exec(raw);
      if (bulletMatch) {
        if (current) {
          const rest = bulletMatch[2];
          const nx = NX_PREFIX.exec(rest);
          current.bullets.push({
            indent: bulletMatch[1].length,
            count: nx ? Number.parseInt(nx[1], 10) : null,
            text: (nx ? nx[2] : rest).trim(),
          });
        }
        continue;
      }

      if (SECTION_HEADER.test(line)) {
        finalize();
        sectionIsCharacter = CHARACTER_SECTIONS.has(
          line.slice(0, -1).trim().toLowerCase(),
        );
        continue;
      }

      const unitMatch = UNIT_HEADER.exec(line);
      if (unitMatch) {
        finalize();
        current = {
          raw_name: unitMatch[1].trim(),
          displayed_pts: Number.parseInt(unitMatch[2], 10),
          is_character: sectionIsCharacter,
          bullets: [],
        };
      }
    }
    finalize();

    if (!header) {
      throw new Error("listforge-text: missing ListForge header line");
    }

    let total_computed = 0;
    for (const u of units) total_computed += u.points ?? 0;

    // Like the GW export, ListForge text reports only the army total — use it
    // as the declared limit so battle-size inference stays round-trippable.
    const declared_limit = header.total_reported;

    return {
      name: header.name,
      generated_by: "List Forge",
      faction_raw_name: header.faction_raw_name,
      detachment_raw_name: header.detachment_raw_name,
      battle_size_raw: inferBattleSizeRaw(declared_limit),
      declared_limit,
      total_reported: header.total_reported,
      total_computed,
      units,
      multi_force: false,
    };
  },
};

// Internals re-exported for unit tests.
export const _internals = {
  isListForgeText,
  parseFirstLine,
};
