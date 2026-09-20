import {
  ATOM_FAMILIES,
  RELATION_TYPES,
  type ByteSpan,
  type FrozenDataset,
  type ModelOutputEnvelope,
  type SourceOnlyModelInput,
  type SourceOnlyModelRecord,
} from "./contracts.js";

export const MODEL_OUTPUT_SCHEMA_ID = "round4b-decomposition-v1" as const;

export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["contract_version", "run_id", "faction_id", "ability_id", "source_hash", "atoms", "relations", "diagnostics"],
  properties: {
    contract_version: { const: 1 },
    run_id: { type: "string" },
    faction_id: { type: "string" },
    ability_id: { type: "string" },
    source_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    atoms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "family", "normalized_meaning", "source_span", "source_text"],
        properties: {
          id: { type: "string" },
          family: { type: "string", enum: [...ATOM_FAMILIES] },
          normalized_meaning: { type: "string" },
          source_span: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } },
          },
          source_text: { type: "string" },
          literal: { type: ["string", "number", "boolean", "null"] },
          unit: { type: "string" },
          dice: { type: "string" },
          registry_key: { type: "string" },
          participant: { type: "string" },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "from_atom_id", "to_atom_id"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: [...RELATION_TYPES, "novel_relation"] },
          from_atom_id: { type: "string" },
          to_atom_id: { type: "string" },
          source_span: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } },
          },
          novel_relation: { type: "string" },
        },
        allOf: [{
          if: { properties: { type: { const: "novel_relation" } }, required: ["type"] },
          then: { required: ["novel_relation"] },
        }],
      },
    },
    diagnostics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "message"],
        properties: {
          kind: { type: "string", enum: ["unresolved_atom", "unresolved_relation", "novel_relation"] },
          message: { type: "string" },
          source_span: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } },
          },
          atom_ids: { type: "array", items: { type: "string" } },
          relation_id: { type: "string" },
          novel_relation: { type: "string" },
        },
      },
    },
  },
} as const;

function validateSourceSpan(bytes: Buffer, span: ByteSpan, text: string, label: string, errors: string[]): void {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || span.end > bytes.length) {
    errors.push(`${label} has an out-of-range source span`);
    return;
  }
  if ((span.start > 0 && (bytes[span.start]! & 0xc0) === 0x80) || (span.end < bytes.length && (bytes[span.end]! & 0xc0) === 0x80)) {
    errors.push(`${label} source span is not aligned to UTF-8 boundaries`);
    return;
  }
  if (bytes.subarray(span.start, span.end).toString("utf8") !== text) errors.push(`${label} source text does not match its byte span`);
}

export function validateGroundedModelOutput(record: SourceOnlyModelRecord, output: ModelOutputEnvelope): string[] {
  const errors: string[] = [];
  if (output.contract_version !== 1) errors.push("model output has an unsupported contract version");
  if (output.faction_id !== record.faction_id || output.ability_id !== record.ability_id) errors.push("model output identity does not match frozen source");
  if (output.source_hash !== record.source_hash) errors.push("model output source hash does not match frozen source");

  const bytes = Buffer.from(record.source_text, "utf8");
  const atomIds = new Set<string>();
  for (const atom of output.atoms) {
    if (atomIds.has(atom.id)) errors.push(`duplicate atom id ${atom.id}`);
    atomIds.add(atom.id);
    validateSourceSpan(bytes, atom.source_span, atom.source_text, `atom ${atom.id}`, errors);
  }
  for (const relation of output.relations) {
    if (!atomIds.has(relation.from_atom_id) || !atomIds.has(relation.to_atom_id)) errors.push(`relation ${relation.id} references an unknown atom`);
    if (relation.source_span) validateSourceSpan(bytes, relation.source_span, bytes.subarray(relation.source_span.start, relation.source_span.end).toString("utf8"), `relation ${relation.id}`, errors);
    if (relation.type === "novel_relation" && !output.diagnostics.some((diagnostic) => diagnostic.kind === "novel_relation" && (diagnostic.relation_id === relation.id || diagnostic.novel_relation === relation.novel_relation))) {
      errors.push(`novel relation ${relation.id} lacks a novel_relation diagnostic`);
    }
  }
  for (const [index, diagnostic] of output.diagnostics.entries()) {
    if (diagnostic.source_span) validateSourceSpan(bytes, diagnostic.source_span, bytes.subarray(diagnostic.source_span.start, diagnostic.source_span.end).toString("utf8"), `diagnostic ${index}`, errors);
  }
  return errors;
}

export function assertGroundedModelOutput(record: SourceOnlyModelRecord, output: ModelOutputEnvelope): void {
  const errors = validateGroundedModelOutput(record, output);
  if (errors.length > 0) throw new Error(`Invalid Round 4B model output: ${errors.join("; ")}`);
}

function modelRecord(record: FrozenDataset["records"][number]): SourceOnlyModelRecord {
  return {
    faction_id: record.faction_id,
    ability_id: record.ability_id,
    name: record.name,
    selection: record.selection,
    source_text: record.source_text,
    source_byte_length: record.source_byte_length,
    source_hash: record.source_hash,
    source_fragments: record.source_fragments,
  };
}

export function createSourceOnlyModelInput(dataset: FrozenDataset): SourceOnlyModelInput {
  return {
    contract_version: 1,
    run_id: dataset.run_id,
    cohort_hash: dataset.cohort_hash,
    output_schema: MODEL_OUTPUT_SCHEMA_ID,
    records: dataset.records.map(modelRecord),
  };
}

export function buildDecompositionPrompt(record: SourceOnlyModelRecord): string {
  return [
    "Decompose only the supplied source rule into grounded semantic atoms and reusable relations.",
    "Every atom must quote exact source_text and UTF-8 byte offsets in source_span.",
    "Use a fixed relation type when possible; emit type novel_relation with a diagnostic when none fits.",
    "Emit unresolved_atom or unresolved_relation diagnostics instead of inventing unsupported meaning.",
    "Return one JSON object matching round4b-decomposition-v1.",
    `identity: ${record.faction_id}/${record.ability_id}`,
    `source_hash: ${record.source_hash}`,
    `source_byte_length: ${record.source_byte_length}`,
    "source_text:",
    record.source_text,
  ].join("\n");
}
