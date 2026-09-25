import { currentFamilyVersion, familyRole, normalizeFingerprintParameters } from "./contracts.js";
import { CompileError, leafFragment } from "./compile.js";
import { describeCondition } from "../translate/condition.js";
import { describeEffect, describeTrigger, durationClauses } from "../translate/effect.js";

/**
 * The describer's English for one leaf on its own, so a reviewer sees what a meaning will say
 * before deciding it. Returns the problem instead when the parameters are invalid or the leaf
 * has no DSL fragment.
 */
export function previewLeaf(value: unknown): { text: string | null; problem: string | null } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { text: null, problem: "Expected {family_id, parameters}." };
  const input = value as { family_id?: unknown; family_version?: unknown; parameters?: unknown };
  if (typeof input.family_id !== "string" || !input.parameters || typeof input.parameters !== "object") return { text: null, problem: "family_id and parameters are required." };
  try {
    const version = typeof input.family_version === "number" ? input.family_version : currentFamilyVersion(input.family_id);
    const parameters = normalizeFingerprintParameters(input.family_id, input.parameters as Record<string, unknown>, version);
    const fragment = leafFragment({ role: familyRole(input.family_id, version), family_id: input.family_id, family_version: version, parameters, start_byte: 0 });
    const text = fragment.kind === "effect" ? describeEffect(fragment.node as never)
      : fragment.kind === "condition" ? describeCondition(fragment.node as never)
        : fragment.kind === "trigger" ? describeTrigger(fragment.node as never)
          : fragment.kind === "duration" ? durationClauses(fragment.duration).trail || durationClauses(fragment.duration).lead || "for the rest of the battle"
            : "No separate text: an attack-time event is part of the effect it goes with.";
    return { text, problem: null };
  } catch (error) {
    if (error instanceof CompileError || error instanceof TypeError || error instanceof RangeError) return { text: null, problem: error.message };
    throw error;
  }
}
