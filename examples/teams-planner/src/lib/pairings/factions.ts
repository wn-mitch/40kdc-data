/**
 * Faction card styling: the symbol + livery palette behind each army card on
 * the pairing mat. Icons are monochrome silhouettes in
 * `public/faction-icons/<id>.svg` (see the NOTICE there — fan recreations of
 * GW marks, excluded from the repo's license grants), tinted at render time
 * via CSS mask so one file serves every livery.
 *
 * `color` is the accent (glyph tint, card border); `colorDim` the card body
 * tone — both authored as livery hexes (precedent: army-assist's
 * factionThemeMap nearest-fit table). Unknown factions walk
 * `parent_faction_id` (successor chapters inherit, then may override) and
 * finally fall back to a neutral steel.
 */
import { ds } from "../dataset";

export interface FactionStyle {
  /** Public URL of the silhouette SVG (CSS-mask source). */
  icon: string;
  /** Livery accent: glyph tint, border, highlights. */
  color: string;
  /** Card-body tone (a dark companion of the accent). */
  colorDim: string;
}

const icon = (id: string) => `${import.meta.env.BASE_URL}faction-icons/${id}.svg`;

/** Neutral steel for factionless players / unknown ids. */
export const NEUTRAL_STYLE: FactionStyle = {
  icon: icon("adeptus-astartes"),
  color: "#9ba1ad",
  colorDim: "#23262c",
};

/** id → [accent, body]; icon file shares the faction id. */
const LIVERY: Record<string, [string, string]> = {
  // Imperium
  "adeptus-astartes": ["#4e8fd0", "#16273a"], // codex cobalt
  ultramarines: ["#3f74c4", "#132441"],
  "blood-angels": ["#d03a32", "#3a1210"],
  "dark-angels": ["#2e7d4f", "#0f261a"],
  "space-wolves": ["#7da7bd", "#1d2c35"],
  "black-templars": ["#cfcadb", "#191921"], // black livery, bone trim
  "imperial-fists": ["#e8b923", "#3a2f0d"],
  "crimson-fists": ["#27418f", "#101a36"],
  "iron-hands": ["#8e9499", "#1d2023"],
  salamanders: ["#3f9e57", "#11301c"],
  "white-scars": ["#e6e2d8", "#2a2a26"],
  "raven-guard": ["#7c7f8a", "#15161b"],
  deathwatch: ["#a7adb8", "#16181d"],
  "grey-knights": ["#b7c0cc", "#23282f"],
  "adepta-sororitas": ["#c43a4b", "#2e1015"],
  "adeptus-custodes": ["#d9a52e", "#382a0c"],
  "adeptus-mechanicus": ["#c2543a", "#33150e"],
  "astra-militarum": ["#8b9362", "#23261a"],
  "imperial-knights": ["#3b6fb0", "#15233a"],
  "agents-of-the-imperium": ["#9a5fb5", "#27142f"],
  // Chaos
  "chaos-space-marines": ["#b03540", "#2c0e12"],
  "death-guard": ["#9aa14a", "#272a13"],
  "thousand-sons": ["#3aa7a3", "#0f2c2b"],
  "world-eaters": ["#c23838", "#330e0e"],
  "emperors-children": ["#c75dae", "#33152c"],
  "chaos-daemons": ["#a8403a", "#2b1110"],
  "chaos-knights": ["#6c6f7c", "#15161c"],
  // Xenos
  aeldari: ["#4fb6c9", "#122e33"],
  drukhari: ["#3e8d7f", "#102622"],
  necrons: ["#56c98e", "#123325"],
  orks: ["#6ba83a", "#1d2c10"],
  tyranids: ["#9359b8", "#26152f"],
  "genestealer-cults": ["#b56191", "#2e1726"],
  "tau-empire": ["#d98f3a", "#36240e"],
  "leagues-of-votann": ["#c9a35a", "#322817"],
};

const styleCache = new Map<string, FactionStyle>();

/**
 * Style for a faction id: exact match, else the `parent_faction_id` walk
 * (e.g. a successor chapter without its own row inherits its parent's),
 * else {@link NEUTRAL_STYLE}.
 */
export function factionStyle(factionId: string | null | undefined): FactionStyle {
  if (!factionId) return NEUTRAL_STYLE;
  const hit = styleCache.get(factionId);
  if (hit) return hit;
  let id: string | null | undefined = factionId;
  let style = NEUTRAL_STYLE;
  for (let hops = 0; id && hops < 4; hops++) {
    const livery = LIVERY[id];
    if (livery) {
      style = { icon: icon(id), color: livery[0], colorDim: livery[1] };
      break;
    }
    id = ds.factions.get(id)?.raw.parent_faction_id;
  }
  styleCache.set(factionId, style);
  return style;
}
