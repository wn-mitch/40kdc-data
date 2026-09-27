/**
 * stratagems.ts — Phase 6: reconcile stratagem numeric/structural fields against
 * the GW MFM dump.
 *
 * The repo stratagem id is `detachmentScopedId(name, detachment-name)` (bare
 * `nameToId(name)` for the 11 core stratagems with no detachment), which is how
 * the dump's (stratagem, detachment) pair slugs — so matching is a direct id
 * lookup, mirroring enhancements (Phase 3A).
 *
 * APPLIED from the dump — only fields backed by a reliable FIRST-CLASS column:
 *   - cp_cost   ← `cpCost`   (authoritative numeric).
 *   - player_turn ← `key`    (`yourTurn`/`eitherPlayer`/`opponentsTurn`). A
 *                   first-class stratagem attribute that the English `whenRules`
 *                   corroborate in every spot check (e.g. "Command phase." ⇒
 *                   yourTurn; "Your Shooting phase or the Fight phase." ⇒
 *                   eitherPlayer, because the Fight phase falls in both turns).
 *                   Overwrites the ~47 authored rows that disagree — the dump is
 *                   authoritative and demonstrably more correct on those.
 *   - type      ← `category` (`battleTactic`→battle-tactic, …). FILL-ONLY: set it
 *                   only where the repo left the OPTIONAL type unset (~31); never
 *                   blanks an authored type on the ~34 rows the dump leaves null
 *                   (11e packs omit the printed type for new detachments), and it
 *                   never conflicts where both are present (0 disagreements).
 *   - category  ← presence of `detachmentId` (core vs detachment). Idempotent
 *                   set/confirm; already 100% consistent, so it drifts only if a
 *                   future dump upload introduces a mis-scoped record.
 *
 * `game_version` is left as-authored: the structural fields above are keyed off
 * the dump but `timing` is not, so stamping launch would over-claim.
 *
 * DERIVED FOR REVIEW ONLY (reported, NOT written): `phases`, parsed from
 * `localisations.en.whenRules`. The structured `stratagem_phase` table is NOT
 * used as a source: it is a buggy denormalized index whose rows routinely
 * disagree with the card's own whenRules — e.g. Insane Bravery ("Command phase")
 * is tagged chargePhase, Holy Avarice ("Your Shooting phase") is tagged
 * commandPhase, and Scriptural Prognosis ("opponent's Shooting phase or the
 * Fight phase") is tagged with all five phases. Writing from it would regress
 * careful authored data, so authored phases win and the prose parse is surfaced
 * for manual triage only. The prose itself is never stored here (it routes to the
 * out-of-repo store in 3B).
 *
 * NOT touched: `timing` (once-per-*) — the dump has no structured field for it.
 */
import * as fs from "fs";
import * as path from "path";
import { nameToId, detachmentScopedId } from "../converters/id-generator.js";
import { MfmDump, type DetachmentRow, type StratagemRow } from "./loader.js";
import { readJsonArray, CORE_DIR } from "./repo-files.js";
import { repoDirs, repoDirForFactionName } from "./faction-map.js";
import type { StagedWrite } from "./apply.js";
import { type GoldenMode, modeOfPublication, mergeMode } from "./game-mode.js";



type Phase = "command" | "movement" | "shooting" | "charge" | "fight";
type PlayerTurn = "your-turn" | "opponent-turn" | "either";
type StratType = "battle-tactic" | "strategic-ploy" | "epic-deed" | "wargear";
type StratCategory = "core" | "detachment";

/** Dump `stratagem.key` → the repo `player_turn` enum. A first-class column. */
const KEY_TO_TURN: Record<string, PlayerTurn> = {
  yourTurn: "your-turn",
  eitherPlayer: "either",
  opponentsTurn: "opponent-turn",
};
/** Dump `stratagem.category` → the repo (optional) `type` enum. `null` category
 *  (11e packs omit the printed type for new detachments) maps to no type. */
const CATEGORY_TO_TYPE: Record<string, StratType> = {
  battleTactic: "battle-tactic",
  strategicPloy: "strategic-ploy",
  epicDeed: "epic-deed",
  wargear: "wargear",
};

interface StratRecord {
  id: string;
  name: string;
  cp_cost: number;
  type?: StratType;
  category?: StratCategory;
  phases?: Phase[];
  player_turn?: PlayerTurn;
  timing?: string;
  game_version?: { edition: string; dataslate: string };
  [k: string]: unknown;
}

export interface StratagemCanon {
  cp_cost: number | null;
  /** Prose-derived phases — REVIEW ONLY (stratagem_phase is unreliable; see header). */
  phases_review: Phase[] | null;
  /** From `stratagem.key` — APPLIED. */
  player_turn: PlayerTurn | null;
  /** From `stratagem.category` — FILL-ONLY (optional field). */
  type: StratType | null;
  /** From `detachmentId` presence — SET/confirm. */
  category: StratCategory;
}

/** Strip BattleScribe-style inline tags (`<b>…</b>`, `<k>…</k>`) to plain text. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const PHASE_NAMES: Phase[] = ["command", "movement", "shooting", "charge", "fight"];
const PHASE_WORD = `(?:${PHASE_NAMES.join("|")})`;
/** A run of phase names sharing one "phase(s)": "movement or your charge phase",
 * "shooting phase or the fight phase" (two runs), "command phase". */
const PHASE_RUN = new RegExp(
  `(?:(excluding) (?:the )?)?(${PHASE_WORD}(?:\\s*(?:,|or|and)\\s*(?:your (?:opponent(?:'|’)s )?|the )?${PHASE_WORD})*)\\s+phases?\\b`,
  "g",
);

/** The phases a when line names, in the canonical order. "Any phase" is every phase;
 * "excluding the X phase" takes X out. */
export function phasesOf(text: string): Phase[] {
  const named = new Set<Phase>();
  const excluded = new Set<Phase>();
  for (const m of text.matchAll(PHASE_RUN)) {
    for (const p of m[2]!.match(new RegExp(PHASE_WORD, "g")) ?? []) (m[1] ? excluded : named).add(p as Phase);
  }
  if (/\b(any|each|every) phase\b/.test(text)) PHASE_NAMES.forEach((p) => named.add(p));
  return PHASE_NAMES.filter((p) => named.has(p) && !excluded.has(p));
}

/** Derive { phases, player_turn } from a stratagem's whenRules prose. Either field
 * is null when the prose doesn't determine it (→ keep the authored value). */
export function deriveTrigger(whenRulesRaw: string | undefined | null): {
  phases: Phase[] | null;
  player_turn: PlayerTurn | null;
} {
  if (!whenRulesRaw) return { phases: null, player_turn: null };
  const t = stripTags(whenRulesRaw).toLowerCase();

  const phases = phasesOf(t);

  // turn ownership: "your opponent's <phase>" → opponent; "your <phase>" → yours;
  // both present, or "any/either" → either; nothing decisive → null.
  const hasOpponent = /opponent('|’)s\b|opponent's\b/.test(t) || /\bopponent(’|')?s? \w*\s*phase/.test(t);
  const hasYours = /\byour (?!opponent)/.test(t);
  let player_turn: PlayerTurn | null = null;
  if (/\b(any|either)\b/.test(t) && phases.length) player_turn = "either";
  else if (hasOpponent && hasYours) player_turn = "either";
  else if (hasOpponent) player_turn = "opponent-turn";
  else if (hasYours) player_turn = "your-turn";

  return { phases: phases.length ? phases : null, player_turn };
}

/** Repo id for a dump stratagem: `detachmentScopedId` when detachment-scoped, bare
 *  `nameToId` for the coreless few. Null if the name can't be slugged. The single
 *  id rule shared by {@link buildStratCanon} and {@link stratagemInventory}. */
export function stratagemRepoId(dump: MfmDump, s: StratagemRow): string | null {
  const name = dump.enName(s);
  if (!name) return null;
  try {
    if (s.detachmentId) {
      const dn = dump.enName(dump.byId("detachment").get(s.detachmentId));
      if (!dn) return null;
      return detachmentScopedId(name, dn);
    }
    return nameToId(name);
  } catch {
    return null;
  }
}

/** Stratagem repo-id → canon fields from the dump: cp_cost + first-class
 *  player_turn/type/category (applied) + prose-derived phases (review only). */
export function buildStratCanon(dump: MfmDump): Map<string, StratagemCanon> {
  const m = new Map<string, StratagemCanon>();
  for (const s of dump.table("stratagem")) {
    const id = stratagemRepoId(dump, s);
    if (!id) continue;
    const when = (s.localisations?.en as { whenRules?: string } | undefined)?.whenRules;
    const { phases } = deriveTrigger(when); // phases only — player_turn now from `key`
    const cp = s.cpCost != null ? parseInt(String(s.cpCost), 10) : null;
    const row = s as { key?: string; category?: string | null; detachmentId?: string | null };
    m.set(id, {
      cp_cost: Number.isFinite(cp as number) ? (cp as number) : null,
      phases_review: phases,
      player_turn: (row.key && KEY_TO_TURN[row.key]) || null,
      type: (row.category && CATEGORY_TO_TYPE[row.category]) || null,
      category: row.detachmentId ? "detachment" : "core",
    });
  }
  return m;
}

/** dir → detachment-scoped stratagem repo-ids (the golden's `stratagems` category).
 *  Routed by the stratagem's detachment faction. The coreless stratagems (no
 *  detachmentId) live in the shared root store, so they are covered by the repo-id
 *  reader's root∪dir union rather than carried per-dir here. */
export function stratagemInventory(dump: MfmDump): Map<string, Map<string, GoldenMode>> {
  const out = new Map<string, Map<string, GoldenMode>>();
  for (const s of dump.table("stratagem")) {
    if (!s.detachmentId) continue;
    const id = stratagemRepoId(dump, s);
    if (!id) continue;
    const fkId = dump.factionKeywordOfDetachment(s.detachmentId);
    const fkName = fkId ? dump.enName(dump.byId("faction_keyword").get(fkId)) : undefined;
    const dir = repoDirForFactionName(fkName);
    if (!dir) continue;
    const m = out.get(dir) ?? out.set(dir, new Map<string, GoldenMode>()).get(dir)!;
    m.set(id, mergeMode(m.get(id), modeOfPublication(dump, s.publicationId)));
  }
  return out;
}

export interface DirStratResult {
  dir: string;
  matched: number;
  cpChanged: { id: string; from: number; to: number }[];
  /** player_turn ← key: APPLIED. */
  turnApplied: { id: string; from?: PlayerTurn; to: PlayerTurn }[];
  /** type ← category: FILLED (authored was unset). */
  typeFilled: { id: string; to: StratType }[];
  /** type ← category: both present and disagree — surfaced, NOT overwritten. */
  typeConflict: { id: string; from: string; to: StratType }[];
  /** category (core/detachment) ← detachmentId presence: SET/confirm. */
  categoryChanged: { id: string; from: string; to: StratCategory }[];
  /** phases prose-derived vs authored — REVIEW ONLY, never written. */
  phasesReview: { id: string; from: Phase[]; to: Phase[] }[];
  unmatchedRepo: string[];
}
export interface StratReport {
  dirs: DirStratResult[];
  newInDump: number;
  staged: StagedWrite[];
}


function sameArr(a: Phase[] = [], b: Phase[] = []): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export function runStratagems(dump: MfmDump, write: boolean): StratReport {
  const canon = buildStratCanon(dump);
  const matchedIds = new Set<string>();
  const dirs: DirStratResult[] = [];
  const staged: StagedWrite[] = [];

  // include the global core stratagems file alongside the per-faction ones
  const targets: string[] = ["", ...[...repoDirs()].sort()];

  for (const dir of targets) {
    const p = dir ? path.join(CORE_DIR, dir, "stratagems.json") : path.join(CORE_DIR, "stratagems.json");
    if (!fs.existsSync(p)) continue;
    const strats = readJsonArray<StratRecord>(p);
    const res: DirStratResult = {
      dir: dir || "(core)",
      matched: 0,
      cpChanged: [],
      turnApplied: [],
      typeFilled: [],
      typeConflict: [],
      categoryChanged: [],
      phasesReview: [],
      unmatchedRepo: [],
    };
    let dirty = false;
    for (const s of strats) {
      const c = canon.get(s.id);
      if (!c) {
        res.unmatchedRepo.push(s.id);
        continue;
      }
      matchedIds.add(s.id);
      res.matched++;

      if (c.cp_cost != null && s.cp_cost !== c.cp_cost) {
        res.cpChanged.push({ id: s.id, from: s.cp_cost, to: c.cp_cost });
        s.cp_cost = c.cp_cost; // mutate in BOTH modes; rehearsal validates the result
        dirty = true;
      }

      // player_turn ← stratagem.key (first-class, whenRules-corroborated): APPLIED.
      if (c.player_turn && s.player_turn !== c.player_turn) {
        res.turnApplied.push({ id: s.id, from: s.player_turn, to: c.player_turn });
        s.player_turn = c.player_turn;
        dirty = true;
      }

      // type ← stratagem.category: FILL-ONLY. Set the optional field where authored
      // is unset; never blank an authored type when the dump omits the category;
      // surface (never overwrite) the rare both-present disagreement.
      if (c.type && s.type == null) {
        res.typeFilled.push({ id: s.id, to: c.type });
        s.type = c.type;
        dirty = true;
      } else if (c.type && s.type !== c.type) {
        res.typeConflict.push({ id: s.id, from: String(s.type), to: c.type });
      }

      // category (core/detachment) ← detachmentId presence: idempotent set/confirm.
      if (s.category !== c.category) {
        res.categoryChanged.push({ id: s.id, from: String(s.category), to: c.category });
        s.category = c.category;
        dirty = true;
      }

      // phases: prose-derived, REVIEW ONLY — reported, never written. stratagem_phase
      // is a buggy denormalized index (see header), so authored phases win.
      if (c.phases_review && !sameArr(s.phases, c.phases_review)) {
        res.phasesReview.push({ id: s.id, from: s.phases ?? [], to: c.phases_review });
      }
      // game_version intentionally left as-authored: timing isn't dump-verified,
      // so flipping provisional→launch would over-claim.
    }
    if (dirty) staged.push({ path: p, value: strats });
    dirs.push(res);
  }

  const newInDump = [...canon.keys()].filter((id) => !matchedIds.has(id)).length;
  return { dirs, newInDump, staged };
}

export function buildStratReport(report: StratReport, write: boolean): string {
  const { dirs, newInDump } = report;
  const sum = (f: (d: DirStratResult) => number) => dirs.reduce((a, d) => a + f(d), 0);
  const L: string[] = [];
  L.push(`# MFM stratagems — ${write ? "APPLIED" : "DRY RUN"}`);
  L.push("");
  L.push("APPLIED (first-class dump columns): `cp_cost` ← cpCost, `player_turn` ← key,");
  L.push("`type` ← category (fill-only), `category` ← detachmentId presence.");
  L.push("REVIEW ONLY (not written): `phases`, prose-derived — the structured");
  L.push("`stratagem_phase` table is a buggy index (Insane Bravery→charge, Holy");
  L.push("Avarice→command, Scriptural Prognosis→all-five), so authored phases win.");
  L.push("`timing` + `game_version` left authored.");
  L.push("");
  L.push("| Dir | Matched | cp | turn | type fill | type conflict | category | phases (review) | repo-only |");
  L.push("|---|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const d of dirs.filter((d) => d.matched || d.unmatchedRepo.length)) {
    L.push(
      `| ${d.dir} | ${d.matched} | ${d.cpChanged.length} | ${d.turnApplied.length} | ${d.typeFilled.length} | ${d.typeConflict.length} | ${d.categoryChanged.length} | ${d.phasesReview.length} | ${d.unmatchedRepo.length} |`
    );
  }
  L.push(
    `| **TOTAL** | **${sum((d) => d.matched)}** | **${sum((d) => d.cpChanged.length)}** | **${sum((d) => d.turnApplied.length)}** | **${sum((d) => d.typeFilled.length)}** | **${sum((d) => d.typeConflict.length)}** | **${sum((d) => d.categoryChanged.length)}** | **${sum((d) => d.phasesReview.length)}** | **${sum((d) => d.unmatchedRepo.length)}** |`
  );
  L.push("");
  for (const d of dirs) {
    if (
      !d.cpChanged.length &&
      !d.turnApplied.length &&
      !d.typeFilled.length &&
      !d.typeConflict.length &&
      !d.categoryChanged.length &&
      !d.phasesReview.length
    )
      continue;
    L.push(`## ${d.dir}`);
    if (d.cpChanged.length) {
      L.push("", "**CP changes (applied):**");
      d.cpChanged.forEach((c) => L.push(`- ${c.id}: ${c.from} → ${c.to}`));
    }
    if (d.turnApplied.length) {
      L.push("", "**Player-turn ← key (applied):**");
      d.turnApplied.forEach((c) => L.push(`- ${c.id}: ${c.from ?? "—"} → ${c.to}`));
    }
    if (d.typeFilled.length) {
      L.push("", "**Type ← category (filled — was unset):**");
      d.typeFilled.forEach((c) => L.push(`- ${c.id}: → ${c.to}`));
    }
    if (d.typeConflict.length) {
      L.push("", "**Type — authored vs dump category (surfaced, NOT overwritten):**");
      d.typeConflict.forEach((c) => L.push(`- ${c.id}: ${c.from} vs ${c.to}`));
    }
    if (d.categoryChanged.length) {
      L.push("", "**Category core/detachment (set):**");
      d.categoryChanged.forEach((c) => L.push(`- ${c.id}: ${c.from} → ${c.to}`));
    }
    if (d.phasesReview.length) {
      L.push("", "**Phases — authored vs prose-derived (review only, NOT applied):**");
      d.phasesReview.forEach((c) => L.push(`- ${c.id}: [${c.from.join(",")}] vs [${c.to.join(",")}]`));
    }
    L.push("");
  }
  L.push(`Stratagems in dump with no repo match (author via faction-pack flow): ${newInDump}`);
  L.push("");
  return L.join("\n") + "\n";
}
