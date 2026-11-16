/**
 * Keyword-choice groups (`core/keyword-choice-groups.json`), run as part of `checkReferentialIntegrity`
 * (integrity.ts). Every unit's `conditional_keywords` entry with a `choice_group` names a group in the
 * file, a group names a detachment some faction prints (or none), and a group's options on one unit
 * are distinct keywords, since the unit takes one of them.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { glob } from "glob";
import type { ValidationResult } from "./validate.js";

type Group = { id?: unknown; detachment_id?: unknown };
type Grant = { keyword?: unknown; choice_group?: unknown };
type Unit = { id?: unknown; conditional_keywords?: unknown };

function readArray<T>(file: string): T[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return []; // unreadable: reported by schema validation
  }
}

export async function checkChoiceGroupRefs(root: string, result: ValidationResult): Promise<void> {
  const groupsFile = resolve(root, "core/keyword-choice-groups.json");
  const groups = existsSync(groupsFile) ? readArray<Group>(groupsFile) : [];
  const groupIds = new Set(groups.map((group) => group.id).filter((id): id is string => typeof id === "string"));
  const detachmentIds = new Set<string>();
  for (const file of await glob("core/*/detachments.json", { cwd: root, absolute: true })) {
    for (const detachment of readArray<{ id?: unknown }>(file)) if (typeof detachment.id === "string") detachmentIds.add(detachment.id);
  }
  groups.forEach((group, index) => {
    if (typeof group.detachment_id === "string" && !detachmentIds.has(group.detachment_id)) {
      result.failed++;
      result.errors.push({ file: groupsFile, index, errors: [{ path: "/detachment_id", message: `keyword-choice group ${String(group.id)} names detachment ${group.detachment_id}, which no faction prints` }] });
    }
  });
  for (const file of await glob("core/*/units.json", { cwd: root, absolute: true })) {
    readArray<Unit>(file).forEach((unit, index) => {
      const grants = Array.isArray(unit.conditional_keywords) ? (unit.conditional_keywords as Grant[]) : [];
      const errors: { path: string; message: string }[] = [];
      const options = new Map<string, Set<string>>();
      for (const grant of grants) {
        if (typeof grant.choice_group !== "string") continue;
        if (!groupIds.has(grant.choice_group)) errors.push({ path: "/conditional_keywords", message: `${String(unit.id)}: conditional keyword ${String(grant.keyword)} names keyword-choice group ${grant.choice_group}, which keyword-choice-groups.json does not define` });
        const seen = options.get(grant.choice_group) ?? options.set(grant.choice_group, new Set()).get(grant.choice_group)!;
        const keyword = String(grant.keyword).toLowerCase();
        if (seen.has(keyword)) errors.push({ path: "/conditional_keywords", message: `${String(unit.id)}: keyword-choice group ${grant.choice_group} lists option ${String(grant.keyword)} twice` });
        seen.add(keyword);
      }
      if (errors.length) {
        result.failed++;
        result.errors.push({ file, index, errors });
      }
    });
  }
}
