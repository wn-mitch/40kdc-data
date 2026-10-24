/**
 * Referential checks the phase-4 DSL shapes need beyond JSON Schema, run as part of
 * `checkReferentialIntegrity`:
 *
 *  - every designation (a tag an effect applies or tests) is a registered id
 *    (`DESIGNATION_IDS`), compared after folding legacy upper-case spellings;
 *  - a `{stratagem_target: name}` reference names one of the targets its Stratagem declares;
 *  - `{roll_var}` (a quantity or a dice gate's `from`) sits inside the `roll` step that binds it;
 *  - an objective `{selection_var}` sits inside the `select-objective` that binds it;
 *  - `weapons.ref: {weapon_var}` names a weapon bound by an earlier sequence step;
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
    if (node.type === "sequence" && k === "steps" && Array.isArray(v)) {
      const available = new Set(weapons);
      v.forEach((step, index) => {
        checkBindings(step, `${at}/${index}`, inner, available, out);
        if (isNode(step) && step.type === "select-weapon" && isNode(step.modifier) && typeof step.modifier.bind_as === "string") available.add(step.modifier.bind_as);
      });
      continue;
    }
    if (isRollRef(v) && !(node.type === "roll" && k === "roll_var")) {
      if (!inner.rolls.has(v.roll_var)) out.push({ path: at, message: `{roll_var: "${v.roll_var}"} is not inside a roll step that binds it` });
      continue;
    }
    if (k === "objective" && isNode(v) && typeof v.selection_var === "string" && !inner.objectives.has(v.selection_var)) {
      out.push({ path: `${at}/selection_var`, message: `objective {selection_var: "${v.selection_var}"} is not inside a select-objective that binds it` });
    }
    if (k === "ref" && isNode(v) && typeof v.weapon_var === "string" && !weapons.has(v.weapon_var)) {
      out.push({ path: `${at}/weapon_var`, message: `weapon "${v.weapon_var}" is not bound by an earlier select-weapon step` });
    }
    checkBindings(v, at, inner, weapons, out);
  }
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
    rows.forEach((row, index) => record(file, index, [...tagIssues(row, `/${index}`), ...modeCostIssues(row, index), ...warlordKeywordIssues(row, index)]));
  }
}

/**
 * A target mode is chosen as a whole, so every target of one mode names the same mode_cost (the
 * schema cannot compare array items). A mode's targets are listed under target_restrictions.
 */
function modeCostIssues(row: unknown, index: number): Issue[] {
  if (!isNode(row) || !Array.isArray(row.target_restrictions)) return [];
  const costs = new Map<string, string>();
  const issues: Issue[] = [];
  row.target_restrictions.forEach((target, at) => {
    if (!isNode(target) || typeof target.mode !== "string") return;
    const cost = JSON.stringify(target.mode_cost ?? null);
    const seen = costs.get(target.mode);
    if (seen === undefined) costs.set(target.mode, cost);
    else if (seen !== cost) issues.push({ path: `/${index}/target_restrictions/${at}/mode_cost`, message: `mode "${target.mode}" names a different mode_cost than its other targets` });
  });
  return issues;
}

/**
 * The Warlord is the model chosen at mustering, not a keyword: a Stratagem target that must be the
 * Warlord sets `warlord`, and no keyword list names it (WARLORD TITAN is a keyword and is allowed).
 * Your Warlord is never an enemy target; that is checked here, not in the schema, because the Rust
 * validator's bundled schema drops if/then.
 */
function warlordKeywordIssues(row: unknown, index: number): Issue[] {
  if (!isNode(row) || row.target_restrictions === undefined || row.target_restrictions === null) return [];
  const targets = Array.isArray(row.target_restrictions) ? row.target_restrictions : [row.target_restrictions];
  const prefix = Array.isArray(row.target_restrictions) ? (at: number) => `/${index}/target_restrictions/${at}` : () => `/${index}/target_restrictions`;
  const issues: Issue[] = [];
  targets.forEach((target, at) => {
    if (!isNode(target)) return;
    if (target.warlord === true && target.side === "enemy") issues.push({ path: `${prefix(at)}/warlord`, message: "an enemy target cannot be your Warlord" });
    for (const key of ["required_keywords", "required_keywords_any", "excluded_keywords"]) {
      const list = target[key];
      if (!Array.isArray(list)) continue;
      list.forEach((keyword, position) => {
        if (typeof keyword === "string" && keyword.trim().toLowerCase() === "warlord") {
          issues.push({ path: `${prefix(at)}/${key}/${position}`, message: "\"Warlord\" is not a keyword; a target that must be your Warlord sets warlord: true" });
        }
      });
    }
  });
  return issues;
}
