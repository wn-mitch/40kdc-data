import type { DatabaseSync } from "node:sqlite";

import { hashJson } from "../round4/hash.js";

export const SEMANTIC_ROLES = ["EFFECT", "DURATION", "EVENT", "CONDITION"] as const;
export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

type SourceQualifiedValue = { source: string };
type FamilyParameters = Record<string, unknown>;

export type SemanticFamilyDefinition = {
  id: string;
  version: number;
  role: SemanticRole;
  label: string;
  description: string;
  starter: Record<string, unknown>;
  parameterSchema: Record<string, unknown>;
  /**
   * A superseded version. Its existing fingerprints stay readable, but no new fingerprint or
   * model request may use it; `upgradeFamilyVersions` moves its leaves to the current version.
   */
  deprecated?: true;
};

const sourceQualifiedSchema = {
  type: "object",
  required: ["source"],
  properties: { source: { type: "string", minLength: 1 } },
  additionalProperties: false,
};

const enumOrSourceSchema = (values: readonly string[]): Record<string, unknown> => ({
  anyOf: [{ enum: values }, sourceQualifiedSchema],
});

const integerOrSourceSchema = {
  anyOf: [{ type: "integer" }, sourceQualifiedSchema],
};

const weaponGrantKeywords = [
  "Devastating Wounds", "Lethal Hits", "Twin-linked", "Assault", "Heavy", "Pistol", "Torrent", "Blast",
  "Ignores Cover", "Precision", "Hazardous", "Indirect Fire", "Extra Attacks", "Psychic", "One Shot", "Lance",
] as const;

/** Weapon abilities that carry a value, written the way the DSL's keyword-grant spells them. */
const parameterizedWeaponKeyword = /^(?:(?:Sustained Hits|Rapid Fire|Melta) (?:[1-9]|D3|D6)|Anti-[A-Z][A-Za-z -]*[A-Za-z] [2-6]\+)$/u;

const EVENT_KINDS = [
  "attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end", "after-shooting",
] as const;
const WEAPON_TYPES = ["all", "melee", "ranged"] as const;
const BUFF_SUBJECTS = ["this-unit", "this-model", "bearer"] as const;
const FNP_AGAINST = ["all", "mortal", "psychic", "psychic-and-mortal"] as const;
const CHARACTERISTICS = ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"] as const;

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) return value;
  throw new TypeError(`${label} must be an integer from ${min} to ${max}.`);
}

/** Versioned, human-reviewed semantic families available to local tooling. */
export const REVIEWED_FAMILY_REGISTRY: readonly SemanticFamilyDefinition[] = [
  {
    id: "reroll",
    version: 1,
    label: "Re-roll a roll",
    description: "Repeats Hit, Wound, or another named roll; specify which results may be re-rolled.",
    starter: { roll: "", subset: "" },
    role: "EFFECT",
    parameterSchema: {
      type: "object",
      required: ["roll", "subset"],
      properties: {
        roll: enumOrSourceSchema(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"]),
        subset: enumOrSourceSchema(["ones", "failed", "all"]),
      },
      additionalProperties: false,
    },
  },
  {
    id: "roll-modifier",
    version: 1,
    role: "EFFECT",
    label: "Change a roll",
    description: "Adds to or subtracts from a named roll.",
    starter: { roll: "", operation: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["roll", "operation", "value"],
      properties: {
        roll: enumOrSourceSchema(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"]),
        operation: { enum: ["add", "subtract"] },
        value: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "critical-hit-threshold",
    version: 1,
    role: "EFFECT",
    label: "Change critical-hit threshold",
    description: "Changes the unmodified result needed for a Critical Hit, not the Hit roll needed to score a hit.",
    starter: { value: null },
    parameterSchema: {
      type: "object",
      required: ["value"],
      properties: {
        roll: enumOrSourceSchema(["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"]),
        value: { anyOf: [{ type: "integer" }, sourceQualifiedSchema, { const: "source" }] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "resource-action",
    version: 1,
    role: "EFFECT",
    label: "Change a resource",
    description: "Gains, loses, spends, or sets a named resource.",
    starter: { resource: "", operation: "", amount: null },
    parameterSchema: {
      type: "object",
      required: ["resource", "operation", "amount"],
      properties: {
        resource: enumOrSourceSchema(["command-point", "bloodshed-point", "miracle-dice", "fate-dice", "cabal-point"]),
        operation: { enum: ["gain", "lose", "spend", "set"] },
        amount: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "duration",
    version: 1,
    role: "DURATION",
    label: "Set a duration",
    description: "Marks when an effect ends.",
    starter: { endpoint: "" },
    parameterSchema: {
      type: "object",
      required: ["endpoint"],
      properties: {
        endpoint: enumOrSourceSchema(["end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle"]),
      },
      additionalProperties: false,
    },
  },
  {
    id: "event",
    version: 1,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: enumOrSourceSchema(["attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end"]),
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "event",
    version: 2,
    role: "EVENT",
    label: "At an event",
    description: "Marks when the mechanic triggers. Attack events are part of the effect; the others become the ability's trigger.",
    starter: { kind: "" },
    parameterSchema: {
      type: "object",
      required: ["kind"],
      properties: { kind: { enum: EVENT_KINDS } },
      additionalProperties: false,
    },
  },
  {
    id: "turn-start",
    version: 1,
    role: "EVENT",
    label: "At the start of a turn or round",
    description: "Marks the start of a battle round, your turn, or your opponent's turn.",
    starter: { turn: "" },
    parameterSchema: {
      type: "object",
      required: ["turn"],
      properties: { turn: { enum: ["battle-round", "player-turn", "opponent-turn"] } },
      additionalProperties: false,
    },
  },
  {
    id: "army-faction",
    version: 1,
    role: "CONDITION",
    label: "Army faction is",
    description: "Requires the army to have a specified faction; copy its exact name from the source.",
    starter: { faction: { source: "" } },
    parameterSchema: {
      type: "object",
      required: ["faction"],
      properties: { faction: sourceQualifiedSchema },
      additionalProperties: false,
    },
  },
  {
    id: "leading-unit",
    version: 1,
    role: "CONDITION",
    label: "While leading a unit",
    description: "Requires the specified model or unit to be leading another unit.",
    starter: { subject: "" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: enumOrSourceSchema(["this-model", "this-unit", "bearers-unit"]) },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "leading-unit",
    version: 2,
    role: "CONDITION",
    label: "While leading or supporting a unit",
    description: "Requires the specified model or unit to be attached to another unit, as its leader or in support.",
    starter: { subject: "this-model", attachment: "leading" },
    parameterSchema: {
      type: "object",
      required: ["subject", "attachment"],
      properties: {
        subject: enumOrSourceSchema(["this-model", "this-unit", "bearers-unit"]),
        attachment: { enum: ["leading", "supporting"] },
      },
      additionalProperties: false,
    },
  },
  {
    id: "below-starting-strength",
    version: 1,
    role: "CONDITION",
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: enumOrSourceSchema(["this-unit", "target-unit"]) },
      additionalProperties: false,
    },
    label: "Below starting strength",
    description: "Requires a named unit to be below starting strength.",
    starter: { subject: "" },
  },
  {
    id: "characteristic-set",
    version: 1,
    role: "EFFECT",
    label: "Set a characteristic",
    description: "Sets a model or unit characteristic to a source-specified value.",
    starter: { subject: "bearer", characteristic: "", value: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "characteristic", "value"],
      properties: {
        subject: { enum: ["bearer", "this-model", "this-unit"] },
        characteristic: { enum: ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"] },
        value: integerOrSourceSchema,
      },
      additionalProperties: false,
    },
  },
  {
    id: "weapon-ability-grant",
    version: 1,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named, parameter-free weapon ability. This is not a unit keyword.",
    starter: { subject: "this-unit", keyword: "" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "bearer"] },
        keyword: { enum: weaponGrantKeywords },
      },
      additionalProperties: false,
    },
    deprecated: true,
  },
  {
    id: "weapon-ability-grant",
    version: 2,
    role: "EFFECT",
    label: "Give weapons an ability",
    description: "Weapons equipped by the specified models gain a named weapon ability, optionally only melee or only ranged weapons. This is not a unit keyword.",
    starter: { subject: "this-unit", keyword: "", weapon_type: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "keyword", "weapon_type"],
      properties: {
        subject: { enum: ["this-unit", "this-model", "bearer"] },
        keyword: { anyOf: [{ enum: weaponGrantKeywords }, { type: "string", pattern: parameterizedWeaponKeyword.source }] },
        weapon_type: { enum: WEAPON_TYPES },
      },
      additionalProperties: false,
    },
  },
  {
    id: "feel-no-pain",
    version: 1,
    role: "EFFECT",
    label: "Feel No Pain",
    description: "Models ignore wounds on a roll of the threshold or more, optionally only against mortal wounds or psychic attacks.",
    starter: { subject: "this-unit", threshold: null, against: "all" },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold", "against"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        threshold: { type: "integer", minimum: 2, maximum: 6 },
        against: { enum: FNP_AGAINST },
      },
      additionalProperties: false,
    },
  },
  {
    id: "invulnerable-save",
    version: 1,
    role: "EFFECT",
    label: "Invulnerable save",
    description: "Models have an invulnerable save of the threshold or better.",
    starter: { subject: "this-unit", threshold: null },
    parameterSchema: {
      type: "object",
      required: ["subject", "threshold"],
      properties: { subject: { enum: BUFF_SUBJECTS }, threshold: { type: "integer", minimum: 2, maximum: 6 } },
      additionalProperties: false,
    },
  },
  {
    id: "fights-first",
    version: 1,
    role: "EFFECT",
    label: "Fights First",
    description: "Models have the Fights First ability.",
    starter: { subject: "this-unit" },
    parameterSchema: {
      type: "object",
      required: ["subject"],
      properties: { subject: { enum: BUFF_SUBJECTS } },
      additionalProperties: false,
    },
  },
  {
    id: "characteristic-modifier",
    version: 1,
    role: "EFFECT",
    label: "Add to or subtract from a characteristic",
    description: "Adds to or subtracts from a model characteristic such as OC, Attacks, Strength, or Move. Setting a value is a different leaf.",
    starter: { subject: "this-unit", characteristic: "", operation: "add", value: 1 },
    parameterSchema: {
      type: "object",
      required: ["subject", "characteristic", "operation", "value"],
      properties: {
        subject: { enum: BUFF_SUBJECTS },
        characteristic: { enum: CHARACTERISTICS },
        operation: { enum: ["add", "subtract"] },
        value: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
] as const;

/** The version new fingerprints and model requests use for a family. */
export function currentFamilyVersion(id: string): number {
  const current = REVIEWED_FAMILY_REGISTRY.filter((family) => family.id === id && !family.deprecated);
  if (current.length !== 1) throw new RangeError(`Reviewed family ${id} has ${current.length} current versions.`);
  return current[0]!.version;
}

const familiesByKey: Record<string, SemanticFamilyDefinition> = Object.fromEntries(
  REVIEWED_FAMILY_REGISTRY.map((family) => [`${family.id}@${family.version}`, family]),
);

function sourceQualified(value: unknown, label: string): SourceQualifiedValue | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== "source" || typeof entries[0][1] !== "string") return null;
  const source = entries[0][1];
  if (!source || source !== source.trim()) {
    throw new TypeError(`${label} source snippet must be nonblank and preserve its exact boundaries.`);
  }
  return { source };
}

function requiredObject(parameters: FamilyParameters): Record<string, unknown> {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new TypeError("Fingerprint parameters must be a JSON object.");
  }
  return parameters;
}

function exactKeys(parameters: Record<string, unknown>, keys: readonly string[], family: string): void {
  const received = Object.keys(parameters).sort();
  const expected = [...keys].sort();
  if (received.length !== expected.length || received.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${family} parameters must be exactly: ${expected.join(", ")}.`);
  }
}

function enumOrSource(
  value: unknown,
  values: readonly string[],
  label: string,
): string | SourceQualifiedValue {
  if (typeof value === "string" && values.includes(value)) return value;
  const source = sourceQualified(value, label);
  if (source) return source;
  throw new TypeError(`${label} must be one of ${values.join(", ")} or an exact source snippet.`);
}

function enumValue(value: unknown, values: readonly string[], label: string): string {
  if (typeof value === "string" && values.includes(value)) return value;
  throw new TypeError(`${label} must be one of ${values.join(", ")}.`);
}

function integerOrSource(value: unknown, label: string): number | SourceQualifiedValue {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  const source = sourceQualified(value, label);
  if (source) return source;
  throw new TypeError(`${label} must be an integer or an exact source snippet.`);
}

/** Return one reviewed family definition or fail rather than inventing a family. */
export function reviewedFamily(id: string, version = 1): SemanticFamilyDefinition {
  const family = familiesByKey[`${id}@${version}`];
  if (!family) throw new RangeError(`Unknown reviewed semantic family ${id}@${version}.`);
  return family;
}

/** Resolve a family's semantic role from the reviewed registry. */
export function familyRole(id: string, version = 1): SemanticRole {
  return reviewedFamily(id, version).role;
}

/** Validate and canonicalise parameters for a reviewed semantic family. */
export function normalizeFingerprintParameters(
  family: string,
  parameters: FamilyParameters,
  version = 1,
): Record<string, unknown> {
  reviewedFamily(family, version);
  const input = requiredObject(parameters);

  switch (family) {
    case "reroll":
      exactKeys(input, ["roll", "subset"], family);
      return {
        roll: enumOrSource(input.roll, ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"], "reroll.roll"),
        subset: enumOrSource(input.subset, ["ones", "failed", "all"], "reroll.subset"),
      };
    case "roll-modifier":
      exactKeys(input, ["roll", "operation", "value"], family);
      return {
        roll: enumOrSource(input.roll, ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"], "roll-modifier.roll"),
        operation: enumValue(input.operation, ["add", "subtract"], "roll-modifier.operation"),
        value: integerOrSource(input.value, "roll-modifier.value"),
      };
    case "critical-hit-threshold": {
      const keys = Object.keys(input);
      if (!keys.every((key) => key === "roll" || key === "value") || !Object.hasOwn(input, "value")) {
        throw new TypeError("critical-hit-threshold parameters must contain value and optional roll only.");
      }
      const value = input.value === "source"
        ? "source"
        : integerOrSource(input.value, "critical-hit-threshold.value");
      return input.roll === undefined
        ? { value }
        : {
            roll: enumOrSource(input.roll, ["hit", "wound", "charge", "advance", "save", "leadership", "battle-shock", "damage"], "critical-hit-threshold.roll"),
            value,
          };
    }
    case "resource-action":
      exactKeys(input, ["resource", "operation", "amount"], family);
      return {
        resource: enumOrSource(input.resource, ["command-point", "bloodshed-point", "miracle-dice", "fate-dice", "cabal-point"], "resource-action.resource"),
        operation: enumValue(input.operation, ["gain", "lose", "spend", "set"], "resource-action.operation"),
        amount: integerOrSource(input.amount, "resource-action.amount"),
      };
    case "duration":
      exactKeys(input, ["endpoint"], family);
      return {
        endpoint: enumOrSource(input.endpoint, ["end-of-phase", "end-of-turn", "end-of-battle-round", "end-of-battle"], "duration.endpoint"),
      };
    case "event":
      exactKeys(input, ["kind"], family);
      return version === 1
        ? { kind: enumOrSource(input.kind, ["attack-made", "hit-roll", "wound-roll", "charge", "unit-destroyed", "model-destroyed", "phase-start", "phase-end"], "event.kind") }
        : { kind: enumValue(input.kind, EVENT_KINDS, "event.kind") };
    case "turn-start":
      exactKeys(input, ["turn"], family);
      return { turn: enumValue(input.turn, ["battle-round", "player-turn", "opponent-turn"], "turn-start.turn") };
    case "army-faction": {
      exactKeys(input, ["faction"], family);
      const faction = sourceQualified(input.faction, "army-faction.faction");
      if (!faction) throw new TypeError("army-faction.faction must be source-qualified.");
      return { faction };
    }
    case "leading-unit":
      if (version === 1) {
        exactKeys(input, ["subject"], family);
        return { subject: enumOrSource(input.subject, ["this-model", "this-unit", "bearers-unit"], "leading-unit.subject") };
      }
      exactKeys(input, ["subject", "attachment"], family);
      return {
        subject: enumOrSource(input.subject, ["this-model", "this-unit", "bearers-unit"], "leading-unit.subject"),
        attachment: enumValue(input.attachment, ["leading", "supporting"], "leading-unit.attachment"),
      };
    case "below-starting-strength":
      exactKeys(input, ["subject"], family);
      return { subject: enumOrSource(input.subject, ["this-unit", "target-unit"], "below-starting-strength.subject") };
    case "characteristic-set":
      exactKeys(input, ["subject", "characteristic", "value"], family);
      return {
        subject: enumValue(input.subject, ["bearer", "this-model", "this-unit"], "characteristic-set.subject"),
        characteristic: enumValue(input.characteristic, ["M", "T", "Sv", "W", "A", "Ld", "OC", "WS", "BS", "S", "AP", "D"], "characteristic-set.characteristic"),
        value: integerOrSource(input.value, "characteristic-set.value"),
      };
    case "weapon-ability-grant": {
      if (version === 1) {
        exactKeys(input, ["subject", "keyword"], family);
        return {
          subject: enumValue(input.subject, ["this-unit", "this-model", "bearer"], "weapon-ability-grant.subject"),
          keyword: enumValue(input.keyword, weaponGrantKeywords, "weapon-ability-grant.keyword"),
        };
      }
      exactKeys(input, ["subject", "keyword", "weapon_type"], family);
      const keyword = input.keyword;
      if (typeof keyword !== "string" || !((weaponGrantKeywords as readonly string[]).includes(keyword) || parameterizedWeaponKeyword.test(keyword))) {
        throw new TypeError(`weapon-ability-grant.keyword must be a named weapon ability such as Lethal Hits or Sustained Hits 1.`);
      }
      return {
        subject: enumValue(input.subject, ["this-unit", "this-model", "bearer"], "weapon-ability-grant.subject"),
        keyword,
        weapon_type: enumValue(input.weapon_type, WEAPON_TYPES, "weapon-ability-grant.weapon_type"),
      };
    }
    case "feel-no-pain":
      exactKeys(input, ["subject", "threshold", "against"], family);
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "feel-no-pain.subject"),
        threshold: boundedInteger(input.threshold, 2, 6, "feel-no-pain.threshold"),
        against: enumValue(input.against, FNP_AGAINST, "feel-no-pain.against"),
      };
    case "invulnerable-save":
      exactKeys(input, ["subject", "threshold"], family);
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "invulnerable-save.subject"),
        threshold: boundedInteger(input.threshold, 2, 6, "invulnerable-save.threshold"),
      };
    case "fights-first":
      exactKeys(input, ["subject"], family);
      return { subject: enumValue(input.subject, BUFF_SUBJECTS, "fights-first.subject") };
    case "characteristic-modifier":
      exactKeys(input, ["subject", "characteristic", "operation", "value"], family);
      return {
        subject: enumValue(input.subject, BUFF_SUBJECTS, "characteristic-modifier.subject"),
        characteristic: enumValue(input.characteristic, CHARACTERISTICS, "characteristic-modifier.characteristic"),
        operation: enumValue(input.operation, ["add", "subtract"], "characteristic-modifier.operation"),
        value: boundedInteger(input.value, 1, 20, "characteristic-modifier.value"),
      };
    default:
      throw new RangeError(`Unknown reviewed semantic family ${family}@${version}.`);
  }
}

/** Decode an exact UTF-8 byte span and reject boundaries that split a code point. */
export function exactSpan(source: string, start: number, end: number): string {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    throw new RangeError("Source span offsets must be ordered, non-negative UTF-8 byte integers.");
  }
  const bytes = Buffer.from(source, "utf8");
  if (end > bytes.length) throw new RangeError(`Source span ends at ${end}, beyond ${bytes.length} UTF-8 bytes.`);
  const selected = bytes.subarray(start, end);
  const text = selected.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(selected)) {
    throw new RangeError("Source span offsets split a UTF-8 code point.");
  }
  return text;
}

/** Seed every registry version once and reject drift in a reviewed definition. */
export function seedReviewedFamilies(db: DatabaseSync): void {
  const select = db.prepare(
    "SELECT role, parameter_schema_json, status FROM semantic_families WHERE id = ? AND version = ?",
  );
  const insert = db.prepare(
    "INSERT INTO semantic_families (id, version, role, parameter_schema_json, status) VALUES (?, ?, ?, ?, ?)",
  );
  const deprecate = db.prepare("UPDATE semantic_families SET status = 'deprecated' WHERE id = ? AND version = ? AND status = 'active'");

  {
    for (const family of REVIEWED_FAMILY_REGISTRY) {
      const schemaJson = JSON.stringify(family.parameterSchema);
      const status = family.deprecated ? "deprecated" : "active";
      const existing = select.get(family.id, family.version) as
        | { role: string; parameter_schema_json: string; status: string }
        | undefined;
      if (!existing) {
        insert.run(family.id, family.version, family.role, schemaJson, status);
        continue;
      }
      if (
        existing.role !== family.role ||
        hashJson(JSON.parse(existing.parameter_schema_json)) !== hashJson(family.parameterSchema)
      ) {
        throw new Error(`Reviewed registry drift for ${family.id}@${family.version}.`);
      }
      // Deprecation is one-way: a version the registry retires stops accepting new leaves.
      if (existing.status !== status) {
        if (existing.status === "deprecated") throw new Error(`Reviewed family ${family.id}@${family.version} was deprecated and cannot return.`);
        deprecate.run(family.id, family.version);
      }
    }
  }
}

/** Require the granted ability name in the exact source-backed effect span. */
export function validateFamilySource(family: string, parameters: Record<string, unknown>, exactText: string): void {
  if (family === "weapon-ability-grant" && !exactText.toLowerCase().includes(String(parameters.keyword).toLowerCase())) {
    throw new TypeError("The granted weapon ability must occur in the exact source span.");
  }
}

/**
 * Insert or return the canonical fingerprint for one reviewed family version.
 *
 * Legacy IDs remain separate historical evidence; callers map them through
 * `legacy_fingerprint_id` instead of reproducing their old hash recipe.
 */
export function validateFingerprint(
  db: DatabaseSync,
  family: string,
  parameters: Record<string, unknown>,
  version = 1,
  exactText?: string,
): string {
  const definition = reviewedFamily(family, version);
  const normalized = normalizeFingerprintParameters(family, parameters, version);
  if (exactText !== undefined && (!exactText || exactText !== exactText.trim())) {
    throw new TypeError("Fingerprint exact text must be nonblank and preserve its source boundaries.");
  }
  if (exactText !== undefined) {
    for (const value of Object.values(normalized)) {
      const source = sourceQualified(value, "Fingerprint parameter");
      if (source && !exactText.includes(source.source)) {
        throw new TypeError("A source-qualified fingerprint value must occur in the exact source span.");
      }
    }
  }
  if (exactText !== undefined) validateFamilySource(family, normalized, exactText);

  const familyRow = db.prepare(
    "SELECT role, parameter_schema_json, status FROM semantic_families WHERE id = ? AND version = ?",
  );
  const stored = familyRow.get(family, version) as
    | { role: string; parameter_schema_json: string; status: string }
    | undefined;
  if (!stored || stored.status !== "active" || stored.role !== definition.role) {
    throw new Error(`Reviewed family ${family}@${version} is not active in this workbench.`);
  }
  if (hashJson(JSON.parse(stored.parameter_schema_json)) !== hashJson(definition.parameterSchema)) {
    throw new Error(`Reviewed family ${family}@${version} does not match the local registry.`);
  }

  const canonicalHash = hashJson({ family, version, parameters: normalized });
  const id = `fp_${canonicalHash}`;
  const parametersJson = JSON.stringify(normalized);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO fingerprints (id, family_id, family_version, parameters_json, canonical_hash, legacy_fingerprint_id, status) VALUES (?, ?, ?, ?, ?, NULL, 'active')",
  );
  const select = db.prepare("SELECT id, family_id, family_version, parameters_json FROM fingerprints WHERE canonical_hash = ?");
  {
    insert.run(id, family, version, parametersJson, canonicalHash);
    const fingerprint = select.get(canonicalHash) as
      | { id: string; family_id: string; family_version: number; parameters_json: string }
      | undefined;
    if (!fingerprint || fingerprint.id !== id || fingerprint.family_id !== family || fingerprint.family_version !== version) {
      throw new Error(`Fingerprint canonical-hash conflict for ${family}@${version}.`);
    }
    if (hashJson(JSON.parse(fingerprint.parameters_json)) !== hashJson(normalized)) {
      throw new Error(`Fingerprint parameter conflict for ${family}@${version}.`);
    }
    return fingerprint.id;
  }
}

export type JsonScalar = string | number | boolean | null;

export type StampSourceReference = {
  ability_version_id: number;
  source_hash: string;
  fragment: string;
  start_byte: number;
  end_byte: number;
  exact_text: string;
  synthetic?: false;
};

export type SyntheticStampReference = {
  synthetic: true;
  source_text: string;
  fragment: string;
  expected_match: boolean;
};

export type StampEvidenceReference = StampSourceReference | SyntheticStampReference;

export type StampSlotDefinition =
  | { kind: "enum"; values: Array<{ text: string; value: JsonScalar }> }
  | { kind: "integer"; min: number; max: number };

export type StampLiteralSegment = { id: string; literal: string };
export type StampSlotSegment = { id: string; slot: string };
export type StampLeafSegment = {
  id: string;
  leaf: {
    family_id: string;
    family_version: number;
    parameters?: Record<string, unknown>;
  };
};
export type StampSegment = StampLiteralSegment | StampSlotSegment | StampLeafSegment;
export type StampFragmentPattern = { fragment: string; segments: StampSegment[] };
export type StampGuard = { boundary: "fragment" | "word" } | { literal: string };
export type StampContainment = {
  other_family_id: string;
  other_family_version: number;
  direction: "contains" | "contained-by";
};
export type StampTemplate =
  | JsonScalar
  | { $bind: string }
  | { $case: string; cases: Array<{ value: JsonScalar; then: StampTemplate }> }
  | StampTemplate[]
  | { [key: string]: StampTemplate };

export type LeafStampVariant = {
  id: string;
  source_types: "any" | Array<string | null>;
  fragments: [StampFragmentPattern];
  slots: Record<string, StampSlotDefinition>;
  before: StampGuard[];
  after: StampGuard[];
  output: {
    family_id: string;
    family_version: number;
    parameters: StampTemplate;
  };
  allow_containment: StampContainment[];
};

export type CompositionStampVariant = {
  id: string;
  source_types: "any" | Array<string | null>;
  fragments: StampFragmentPattern[];
  slots: Record<string, StampSlotDefinition>;
  graph_template: StampTemplate;
  mechanics_template: StampTemplate | null;
};

export type StampDefinition =
  | {
      schema_version: 1;
      kind: "leaf";
      label: string;
      variants: LeafStampVariant[];
    }
  | {
      schema_version: 1;
      kind: "composition";
      label: string;
      variants: CompositionStampVariant[];
    };

export type SourceGraphNode = {
  id: string;
  kind: "leaf" | "participant" | "selector" | "usage" | "binding";
  parameters: Record<string, unknown>;
  evidence: {
    fragment: string;
    first_segment_id: string;
    last_segment_id: string;
    start_byte?: number;
    end_byte?: number;
    exact_text?: string;
  };
  family_id?: string;
  family_version?: number;
};

export type SourceGraphRelation = {
  id: string;
  type: string;
  from_node_id: string;
  to_node_id: string;
  evidence: {
    fragment: string;
    first_segment_id: string;
    last_segment_id: string;
    start_byte?: number;
    end_byte?: number;
    exact_text?: string;
  };
};

export type SourceGraph = {
  schema_version: 1;
  nodes: SourceGraphNode[];
  relations: SourceGraphRelation[];
  roots: string[];
};

export type StampPreviewOccurrence = StampSourceReference & {
  occurrence_id: string;
  variant_id: string;
  bindings: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: "eligible" | "already-satisfied" | "blocked";
  reason_code: string | null;
};

export type StampPreview = {
  stamp_id: string;
  revision: number;
  definition_hash: string;
  preview_hash: string;
  totals: { eligible: number; already_satisfied: number; blocked: number };
  parameter_combinations: Array<Record<string, unknown>>;
  examples: StampPreviewOccurrence[];
  counterexamples: StampEvidenceReference[];
  dependent_drafts: string[];
  next_cursor: string | null;
};

export type StampChallengeState =
  | "not-required"
  | "missing"
  | "self-challenge"
  | "incomplete"
  | "not-pinned"
  | "clear"
  | "objection"
  | "unresolved";

export type StampChallengeReview = {
  required: boolean;
  state: StampChallengeState;
  verdict: "clear" | "objection" | "unresolved" | null;
  run_id: number | null;
};

export type StampApprovalBlocker = {
  code:
    | "STATE"
    | "CHALLENGE_MISSING"
    | "CHALLENGE_SELF"
    | "CHALLENGE_INCOMPLETE"
    | "CHALLENGE_NOT_PINNED"
    | "CHALLENGE_OBJECTION"
    | "CHALLENGE_UNRESOLVED"
    | "HUMAN_SEED";
  message: string;
  status: number;
  next_action: "prepare-challenge" | "resolve-objection" | "seed-occurrence" | "none";
};

export type StampApprovalEligibility = {
  approvable: boolean;
  blocker: StampApprovalBlocker | null;
  challenge: StampChallengeReview;
};

export type WorkPurpose = "propose-rule" | "challenge-rule" | "verify-draft";

export type WorkRequest = {
  schema_version: 1;
  purpose: WorkPurpose;
  run_id: string;
  input_hash: string;
  instructions: string;
  response_schema: Record<string, unknown>;
  items: Array<Record<string, unknown> & { item_id: string; evidence_hash: string }>;
};

export type WorkFinding = {
  message: string;
  evidence: StampEvidenceReference;
};

export type ProposeRuleWorkResult = {
  stamp_id?: string;
  base_revision?: number;
  definition: StampDefinition;
  positives: StampEvidenceReference[];
  counterexamples: StampEvidenceReference[];
  closest_stamp_ids: string[];
  exact_mismatch: string;
  question: string;
  affected_member_ids: string[];
};

export type ChallengeRuleWorkResult = {
  verdict: "clear" | "objection" | "unresolved";
  findings: WorkFinding[];
};

export type VerifyDraftWorkResult = {
  faithful: boolean;
  severity: "ok" | "minor" | "wrong";
  findings: WorkFinding[];
};

export type WorkResult = ProposeRuleWorkResult | ChallengeRuleWorkResult | VerifyDraftWorkResult;

export type WorkResponse = {
  schema_version: 1;
  run_id: string;
  input_hash: string;
  model: string;
  model_version: string;
  prompt_version: string;
  items: Array<{ item_id: string; evidence_hash: string; result: WorkResult }>;
  latency_ms?: number;
  cost_usd?: number;
};
