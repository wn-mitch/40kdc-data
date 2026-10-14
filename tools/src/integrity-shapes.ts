/**
 * Referential checks the phase-4 DSL shapes need beyond JSON Schema, run as part of
 * `checkReferentialIntegrity`:
 *
 *  - every designation (a tag an effect applies or tests) is a registered id
 *    (`DESIGNATION_IDS`), compared after folding legacy upper-case spellings;
 *  - a `{stratagem_target: name}` reference names one of the targets its Stratagem declares;
 *  - `{roll_var}` (a quantity or a dice gate's `from`) sits inside the `roll` step that binds it;
 *  - an objective `{selection_var}` sits inside the `select-objective` that binds it;
 *  - `weapon_ref: {weapon_var}` names a weapon a `select-weapon` in the same record binds;
 *  - a `split-unit` names exactly one binding per resulting unit.
 */

import { existsSync, readFileSync } from "node:fs";
import { glob } from "glob";
import { basename, dirname, resolve } from "node:path";
import type { ValidationResult } from "./validate.js";
import { DESIGNATION_IDS, designationId } from "./translate/designations.js";

type Node = Record<string, unknown>;
type Issue = { path: string; message: string };

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readArray(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

/** Keys that hold a designation id wherever they appear in a DSL tree. */
const TAG_KEYS = new Set(["designated", "not_designated"]);

/** Collect every designation a DSL value tree applies or tests, with its JSON path. */
function collectDesignations(node: unknown, path: string, out: Array<{ path: string; tag: string }>): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectDesignations(v, `${path}/${i}`, out));
    return;
  }
  if (!isNode(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") {
      if (TAG_KEYS.has(k)) out.push({ path: `${path}/${k}`, tag: v });
      // `tag`: a designate modifier, a designated condition, an event filter, a tagged-terrain condition;
      // an army-rule's `tag` names a Detachment tag, not a designation.
      if (k === "tag" && node.rule !== "detachment-tag-exclusive") out.push({ path: `${path}/${k}`, tag: v });
      if (k === "designation" && (node.type === "designate-target" || node.type === "persistent-designation")) out.push({ path: `${path}/${k}`, tag: v });
    } else {
      collectDesignations(v, `${path}/${k}`, out);
    }
  }
}

/** Scoped bindings: roll variables and bound objectives visible at a point in the tree. */
interface Scope {
  rolls: ReadonlySet<string>;
  objectives: ReadonlySet<string>;
}

function isRollRef(v: unknown): v is { roll_var: string } {
  return isNode(v) && typeof v.roll_var === "string" && Object.keys(v).every((k) => k === "roll_var" || k === "successes_on");
}

/** Walk a DSL tree checking roll / objective binding scope, weapon bindings and split-unit arity. */
function checkBindings(node: unknown, path: string, scope: Scope, weapons: ReadonlySet<string>, out: Issue[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkBindings(v, `${path}/${i}`, scope, weapons, out));
    return;
  }
  if (!isNode(node)) return;
  let inner = scope;
  if (node.type === "roll" && typeof node.roll_var === "string") {
    inner = { ...scope, rolls: new Set([...scope.rolls, node.roll_var]) };
  }
  if (node.type === "select-objective" && isNode(node.selector) && typeof node.selector.bind_as === "string") {
    inner = { ...scope, objectives: new Set([...scope.objectives, node.selector.bind_as]) };
  }
  if (node.type === "split-unit" && isNode(node.modifier) && Array.isArray(node.modifier.bind_as)) {
    const m = node.modifier;
    const parts = Array.isArray(m.model_counts) ? m.model_counts.length : isNode(m.by) && Array.isArray(m.by.model_keyword) ? m.by.model_keyword.length : undefined;
    if (parts !== (m.bind_as as unknown[]).length) {
      out.push({ path: `${path}/modifier/bind_as`, message: `split-unit names ${(m.bind_as as unknown[]).length} bindings for ${parts ?? "a per-model number of"} resulting units` });
    }
  }
  for (const [k, v] of Object.entries(node)) {
    const at = `${path}/${k}`;
    if (isRollRef(v) && !(node.type === "roll" && k === "roll_var")) {
      if (!inner.rolls.has(v.roll_var)) out.push({ path: at, message: `{roll_var: "${v.roll_var}"} is not inside a roll step that binds it` });
      continue;
    }
    if (k === "objective" && isNode(v) && typeof v.selection_var === "string" && !inner.objectives.has(v.selection_var)) {
      out.push({ path: `${at}/selection_var`, message: `objective {selection_var: "${v.selection_var}"} is not inside a select-objective that binds it` });
    }
    if (k === "weapon_ref" && isNode(v) && typeof v.weapon_var === "string" && !weapons.has(v.weapon_var)) {
      out.push({ path: `${at}/weapon_var`, message: `weapon_ref "${v.weapon_var}" is bound by no select-weapon in this ability` });
    }
    checkBindings(v, at, inner, weapons, out);
  }
}

/** Every weapon a select-weapon step in the tree binds. */
function collectWeaponBindings(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectWeaponBindings(v, into);
    return;
  }
  if (!isNode(node)) return;
  if (node.type === "select-weapon" && isNode(node.modifier) && typeof node.modifier.bind_as === "string") into.add(node.modifier.bind_as);
  for (const v of Object.values(node)) collectWeaponBindings(v, into);
}

/** Every `{stratagem_target: name}` in a tree, with its path. */
function collectStratagemTargets(node: unknown, path: string, out: Array<{ path: string; name: string }>): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectStratagemTargets(v, `${path}/${i}`, out));
    return;
  }
  if (!isNode(node)) return;
  if (typeof node.stratagem_target === "string") out.push({ path: `${path}/stratagem_target`, name: node.stratagem_target });
  for (const [k, v] of Object.entries(node)) collectStratagemTargets(v, `${path}/${k}`, out);
}

/** ability_id → the target names its Stratagem declares (an array-form target_restrictions). */
async function stratagemTargetNames(root: string): Promise<Map<string, Set<string>>> {
  const names = new Map<string, Set<string>>();
  for (const f of await glob("core/*/stratagems.json", { cwd: root, absolute: true })) {
    let rows: unknown[];
    try {
      rows = readArray(f);
    } catch {
      continue; // structural problems are the AJV pass's job
    }
    for (const s of rows) {
      if (!isNode(s) || typeof s.ability_id !== "string") continue;
      const set = names.get(s.ability_id) ?? new Set<string>();
      if (Array.isArray(s.target_restrictions)) {
        for (const t of s.target_restrictions) if (isNode(t) && typeof t.name === "string") set.add(t.name);
      }
      names.set(s.ability_id, set);
    }
  }
  return names;
}

/** The phase-4 shape checks over every ability record, Stratagem eligibility and mission card. */
export async function checkDslShapes(root: string, result: ValidationResult): Promise<void> {
  const targets = await stratagemTargetNames(root);
  const record = (file: string, index: number, issues: Issue[]): void => {
    if (issues.length === 0) return;
    result.failed++;
    result.errors.push({ file, index, errors: issues });
  };
  const tagIssues = (tree: unknown, base: string): Issue[] => {
    const found: Array<{ path: string; tag: string }> = [];
    collectDesignations(tree, base, found);
    return found
      .filter(({ tag }) => !DESIGNATION_IDS.has(designationId(tag)))
      .map(({ path, tag }) => ({ path, message: `designation "${tag}" is not in the registry (tools/src/translate/designations.ts)` }));
  };

  for (const file of (await glob("enrichment/*/abilities.json", { cwd: root, absolute: true })).sort()) {
    const dir = basename(dirname(file));
    if (dir.startsWith("_") && dir !== "_core") continue;
    let rows: unknown[];
    try {
      rows = readArray(file);
    } catch {
      continue;
    }
    rows.forEach((a, index) => {
      if (!isNode(a)) return;
      const issues: Issue[] = [];
      for (const key of ["effect", "trigger", "usage"]) issues.push(...tagIssues(a[key], `/${index}/${key}`));
      const weapons = new Set<string>();
      collectWeaponBindings(a.effect, weapons);
      checkBindings(a.effect, `/${index}/effect`, { rolls: new Set(), objectives: new Set() }, weapons, issues);
      const refs: Array<{ path: string; name: string }> = [];
      collectStratagemTargets(a.effect, `/${index}/effect`, refs);
      const declared = typeof a.ability_id === "string" ? targets.get(a.ability_id) : undefined;
      for (const r of refs) {
        if (!declared?.has(r.name)) issues.push({ path: r.path, message: `stratagem_target "${r.name}" is not a named target of ${declared ? "this ability's Stratagem" : "any Stratagem using this ability"}` });
      }
      record(file, index, issues);
    });
  }

  // Conditions outside ability records carry designations too.
  for (const file of [...(await glob("core/*/stratagems.json", { cwd: root, absolute: true })), resolve(root, "core/mission-cards.json")].sort()) {
    let rows: unknown[];
    try {
      rows = readArray(file);
    } catch {
      continue;
    }
    rows.forEach((row, index) => record(file, index, tagIssues(row, `/${index}`)));
  }
}
