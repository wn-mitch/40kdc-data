/**
 * Derive vehicle hull shapes from community Tabletop Simulator meshes.
 *
 * The meshes come from the TTS mods and saves on this machine: every 40k mod
 * stores its models as `Custom_Model` objects whose `CustomMesh.MeshURL` names
 * an OBJ file on Steam's user-content CDN and whose `Transform` scales it to
 * table inches. The meshes and their URLs stay in the ignored `_private/`
 * tree; only the traced outline enters the dataset.
 *
 * `tools/src/tts-hulls/hulls.json` pins each hull to one mesh by the SHA-256 of
 * its bytes plus the placement (scale, upright rotation) its mod uses, so
 * `build` is deterministic. It also lists every hull-based unit with no usable
 * mesh, and why; `build` fails if a hull-based unit is in neither list.
 *
 * Usage (from `tools/`):
 *   npm run tts-hulls -- catalog                  # scan TTS mods/saves -> _private/tts/catalog.json
 *   npm run tts-hulls -- candidates <regex>       # fetch and measure every upright mesh whose name matches
 *   npm run tts-hulls -- suggest src/tts-hulls/groups.json   # propose a pinned mesh per chassis (review, then edit hulls.json)
 *   npm run tts-hulls -- build [--write]          # dry run (validated) or write the shapes + unit links
 *
 * TTS is found at the platform default or `$TTS_DIR`.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { globSync } from "glob";
import type { HullShape } from "./generated.js";
import { applyWrites, type StagedWrite } from "./mfm/apply.js";
import { CORE_DIR, REPO_ROOT, readJsonArray } from "./mfm/repo-files.js";
import {
  DEFAULT_OUTLINE,
  hullShapeRecord,
  joinParts,
  meshOutline,
  parseObj,
  type Mesh,
  type Placement,
} from "./tts-hulls/outline.js";

const PRIVATE = path.join(REPO_ROOT, "_private");
const CATALOG = path.join(PRIVATE, "tts", "catalog.json");
const MESH_DIR = path.join(PRIVATE, "tts-meshes");
const MESH_INDEX = path.join(MESH_DIR, "index.json");
const MANIFEST = path.join(REPO_ROOT, "tools", "src", "tts-hulls", "hulls.json");
const OUTPUT = path.join(CORE_DIR, "hull-shapes.json");
const REPORT = path.join(REPO_ROOT, "data", "_audit", "hull-shapes.md");

type Vec3 = [number, number, number];

/** A child object attached to a model (turret, sponson, weapon), Transform local to the parent. */
interface CatalogChild {
  mesh_url: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

interface CatalogEntry {
  nickname: string;
  mesh_url: string;
  scale: Vec3;
  rotation: Vec3;
  children?: CatalogChild[];
  source: string;
}

/** A pinned child part of a hull's model; the same transform fields as {@link CatalogChild}. */
interface ManifestPart {
  mesh_sha256: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

interface HullEntry {
  id: string;
  name: string;
  /** The TTS object name the mesh was found under. */
  tts_nickname: string;
  mesh_sha256: string;
  scale: number;
  rot_x_deg: number;
  rot_z_deg: number;
  /** Child parts joined to the main mesh before projecting (turrets, sponsons, separate pieces of one model). */
  parts?: ManifestPart[];
  /** Top of a display base modelled into the mesh, in inches above its lowest point; everything below is dropped. */
  drop_below_in?: number;
  /** `<faction dir>/<unit id>` for every unit whose models use this hull. */
  units: string[];
  note?: string;
}

interface Manifest {
  game_version: { edition: string; dataslate: string };
  hulls: HullEntry[];
  no_mesh: { unit: string; reason: string }[];
}

function ttsDir(): string {
  if (process.env.TTS_DIR) return process.env.TTS_DIR;
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Tabletop Simulator");
  if (process.platform === "win32") return path.join(home, "Documents", "My Games", "Tabletop Simulator");
  return path.join(home, ".local", "share", "Tabletop Simulator");
}

// ---------------------------------------------------------------- catalog

function catalog(): void {
  const root = ttsDir();
  const files = [
    ...globSync("Mods/Workshop/**/*.json", { cwd: root, absolute: true }),
    ...globSync("Saves/**/*.json", { cwd: root, absolute: true }),
  ].sort();
  if (files.length === 0) throw new Error(`no TTS mods or saves under ${root} (set TTS_DIR)`);
  const seen = new Map<string, CatalogEntry>();
  const visit = (o: unknown, source: string): void => {
    if (Array.isArray(o)) {
      for (const x of o) visit(x, source);
      return;
    }
    if (!o || typeof o !== "object") return;
    const obj = o as Record<string, unknown>;
    const mesh = obj.CustomMesh as { MeshURL?: string } | undefined;
    if (mesh?.MeshURL) {
      const t = (obj.Transform ?? {}) as Record<string, number>;
      const nickname = String(obj.Nickname ?? "").trim();
      const children: CatalogChild[] = [];
      for (const c of (obj.ChildObjects ?? []) as Record<string, unknown>[]) {
        const cm = c.CustomMesh as { MeshURL?: string } | undefined;
        if (!cm?.MeshURL) continue;
        const ct = (c.Transform ?? {}) as Record<string, number>;
        children.push({
          mesh_url: cm.MeshURL,
          position: [ct.posX ?? 0, ct.posY ?? 0, ct.posZ ?? 0],
          rotation: [ct.rotX ?? 0, ct.rotY ?? 0, ct.rotZ ?? 0],
          scale: [ct.scaleX ?? 1, ct.scaleY ?? 1, ct.scaleZ ?? 1],
        });
      }
      const key = [nickname, mesh.MeshURL, t.scaleX, t.rotX, t.rotZ, JSON.stringify(children)].join("\u0000");
      if (!seen.has(key)) {
        seen.set(key, {
          nickname,
          mesh_url: mesh.MeshURL,
          scale: [t.scaleX ?? 1, t.scaleY ?? 1, t.scaleZ ?? 1],
          rotation: [t.rotX ?? 0, t.rotY ?? 0, t.rotZ ?? 0],
          ...(children.length ? { children } : {}),
          source,
        });
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") visit(v, source);
      // Tools such as ForceOrg's model tiles keep spawnable objects as JSON strings inside Lua.
      else if ((k === "LuaScript" || k === "LuaScriptState") && typeof v === "string" && v.includes("MeshURL")) {
        for (const m of v.matchAll(/\[\[(\{[\s\S]*?\})\]\]/g)) {
          try {
            visit(JSON.parse(m[1]), source);
          } catch {
            // Not an object literal; skip it.
          }
        }
      }
    }
  };
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    visit(parsed, path.relative(root, f));
  }
  fs.mkdirSync(path.dirname(CATALOG), { recursive: true });
  fs.writeFileSync(CATALOG, JSON.stringify([...seen.values()], null, 1) + "\n");
  console.log(`${seen.size} placed meshes from ${files.length} files -> ${path.relative(REPO_ROOT, CATALOG)}`);
}

function readCatalog(): CatalogEntry[] {
  if (!fs.existsSync(CATALOG)) throw new Error(`no ${path.relative(REPO_ROOT, CATALOG)}; run \`catalog\` first`);
  return JSON.parse(fs.readFileSync(CATALOG, "utf8"));
}

// ---------------------------------------------------------------- meshes

function readIndex(): Record<string, string> {
  return fs.existsSync(MESH_INDEX) ? JSON.parse(fs.readFileSync(MESH_INDEX, "utf8")) : {};
}

/** Fetch a mesh (TTS's own cache first, then the CDN) into `_private/tts-meshes/<sha>.obj`; returns its sha. */
async function fetchMesh(url: string, index: Record<string, string>): Promise<string | null> {
  if (index[url] !== undefined) return index[url] || null;
  let bytes: Buffer | null = null;
  const cached = path.join(ttsDir(), "Mods", "Models", url.replace(/[^A-Za-z0-9]/g, "") + ".obj");
  if (fs.existsSync(cached)) bytes = fs.readFileSync(cached);
  else {
    // Steam retired the cloud-3 host; the same paths resolve on the current CDN.
    const live = url.replace(/^https?:\/\/cloud-3\.steamusercontent\.com\//, "https://steamusercontent-a.akamaihd.net/");
    try {
      const res = await fetch(live);
      if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
    } catch {
      bytes = null;
    }
  }
  const sha = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
  if (bytes) {
    fs.mkdirSync(MESH_DIR, { recursive: true });
    fs.writeFileSync(path.join(MESH_DIR, `${sha}.obj`), bytes);
  }
  index[url] = sha;
  fs.writeFileSync(MESH_INDEX, JSON.stringify(index, null, 1) + "\n");
  return sha || null;
}

const meshPath = (sha: string) => path.join(MESH_DIR, `${sha}.obj`);

const parsed = new Map<string, Mesh>();
function readMesh(sha: string): Mesh {
  let m = parsed.get(sha);
  if (!m) {
    m = parseObj(fs.readFileSync(meshPath(sha), "utf8"));
    parsed.set(sha, m);
  }
  return m;
}

/** The whole model: its main mesh joined with its child parts. */
function modelMesh(sha: string, parts: ManifestPart[] = []): Mesh {
  if (parts.length === 0) return readMesh(sha);
  return joinParts([{ mesh: readMesh(sha) }, ...parts.map((p) => ({ ...p, mesh: readMesh(p.mesh_sha256) }))]);
}

/** Fetch a catalog entry's main mesh and children; null if any part is unavailable. */
async function fetchModel(e: CatalogEntry, index: Record<string, string>): Promise<{ sha: string; parts: ManifestPart[] } | null> {
  const sha = await fetchMesh(e.mesh_url, index);
  if (!sha) return null;
  const parts: ManifestPart[] = [];
  for (const c of e.children ?? []) {
    const csha = await fetchMesh(c.mesh_url, index);
    if (!csha) return null;
    parts.push({ mesh_sha256: csha, position: c.position, rotation: c.rotation, scale: c.scale });
  }
  return { sha, parts };
}

/** Upright on the table: no tilt beyond what turns a Z-up file Y-up. */
function upright(rot: [number, number, number]): boolean {
  const off = (a: number) => Math.min(...[0, 90, 180, 270, 360].map((q) => Math.abs((((a % 360) + 360) % 360) - q)));
  return off(rot[0]) < 1 && off(rot[2]) < 1;
}

function placementOf(e: CatalogEntry): Placement {
  const snap = (a: number) => Math.round(a / 90) * 90;
  return { scale: e.scale[0], rotXDeg: snap(e.rotation[0]), rotZDeg: snap(e.rotation[2]) };
}

async function candidates(pattern: string): Promise<void> {
  const re = new RegExp(pattern, "i");
  const index = readIndex();
  const rows = readCatalog().filter((e) => re.test(e.nickname) && upright(e.rotation));
  for (const e of rows) {
    const scaleOk = Math.abs(e.scale[0] - e.scale[1]) < 1e-3 && Math.abs(e.scale[0] - e.scale[2]) < 1e-3;
    const model = await fetchModel(e, index);
    if (!model) {
      console.log(`  unavailable   ${e.nickname}  [${e.source}]`);
      continue;
    }
    const { sha } = model;
    const p = placementOf(e);
    try {
      const outline = meshOutline(modelMesh(sha, model.parts), p);
      const xs = outline.map((q) => q.x), ys = outline.map((q) => q.y);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      console.log(
        `${w.toFixed(2)} x ${h.toFixed(2)} in  scale=${p.scale.toFixed(4)}${scaleOk ? "" : "(non-uniform)"} rot=(${p.rotXDeg},${p.rotZDeg})  ${sha.slice(0, 12)}${model.parts.length ? `+${model.parts.length}` : ""}  ${e.nickname}  [${e.source}]`,
      );
    } catch (err) {
      console.log(`  error ${(err as Error).message}  ${sha.slice(0, 12)}  ${e.nickname}`);
    }
  }
}

/** Sources at another scale than 40k (Epic, Titanicus) or another game; their meshes never vote. */
const OFF_SCALE_SOURCE = /Specialist|Adeptus Titanicus|Horus Heresy|Kill Team|Necromunda/i;

interface Group {
  id: string;
  name: string;
  /** Regex on the TTS object name. */
  match: string;
  units: string[];
  note?: string;
}

/**
 * Propose a pinned mesh per hull group. Mod authors scale the same model
 * differently (one Rhino ranges over 30% across mods), so no single placement is
 * trusted: every distinct full-scale mesh votes with its outline's long side at
 * the scale its mod uses most, and the median-length mesh is chosen. Ties break
 * on the mesh hash, so the choice is deterministic for a given catalog.
 */
async function suggest(groupsFile: string): Promise<void> {
  const groups: Group[] = JSON.parse(fs.readFileSync(groupsFile, "utf8"));
  const index = readIndex();
  const cat = readCatalog();
  const hulls: HullEntry[] = [];
  const noMesh: { unit: string; reason: string }[] = [];
  for (const g of groups) {
    const re = new RegExp(g.match, "i");
    // model (main sha + parts) -> placement key -> count
    const votes = new Map<string, Map<string, { e: CatalogEntry; n: number; sha: string; parts: ManifestPart[] }>>();
    for (const e of cat) {
      if (!re.test(e.nickname) || !upright(e.rotation) || OFF_SCALE_SOURCE.test(e.source)) continue;
      if (Math.abs(e.scale[0] - e.scale[1]) > 1e-3 || Math.abs(e.scale[0] - e.scale[2]) > 1e-3) continue;
      const model = await fetchModel(e, index);
      if (!model) continue;
      const id = `${model.sha}${JSON.stringify(model.parts)}`;
      const p = placementOf(e);
      const key = `${p.scale.toFixed(4)}|${p.rotXDeg}|${p.rotZDeg}`;
      const bySha = votes.get(id) ?? new Map();
      const v = bySha.get(key) ?? { e, n: 0, ...model };
      v.n++;
      bySha.set(key, v);
      votes.set(id, bySha);
    }
    const measured: { sha: string; parts: ManifestPart[]; e: CatalogEntry; len: number; w: number }[] = [];
    for (const [, bySha] of [...votes].sort(([a], [b]) => a.localeCompare(b))) {
      const best = [...bySha.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0][1];
      try {
        const o = meshOutline(modelMesh(best.sha, best.parts), placementOf(best.e));
        const xs = o.map((q) => q.x), ys = o.map((q) => q.y);
        measured.push({ sha: best.sha, parts: best.parts, e: best.e, w: Math.max(...xs) - Math.min(...xs), len: Math.max(...ys) - Math.min(...ys) });
      } catch {
        // An unreadable or empty mesh casts no vote.
      }
    }
    if (measured.length === 0) {
      for (const u of g.units) noMesh.push({ unit: u, reason: g.note ?? `no usable TTS mesh matches /${g.match}/` });
      continue;
    }
    // The mesh most others agree with (within 6% on both sides) wins; partial and
    // mis-scaled meshes rarely agree with anything. Ties go to the median length.
    measured.sort((a, b) => a.len - b.len || a.sha.localeCompare(b.sha));
    const median = measured[(measured.length - 1) >> 1].len;
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.06 * b;
    const support = (m: (typeof measured)[number]) => measured.filter((o) => near(o.len, m.len) && near(o.w, m.w)).length;
    const pick = [...measured].sort(
      (a, b) => support(b) - support(a) || Math.abs(a.len - median) - Math.abs(b.len - median) || a.sha.localeCompare(b.sha),
    )[0];
    const p = placementOf(pick.e);
    console.error(
      `${g.id}: ${measured.map((m) => `${m.len.toFixed(2)}x${m.w.toFixed(2)}`).join(" ")} -> ${pick.len.toFixed(2)} x ${pick.w.toFixed(2)} [${support(pick)}/${measured.length}] (${pick.e.nickname})`,
    );
    hulls.push({
      id: g.id,
      name: g.name,
      tts_nickname: pick.e.nickname,
      mesh_sha256: pick.sha,
      ...(pick.parts.length ? { parts: pick.parts } : {}),
      scale: Number(p.scale.toFixed(4)),
      rot_x_deg: p.rotXDeg,
      rot_z_deg: p.rotZDeg,
      units: g.units,
      ...(g.note ? { note: g.note } : {}),
    });
  }
  console.log(JSON.stringify({ hulls, no_mesh: noMesh }, null, 2));
}

// ---------------------------------------------------------------- build

interface BaseSize {
  shape: string;
  draft?: boolean;
}
interface UnitRow {
  id: string;
  name: string;
  base_size_mm?: BaseSize | null;
}
interface CompositionRow {
  unit_id: string;
  models: { name: string; base_size_mm?: BaseSize | null; hull_shape_id?: string | null }[];
}

/** Resolve every pinned hull's mesh, fetching any that are not already in `_private/tts-meshes/`. */
async function resolveMeshes(manifest: Manifest): Promise<void> {
  const index = readIndex();
  for (const h of manifest.hulls) {
    for (const sha of [h.mesh_sha256, ...(h.parts ?? []).map((p) => p.mesh_sha256)]) {
      if (fs.existsSync(meshPath(sha))) continue;
      for (const e of readCatalog().filter((c) => c.nickname === h.tts_nickname)) {
        const urls = [e.mesh_url, ...(e.children ?? []).map((c) => c.mesh_url)].filter((u) => index[u] === undefined);
        for (const u of urls) await fetchMesh(u, index);
        if (fs.existsSync(meshPath(sha))) break;
      }
      if (!fs.existsSync(meshPath(sha))) {
        throw new Error(`${h.id}: no mesh with sha256 ${sha} under "${h.tts_nickname}"${h.note ? ` (${h.note})` : " (run `catalog`)"}`);
      }
    }
  }
}

async function build(write: boolean): Promise<void> {
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  await resolveMeshes(manifest);

  const shapes: HullShape[] = [];
  const hullOf = new Map<string, string>();
  for (const h of manifest.hulls) {
    const outline = meshOutline(modelMesh(h.mesh_sha256, h.parts), {
      scale: h.scale,
      rotXDeg: h.rot_x_deg,
      rotZDeg: h.rot_z_deg,
      dropBelowIn: h.drop_below_in,
    });
    shapes.push(hullShapeRecord(h.id, h.name, outline, manifest.game_version));
    for (const u of h.units) {
      if (hullOf.has(u)) throw new Error(`${u} is mapped to both ${hullOf.get(u)} and ${h.id}`);
      hullOf.set(u, h.id);
    }
  }
  shapes.sort((a, b) => a.id.localeCompare(b.id));
  const listed = new Set(manifest.no_mesh.map((n) => n.unit));

  const staged: StagedWrite[] = [{ path: OUTPUT, value: shapes }];
  const seen = new Set<string>();
  const unlisted: string[] = [];
  for (const dir of fs.readdirSync(CORE_DIR).sort()) {
    const unitsPath = path.join(CORE_DIR, dir, "units.json");
    const compPath = path.join(CORE_DIR, dir, "unit-compositions.json");
    if (!fs.existsSync(unitsPath)) continue;
    const units = readJsonArray<UnitRow>(unitsPath);
    const comps = fs.existsSync(compPath) ? readJsonArray<CompositionRow>(compPath) : [];
    let touched = false;
    for (const u of units) {
      const key = `${dir}/${u.id}`;
      const hull = hullOf.get(key);
      if (u.base_size_mm?.shape !== "hull") {
        if (hull) throw new Error(`${key} is mapped to ${hull} but its base is not a hull`);
        continue;
      }
      seen.add(key);
      if (!hull) {
        if (!listed.has(key)) unlisted.push(key);
        continue;
      }
      // A traced shape is what the draft flag was waiting for.
      delete u.base_size_mm.draft;
      for (const c of comps.filter((c) => c.unit_id === u.id)) {
        for (const m of c.models) {
          if (m.base_size_mm?.shape !== "hull") continue;
          delete m.base_size_mm.draft;
          m.hull_shape_id = hull;
        }
      }
      touched = true;
    }
    if (touched) staged.push({ path: unitsPath, value: units }, { path: compPath, value: comps });
  }
  const stale = [...hullOf.keys(), ...listed].filter((k) => !seen.has(k));
  if (unlisted.length || stale.length) {
    throw new Error(
      [
        unlisted.length ? `hull-based units with no shape and no reason in hulls.json:\n  ${unlisted.join("\n  ")}` : "",
        stale.length ? `hulls.json names units that are not hull-based:\n  ${stale.join("\n  ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const report = renderReport(manifest, shapes);
  await applyWrites(staged, { write, label: "tts-hulls" });
  if (write) fs.writeFileSync(REPORT, report);
  console.log(
    `${shapes.length} hull shapes for ${hullOf.size} units; ${manifest.no_mesh.length} units without a mesh` +
      (write ? `. Wrote ${path.relative(REPO_ROOT, OUTPUT)} and ${path.relative(REPO_ROOT, REPORT)}.` : " (dry run)."),
  );
}

function renderReport(manifest: Manifest, shapes: HullShape[]): string {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const L = [
    "# Hull shapes",
    "",
    "Generated by `npm run tts-hulls -- build --write` from `tools/src/tts-hulls/hulls.json`.",
    "Each outline is a Tabletop Simulator mesh projected straight down, with overhangs",
    `narrower than ${((DEFAULT_OUTLINE.openingRadiusIn * 2) * 25.4).toFixed(0)} mm (aerials, thin barrels, chains) removed.`,
    "",
    "| Hull | Bounds (in) | Points | Units |",
    "| --- | --- | --- | --- |",
  ];
  for (const h of [...manifest.hulls].sort((a, b) => a.id.localeCompare(b.id))) {
    const s = byId.get(h.id)!;
    L.push(`| ${h.name} | ${s.bounds_width_in} × ${s.bounds_height_in} | ${s.points.length} | ${h.units.join(", ")} |`);
  }
  L.push("", "## Hull-based units without a shape", "", "| Unit | Reason |", "| --- | --- |");
  for (const n of [...manifest.no_mesh].sort((a, b) => a.unit.localeCompare(b.unit))) L.push(`| ${n.unit} | ${n.reason} |`);
  return L.join("\n") + "\n";
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "catalog") catalog();
else if (cmd === "candidates" && rest[0]) await candidates(rest[0]);
else if (cmd === "suggest" && rest[0]) await suggest(rest[0]);
else if (cmd === "build") await build(rest.includes("--write"));
else {
  console.error("usage: tts-hulls catalog | candidates <regex> | suggest <groups.json> | build [--write]");
  process.exit(1);
}
