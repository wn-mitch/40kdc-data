/**
 * Rewrites outside `data/`: the vocabulary overrides (keys name a record by file and id), context-
 * free JSON (conformance, test fixtures, example data), code literals (TS/Rust/Python/Go tests,
 * describer label tables, gen-conformance, examples), and the share registry.
 *
 * Context-free ids resolve only when every dir agrees on one target; anything else is reported,
 * never guessed. Code literals are rewritten only when the id is unambiguous and not also a
 * schema enum literal or a tag/region/pool label (D8).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { applyReplacements, type Replacement } from "../../round6/json-spans.js";
import { DESIGNATION_IDS } from "../../translate/designations.js";
import { editObjectKeys } from "./json-edit.js";
import type { MirrorPlan, Undecided } from "./plan.js";
import type { FileChange, RewriteLog } from "./project.js";
import { findRefs } from "./refs.js";
import type { RepoSnapshot } from "./repo.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const posix = (p: string): string => p.split(path.sep).join("/");

type EntityKind = "ability" | "stratagem" | "enhancement";

/** Context-free keys (beyond the DSL shapes) that carry ids, by the kind they name. */
const KEYED: Record<string, EntityKind> = {
  abilityId: "ability",
  ability_id: "ability",
  ability_ids: "ability",
  detachment_rule_id: "ability",
  detachment_rule_ids: "ability",
  faction_rule_ids: "ability",
  stratagemId: "stratagem",
  stratagem_id: "stratagem",
  stratagem_ids: "stratagem",
  enhancement: "enhancement",
  enhancementId: "enhancement",
  enhancement_id: "enhancement",
  enhancement_ids: "enhancement",
  enhancements: "enhancement",
};

interface Hit {
  path: (string | number)[];
  value: string;
  kind: EntityKind;
}

function keyedRefs(node: unknown, base: (string | number)[] = []): Hit[] {
  const out: Hit[] = [];
  const walk = (v: unknown, p: (string | number)[]): void => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, [...p, i]));
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const kind = KEYED[k];
      if (kind && typeof x === "string") out.push({ path: [...p, k], value: x, kind });
      else if (kind && Array.isArray(x)) x.forEach((s, i) => typeof s === "string" && out.push({ path: [...p, k, i], value: s, kind }));
      if (k === "source_id" && typeof x === "string") {
        const t = (v as Record<string, unknown>).source_type;
        out.push({ path: [...p, k], value: x, kind: t === "stratagem" ? "stratagem" : t === "enhancement" ? "enhancement" : "ability" });
      }
      walk(x, [...p, k]);
    }
  };
  walk(node, base);
  return out;
}

export type Verdict = { to: string } | { dead: true } | { ambiguous: (string | null)[] } | null;

/** A context-free id's fate: rewritten, dead, ambiguous, or unchanged/unknown (null). */
export function verdict(plan: MirrorPlan, id: string, kind: EntityKind): Verdict {
  const g = plan.resolveGlobal(id, kind);
  if (!g) return null;
  if ("ambiguous" in g) return { ambiguous: g.ambiguous };
  if (g.to === null) return { dead: true };
  return g.to === id ? null : { to: g.to };
}

/** Files under `root` matching `exts`, skipping build output and generated bundles. */
function walkFiles(root: string, exts: readonly string[], skip: (rel: string) => boolean, base = root): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, e.name);
    const rel = posix(path.relative(base, abs));
    if (skip(rel)) continue;
    if (e.isDirectory()) out.push(...walkFiles(abs, exts, skip, base));
    else if (exts.some((x) => e.name.endsWith(x)) && statSync(abs).size < 8_000_000) out.push(abs);
  }
  return out.sort(cmp);
}

const SKIP_DIRS = /(^|\/)(node_modules|dist|build|target|\.svelte-kit|\.wrangler|__pycache__|\.venv|coverage)(\/|$)/;
const GENERATED = /(generated|_bundle\.json$|bundle\.json$|share_registry\.json$|\/schemas\/|registry\.generated|\.min\.)/;

/** A rewrite held back from a skipped dir, for its owner to apply. */
export interface PendingRewrite {
  file: string;
  old: string;
  new: string;
  /** A JSON path (`a/0/b`) or a line number. */
  location: string;
}

export interface OutsideOptions {
  /** Repo-relative dirs whose files are not rewritten; their rewrites are returned as pending. */
  skipDirs?: readonly string[];
  /** The mirror's projected `data/` texts by absolute path. */
  projected?: ReadonlyMap<string, string>;
}

export interface OutsideResult {
  files: FileChange[];
  pending: PendingRewrite[];
  log: RewriteLog[];
  undecided: Undecided[];
}

/**
 * Strings that must never be rewritten in code: schema enum/const literals and data labels (D8),
 * read from the data as the mirror leaves it (`projected`), so a label the mirror removes does not
 * shield a literal on this run and stop shielding it on the next.
 */
export function stoplist(root: string, projected: ReadonlyMap<string, string> = new Map()): Set<string> {
  const read = (f: string): unknown => JSON.parse(projected.get(f) ?? readFileSync(f, "utf8"));
  const stop = new Set<string>();
  const collect = (v: unknown, labelKey = false): void => {
    if (Array.isArray(v)) return v.forEach((x) => collect(x, labelKey));
    if (typeof v === "string") {
      if (labelKey) {
        stop.add(v);
        // A pool's describer keys on its base name ("blood-tithe-pool" → "blood-tithe").
        if (v.endsWith("-pool")) stop.add(v.slice(0, -"-pool".length));
      }
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      collect(x, k === "enum" || k === "const" || /^(region_id|tag|tags|designation|label|pool|pool_id|marker|stance_id|option_id|option)$/.test(k));
    }
  };
  for (const f of walkFiles(path.join(root, "schemas"), [".json"], () => false)) collect(read(f));
  const enrich = new Set([...walkFiles(path.join(root, "data", "enrichment"), [".json"], (r) => r.startsWith("_")), ...[...projected.keys()].filter((k) => k.includes(`${path.sep}enrichment${path.sep}`) && !/[\\/]_[^\\/]*[\\/]/.test(k))]);
  for (const f of enrich) collect(read(f));
  // Ids of every other entity kind (a faction, unit or detachment id can equal an ability id).
  for (const f of walkFiles(path.join(root, "data", "core"), [".json"], (r) => r.startsWith("_") || /(^|\/)(stratagems|enhancements)\.json$/.test(r))) {
    const v: unknown = read(f);
    if (Array.isArray(v)) for (const e of v) if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string") stop.add((e as { id: string }).id);
  }
  // Designations are their own namespace (D8), even where one shares a helper record's name.
  for (const d of DESIGNATION_IDS) stop.add(d);
  return stop;
}

export function projectOutside(plan: MirrorPlan, snap: RepoSnapshot, opts: OutsideOptions = {}): OutsideResult {
  const root = snap.root;
  const files: FileChange[] = [];
  const pending: PendingRewrite[] = [];
  const skip = (opts.skipDirs ?? []).map((d) => d.replace(/\/+$/, ""));
  const skipped = (relPath: string): boolean => skip.some((d) => relPath === d || relPath.startsWith(`${d}/`));
  const log: RewriteLog[] = [];
  const undecided: Undecided[] = [];
  const rel = (abs: string): string => posix(path.relative(root, abs));

  // ── vocab-overrides.json ────────────────────────────────────────────────────────────────
  const overridesAbs = path.join(root, "tools", "src", "round6", "vocab-overrides.json");
  if (existsSync(overridesAbs)) {
    const text = readFileSync(overridesAbs, "utf8");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const decisionOf = new Map(plan.records.map((d) => [`data/enrichment/${d.dir}/abilities.json#${d.oldId}`, d]));
    const keys = new Map<string, string | null>();
    const reps: Replacement[] = [];
    for (const key of Object.keys(obj)) {
      const m = /^(data\/enrichment\/[^/]+\/abilities\.json)#([^#]+)#(.*)$/.exec(key);
      if (!m) continue;
      const d = decisionOf.get(`${m[1]}#${m[2]}`);
      if (!d) continue;
      const dir = m[1]!.split("/")[2]!;
      if (!d.survivor || !d.newId) {
        keys.set(key, null);
        log.push({ file: rel(overridesAbs), where: key, from: key, to: null, kind: "override-dropped" });
        continue;
      }
      const target = plan.ids.byId.get(d.newId)!.faction;
      const next = `data/enrichment/${target}/abilities.json#${d.newId}#${m[3]}`;
      if (next !== key) {
        keys.set(key, next);
        log.push({ file: rel(overridesAbs), where: key, from: key, to: next, kind: "override-key" });
      }
      for (const ref of findRefs(obj[key], [key])) {
        const to = ref.kind === "stratagem" ? plan.resolveEntity("stratagem", dir, ref.value) : plan.resolve(dir, ref.value);
        if (to && to !== ref.value) {
          reps.push({ path: ref.path, value: to });
          log.push({ file: rel(overridesAbs), where: ref.path.join("/"), from: ref.value, to, kind: `override-${ref.shape}` });
        }
      }
    }
    const after = editObjectKeys(reps.length ? applyReplacements(text, reps) : text, keys);
    if (after !== text) files.push({ rel: rel(overridesAbs), abs: overridesAbs, exists: true, before: text, after });
  }

  // ── context-free JSON ───────────────────────────────────────────────────────────────────
  const jsonRoots = ["conformance", "tools/test/fixtures", "crates/wh40kdc/tests/fixtures", "python/tests", "go/testdata", "examples"];
  for (const r of jsonRoots) {
    for (const abs of walkFiles(path.join(root, r), [".json"], (x) => SKIP_DIRS.test(x) || GENERATED.test(x) || /package(-lock)?\.json$|tsconfig|wrangler/.test(x))) {
      const text = readFileSync(abs, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const seen = new Set<string>();
      const hits: Hit[] = [];
      for (const h of [...findRefs(parsed).map((f) => ({ path: f.path, value: f.value, kind: f.kind as EntityKind })), ...keyedRefs(parsed)]) {
        const k = JSON.stringify(h.path);
        if (!seen.has(k)) {
          seen.add(k);
          hits.push(h);
        }
      }
      const reps: Replacement[] = [];
      for (const h of hits) {
        const v = verdict(plan, h.value, h.kind);
        if (!v) continue;
        const where = `${rel(abs)}#${h.path.join("/")}`;
        if ("to" in v) {
          reps.push({ path: h.path, value: v.to });
          if (!skipped(rel(abs))) log.push({ file: rel(abs), where: h.path.join("/"), from: h.value, to: v.to, kind: `json-${h.kind}` });
        } else if ("dead" in v) undecided.push({ kind: "dead-literal", where, detail: `${h.kind} "${h.value}" names a removed record` });
        else undecided.push({ kind: "ambiguous-literal", where, detail: `${h.kind} "${h.value}" maps to ${v.ambiguous.map((x) => x ?? "(removed)").join(" | ")} depending on faction` });
      }
      if (!reps.length) continue;
      if (skipped(rel(abs))) {
        for (const r of reps) pending.push({ file: rel(abs), old: String(hits.find((h) => JSON.stringify(h.path) === JSON.stringify(r.path))?.value), new: String(r.value), location: r.path.join("/") });
        continue;
      }
      let after: string;
      try {
        after = applyReplacements(text, reps);
      } catch (e) {
        undecided.push({ kind: "json-splice", where: rel(abs), detail: (e as Error).message });
        continue;
      }
      files.push({ rel: rel(abs), abs, exists: true, before: text, after });
    }
  }

  // ── code literals ───────────────────────────────────────────────────────────────────────
  const stop = stoplist(root, opts.projected);
  const codeRoots: [string, string[]][] = [
    ["tools/src", [".ts"]],
    ["tools/test", [".ts"]],
    ["crates/wh40kdc/src", [".rs"]],
    ["crates/wh40kdc/tests", [".rs"]],
    ["python/src", [".py"]],
    ["python/tests", [".py"]],
    ["go", [".go"]],
    ["examples", [".ts", ".svelte", ".js"]],
  ];
  const literal = /(["'`])([a-z0-9][a-z0-9-]*[a-z0-9])\1/g;
  for (const [r, exts] of codeRoots) {
    for (const abs of walkFiles(path.join(root, r), exts, (x) => SKIP_DIRS.test(x) || GENERATED.test(x) || x.startsWith("mfm/mirror") || /^mfm-mirror[^/]*\.test\.ts$/.test(x))) {
      const text = readFileSync(abs, "utf8");
      let changed = false;
      const lines = text.split("\n");
      lines.forEach((line, n) => {
        lines[n] = line.replace(literal, (whole, q: string, id: string) => {
          if (!id.includes("-")) return whole;
          let v: Verdict = null;
          let kind: EntityKind = "ability";
          for (const k of ["ability", "stratagem", "enhancement"] as const) {
            v = verdict(plan, id, k);
            if (v) {
              kind = k;
              break;
            }
          }
          if (!v) return whole;
          const where = `${rel(abs)}:${n + 1}`;
          if ("to" in v) {
            // A rated core id ("scouts-6") folding into its rule loses the rating a code table keys on.
            if (id.startsWith(`${v.to}-`) && plan.ids.byId.get(v.to)?.ratings) {
              undecided.push({ kind: "code-literal-fold", where, detail: `"${id}" folds into "${v.to}" (its rating moves to the unit's {id, value}); left as is` });
              return whole;
            }
            // Two literals folding into one on a line (a lookup table's keys) would collide.
            if (new RegExp(`["'\`]${v.to}["'\`]`).test(line)) {
              undecided.push({ kind: "code-literal-collision", where, detail: `"${id}" would become "${v.to}", already on this line; left as is` });
              return whole;
            }
            if (stop.has(id)) {
              undecided.push({ kind: "code-literal-stoplisted", where, detail: `"${id}" would become "${v.to}" but is also a schema literal or data label; left as is` });
              return whole;
            }
            if (skipped(rel(abs))) {
              pending.push({ file: rel(abs), old: id, new: v.to, location: String(n + 1) });
              return whole;
            }
            changed = true;
            log.push({ file: rel(abs), where: String(n + 1), from: id, to: v.to, kind: `code-${kind}` });
            return `${q}${v.to}${q}`;
          }
          if ("dead" in v) undecided.push({ kind: "code-literal-dead", where, detail: `${kind} "${id}" names a removed record` });
          else undecided.push({ kind: "code-literal-ambiguous", where, detail: `${kind} "${id}" maps to ${v.ambiguous.map((x) => x ?? "(removed)").join(" | ")}` });
          return whole;
        });
      });
      if (changed) files.push({ rel: rel(abs), abs, exists: true, before: text, after: lines.join("\n") });
    }
  }

  // ── share registry ──────────────────────────────────────────────────────────────────────
  const regAbs = path.join(root, "data", "share-registry.json");
  if (existsSync(regAbs)) {
    const text = readFileSync(regAbs, "utf8");
    const reg = JSON.parse(text) as { version: number; kinds: Record<string, string[]>; aliases: Record<string, string>; tombstones: string[] };
    const current: Record<string, Set<string>> = {
      enhancement: new Set(plan.entities.filter((e) => e.kind === "enhancement" && e.newId).map((e) => e.newId!)),
      detachment: new Set(plan.entities.filter((e) => e.kind === "detachment" && e.newId).map((e) => e.newId!)),
    };
    const tomb = new Set(reg.tombstones);
    let appended = 0;
    const kinds = { ...reg.kinds };
    for (const [kind, ids] of Object.entries(current)) {
      const existing = reg.kinds[kind] ?? [];
      const have = new Set(existing);
      const added = [...ids].filter((id) => !have.has(id)).sort(cmp);
      appended += added.length;
      kinds[kind] = [...existing, ...added];
      // D6: renames are not aliased; the old slot is tombstoned.
      for (const id of existing) if (!ids.has(id) && !(id in reg.aliases)) tomb.add(id);
      if (added.length) log.push({ file: rel(regAbs), where: kind, from: "", to: `+${added.length}`, kind: "registry-append" });
    }
    const changed = appended > 0 || tomb.size !== reg.tombstones.length;
    if (changed) {
      const deadAliases = Object.entries(reg.aliases).filter(([, to]) => [...Object.keys(current)].some((k) => (reg.kinds[k] ?? []).includes(to) && !current[k]!.has(to)));
      if (deadAliases.length) {
        undecided.push({
          kind: "registry-alias-target-renamed",
          where: rel(regAbs),
          detail: `${deadAliases.length} aliases point at ids the mirror renames or removes (e.g. ${deadAliases.slice(0, 3).map(([f, t]) => `${f} → ${t}`).join(", ")}); D6 adds no alias, so those old tokens decode to tombstones`,
        });
      }
      const next = { version: reg.version + 1, kinds, aliases: reg.aliases, tombstones: [...tomb].sort(cmp) };
      files.push({ rel: rel(regAbs), abs: regAbs, exists: true, before: text, after: `${JSON.stringify(next, null, 2)}\n` });
      log.push({ file: rel(regAbs), where: "tombstones", from: String(reg.tombstones.length), to: String(tomb.size), kind: "registry-tombstones" });
    }
  }

  return { files, pending, log, undecided };
}
