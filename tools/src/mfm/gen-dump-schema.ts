import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { Command } from "commander";
import { compile } from "json-schema-to-typescript";

export type JsonSchema = Record<string, unknown>;

export type IpClass =
  | "structural"
  | "numeric"
  | "identifier"
  | "display-name"
  | "prose"
  | "artwork-reference";

export interface CatalogField {
  description: string;
  ip_class: IpClass;
  shape_review: "observed" | "null-only";
  relation?: string;
}

export interface CatalogIdentity {
  fields: string[];
  status: "verified" | "candidate" | "none";
}

export interface CatalogTable {
  description: string;
  row_shape: "observed" | "unobserved";
  identity: CatalogIdentity;
  fields: Record<string, CatalogField>;
  notes?: string;
}

export interface CatalogRelation {
  source_table: string;
  source_field: string;
  target_table: string | null;
  target_field: string | null;
  cardinality: "one-to-one" | "many-to-one" | "many-to-many-edge" | null;
  nullable: boolean;
  status: "verified" | "candidate" | "external" | "unresolved";
  meaning: "ownership" | "applicability" | "eligibility" | "general";
  edge_peer?: string;
}

export interface DumpCatalog {
  $schema: "./dump-catalog.schema.json";
  catalog_version: 1;
  root_fields: Record<string, CatalogField>;
  tables: Record<string, CatalogTable>;
  relations: Record<string, CatalogRelation>;
}

export interface ContractReport {
  ok: boolean;
  errors: string[];
  tables: { observed: number; total: number };
  paths: { observed: number; total: number };
  mappings: { present: number; total: number };
  coverage: Record<string, number>;
}

export interface SourceMappingReport {
  errors: string[];
  present: number;
  total: number;
  coverage: Record<string, number>;
}

interface DumpPayload {
  metadata: { data_version: number; [key: string]: unknown };
  data: Record<string, unknown[]>;
}

interface SourceMappingField {
  provenance: string;
  coverage: string;
  sources: string[];
  joins: Array<{ relation: string; direction: string; purpose: string }>;
  transforms: Array<{ symbol: string; operation: string }>;
  filters: string[];
  precedence: string[];
  consumers: string[];
  reason: string;
}

interface SourceMapping {
  $schema: string;
  entity_schema: string;
  mapping_version: number;
  root_tables: string[];
  fields: Record<string, SourceMappingField>;
  unmapped_mfm_fields: Array<{ source: string; candidate_pointer: string | null; reason: string }>;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_DUMP_PATH = path.join(REPO_ROOT, "_private", "dump.json");
const CATALOG_PATH = path.join(REPO_ROOT, "tools", "src", "mfm", "dump.catalog.json");
const CATALOG_SCHEMA_PATH = path.join(REPO_ROOT, "tools", "src", "mfm", "dump-catalog.schema.json");
const PUBLIC_SCHEMA_PATH = path.join(REPO_ROOT, "tools", "src", "mfm", "dump.schema.json");
const PRIVATE_SCHEMA_PATH = path.join(REPO_ROOT, "_private", "dump.schema.json");
const TYPES_PATH = path.join(REPO_ROOT, "tools", "src", "mfm", "dump.generated.ts");
const MAPPINGS_DIR = path.join(REPO_ROOT, "tools", "src", "mfm", "mappings");
const CORE_SCHEMAS_DIR = path.join(REPO_ROOT, "schemas", "core");
const TYPE_ORDER = ["null", "boolean", "integer", "number", "string", "array", "object"] as const;
const LOCALE_PATTERN = "^[a-z]{2}(?:-[A-Z]{2})?$";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDump(value: unknown): DumpPayload | null {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.data)) return null;
  if (!Number.isInteger(value.metadata.data_version)) return null;
  const data: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(value.data)) {
    if (!Array.isArray(rows)) return null;
    data[name] = rows;
  }
  return { metadata: value.metadata as DumpPayload["metadata"], data };
}

function schemaTypes(schema: JsonSchema): string[] {
  const type = schema.type;
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === "string");
  return [];
}

function orderedTypes(types: Iterable<string>): string[] {
  const unique = new Set(types);
  if (unique.has("number")) unique.delete("integer");
  return TYPE_ORDER.filter((type) => unique.has(type));
}

function withTypes(schema: JsonSchema, types: string[]): JsonSchema {
  if (types.length === 1) return { ...schema, type: types[0] };
  if (types.length > 1) return { ...schema, type: types };
  const { type: _type, ...rest } = schema;
  return rest;
}

function mergeSchemas(left: JsonSchema, right: JsonSchema): JsonSchema {
  if (Object.keys(left).length === 0) return structuredClone(right);
  if (Object.keys(right).length === 0) return structuredClone(left);
  const types = orderedTypes([...schemaTypes(left), ...schemaTypes(right)]);
  let merged: JsonSchema = {};

  if (types.includes("object")) {
    const leftProperties = isRecord(left.properties) ? (left.properties as Record<string, JsonSchema>) : {};
    const rightProperties = isRecord(right.properties) ? (right.properties as Record<string, JsonSchema>) : {};
    const properties: Record<string, JsonSchema> = {};
    for (const key of [...new Set([...Object.keys(leftProperties), ...Object.keys(rightProperties)])].sort()) {
      const a = leftProperties[key];
      const b = rightProperties[key];
      properties[key] = a && b ? mergeSchemas(a, b) : structuredClone((a ?? b)!);
    }
    const leftRequired = new Set(Array.isArray(left.required) ? (left.required as string[]) : []);
    const rightRequired = new Set(Array.isArray(right.required) ? (right.required as string[]) : []);
    merged = {
      ...merged,
      additionalProperties: false,
      properties,
      required: [...leftRequired].filter((key) => rightRequired.has(key)).sort(),
    };
  }

  if (types.includes("array")) {
    const leftItems = isRecord(left.items) ? (left.items as JsonSchema) : {};
    const rightItems = isRecord(right.items) ? (right.items as JsonSchema) : {};
    merged = { ...merged, items: mergeSchemas(leftItems, rightItems) };
  }

  return withTypes(merged, types);
}

/** Infer the exact observed JSON shape without attaching semantic catalog metadata. */
export function inferDumpShape(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "string") return { type: "string" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length === 0 ? {} : value.map(inferDumpShape).reduce(mergeSchemas),
    };
  }
  if (isRecord(value)) {
    const properties = Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, inferDumpShape(value[key])]),
    );
    return {
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    };
  }
  throw new Error(`Unsupported JSON value type: ${typeof value}`);
}

function canonicalPaths(rows: readonly unknown[]): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown, prefix: string, localeKeys: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, prefix, false);
      return;
    }
    if (!isRecord(value)) return;
    for (const [rawKey, child] of Object.entries(value)) {
      const key = localeKeys ? "*" : rawKey;
      const next = prefix ? `${prefix}.${key}` : key;
      paths.add(next);
      visit(child, next, !localeKeys && rawKey === "localisations");
    }
  };
  for (const row of rows) visit(row, "", false);
  return [...paths].sort();
}

function valuesAtPath(rows: readonly unknown[], canonicalPath: string): unknown[] {
  const parts = canonicalPath.split(".");
  const values: unknown[] = [];
  const visit = (value: unknown, index: number): void => {
    if (index === parts.length) {
      values.push(value);
      return;
    }
    if (!isRecord(value)) return;
    const part = parts[index];
    if (part === "*") {
      for (const child of Object.values(value)) visit(child, index + 1);
    } else if (Object.hasOwn(value, part)) {
      visit(value[part], index + 1);
    }
  };
  for (const row of rows) visit(row, 0);
  return values;
}

function annotate(schema: JsonSchema, field: CatalogField, values: readonly unknown[], relation?: CatalogRelation): JsonSchema {
  const annotated: JsonSchema = {
    ...schema,
    description: field.description,
    "x-mfm": {
      ipClass: field.ip_class,
      shapeReview: field.shape_review,
      observedPresent: values.length,
      observedNulls: values.filter((value) => value === null).length,
      ...(relation ? { relation: canonicalize(relation) } : {}),
    },
  };
  return annotated;
}

function localePayloads(rows: readonly unknown[]): { locales: string[]; payloads: Record<string, unknown>[] } {
  const locales = new Set<string>();
  const payloads: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row.localisations)) continue;
    for (const [locale, payload] of Object.entries(row.localisations)) {
      locales.add(locale);
      if (isRecord(payload)) payloads.push(payload);
    }
  }
  return { locales: [...locales].sort(), payloads };
}

function buildObservedTable(
  tableName: string,
  rows: readonly unknown[],
  catalog: DumpCatalog,
  localeDefinitions: Record<string, JsonSchema>,
): JsonSchema {
  const tableCatalog = catalog.tables[tableName];
  const inferred = rows.map(inferDumpShape).reduce(mergeSchemas);
  if (!isRecord(inferred.properties)) throw new Error(`Observed MFM table "${tableName}" has a non-object row`);
  const properties = inferred.properties as Record<string, JsonSchema>;

  for (const fieldName of Object.keys(properties).sort()) {
    const catalogField = tableCatalog.fields[fieldName];
    if (!catalogField) throw new Error(`Catalog field "${tableName}.${fieldName}" is missing`);
    const relation = catalogField.relation ? catalog.relations[catalogField.relation] : undefined;
    if (fieldName !== "localisations") {
      properties[fieldName] = annotate(properties[fieldName], catalogField, valuesAtPath(rows, fieldName), relation);
      continue;
    }

    const { locales, payloads } = localePayloads(rows);
    const payloadSchema = payloads.length === 0 ? {} : payloads.map(inferDumpShape).reduce(mergeSchemas);
    if (isRecord(payloadSchema.properties)) {
      const payloadProperties = payloadSchema.properties as Record<string, JsonSchema>;
      for (const payloadField of Object.keys(payloadProperties).sort()) {
        const pathName = `localisations.*.${payloadField}`;
        const field = tableCatalog.fields[pathName];
        if (!field) throw new Error(`Catalog field "${tableName}.${pathName}" is missing`);
        const payloadValues = payloads.filter((payload) => Object.hasOwn(payload, payloadField)).map((payload) => payload[payloadField]);
        payloadProperties[payloadField] = annotate(payloadProperties[payloadField], field, payloadValues);
      }
    }
    const payloadCatalog = tableCatalog.fields["localisations.*"];
    localeDefinitions[tableName] = payloadCatalog
      ? annotate(payloadSchema, payloadCatalog, payloads)
      : payloadSchema;
    properties[fieldName] = annotate(
      {
        type: "object",
        additionalProperties: false,
        patternProperties: {
          [LOCALE_PATTERN]: { $ref: `#/$defs/localisations/${tableName}` },
        },
        "x-mfm": { observedLocales: locales },
      },
      catalogField,
      valuesAtPath(rows, fieldName),
    );
    const annotation = properties[fieldName]["x-mfm"] as Record<string, unknown>;
    annotation.observedLocales = locales;
  }

  return {
    ...inferred,
    description: tableCatalog.description,
    properties: Object.fromEntries(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))),
    required: Array.isArray(inferred.required) ? [...(inferred.required as string[])].sort() : [],
    "x-mfm": { identity: canonicalize(tableCatalog.identity) },
  };
}

function catalogSchemaErrors(catalog: unknown): string[] {
  if (!existsSync(CATALOG_SCHEMA_PATH)) {
    return [`Missing MFM dump catalog schema "${path.relative(REPO_ROOT, CATALOG_SCHEMA_PATH)}"`];
  }
  const schema = JSON.parse(readFileSync(CATALOG_SCHEMA_PATH, "utf8")) as JsonSchema;
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (validate(catalog)) return [];
  return (validate.errors ?? []).map(
    (item) => `MFM dump catalog ${item.instancePath || "/"} ${item.message}`,
  );
}

function catalogErrors(dump: unknown, catalog: DumpCatalog): string[] {
  const errors: string[] = [];
  const shapeErrors = catalogSchemaErrors(catalog);
  if (shapeErrors.length) return shapeErrors;
  const payload = asDump(dump);
  if (!payload) return ["MFM dump root must contain metadata.data_version (integer) and data (object of arrays)"];

  const actualTables = Object.keys(payload.data).sort();
  const catalogTables = Object.keys(catalog.tables).sort();
  for (const table of actualTables.filter((name) => !catalog.tables[name])) errors.push(`Catalog table "${table}" is missing`);
  for (const table of catalogTables.filter((name) => !Object.hasOwn(payload.data, name))) errors.push(`Catalog table "${table}" is not present in the dump`);

  for (const tableName of actualTables) {
    const table = catalog.tables[tableName];
    if (!table) continue;
    const rows = payload.data[tableName];
    const observedShape = rows.length === 0 ? "unobserved" : "observed";
    if (table.row_shape !== observedShape) {
      errors.push(`Catalog table "${tableName}" row_shape is "${table.row_shape}" but the dump is "${observedShape}"`);
    }
    // Empty tables have no observable paths or field values. Keep reviewed field
    // semantics so a future populated snapshot must match them when it returns.
    if (rows.length > 0) {
      const observedPaths = canonicalPaths(rows);
      for (const field of observedPaths.filter((name) => !table.fields[name])) errors.push(`Catalog field "${tableName}.${field}" is missing`);
      for (const field of Object.keys(table.fields).filter((name) => !observedPaths.includes(name))) {
        errors.push(`Catalog field "${tableName}.${field}" is not present in the dump`);
      }
      for (const [field, annotation] of Object.entries(table.fields)) {
        const values = valuesAtPath(rows, field);
        const expected = values.length > 0 && values.every((value) => value === null) ? "null-only" : "observed";
        if (annotation.shape_review !== expected) {
          errors.push(`Catalog field "${tableName}.${field}" shape_review is "${annotation.shape_review}" but observed shape is "${expected}"`);
        }
        if (!field.includes(".") && field !== "id" && field.endsWith("Id")) {
          const relationKey = `${tableName}.${field}`;
          if (annotation.relation !== relationKey) errors.push(`Catalog field "${relationKey}" must declare relation "${relationKey}"`);
        }
        if (annotation.relation && !catalog.relations[annotation.relation]) {
          errors.push(`Catalog field "${tableName}.${field}" references unknown relation "${annotation.relation}"`);
        }
      }
    }

    if (table.identity.status === "verified") {
      const identities = new Set<string>();
      rows.forEach((row, index) => {
        if (!isRecord(row)) {
          errors.push(`Catalog table "${tableName}" identity cannot be checked on non-object row ${index}`);
          return;
        }
        const tuple = table.identity.fields.map((field) => row[field]);
        if (tuple.some((value) => value === null || value === undefined)) {
          errors.push(`Catalog table "${tableName}" verified identity is missing or null at row ${index}`);
          return;
        }
        const key = JSON.stringify(tuple);
        if (identities.has(key)) errors.push(`Catalog table "${tableName}" has duplicate verified identity ${key}`);
        identities.add(key);
      });
    }
  }

  const relationIdentities = new Map<string, string>();
  for (const [relationKey, relation] of Object.entries(catalog.relations).sort(([a], [b]) => a.localeCompare(b))) {
    const identity = [
      `${relation.source_table}.${relation.source_field}`,
      `${relation.target_table}.${relation.target_field}`,
      relation.cardinality,
      relation.meaning,
    ].join(" -> ");
    const previousRelation = relationIdentities.get(identity);
    if (previousRelation) {
      errors.push(
        `Catalog relations "${previousRelation}" and "${relationKey}" duplicate semantic relation ${identity}`,
      );
    } else {
      relationIdentities.set(identity, relationKey);
    }
    if (relationKey !== `${relation.source_table}.${relation.source_field}`) {
      errors.push(`Catalog relation "${relationKey}" key does not match its source`);
      continue;
    }
    const sourceRows = payload.data[relation.source_table];
    if (!sourceRows) {
      errors.push(`Catalog relation "${relationKey}" references unknown source table "${relation.source_table}"`);
      continue;
    }
    const values = sourceRows
      .filter(isRecord)
      .filter((row) => Object.hasOwn(row, relation.source_field))
      .map((row) => row[relation.source_field]);
    const observedNullable = values.some((value) => value === null);
    if (relation.nullable !== observedNullable) {
      errors.push(`Catalog relation "${relationKey}" nullable=${relation.nullable} does not match observed nullable=${observedNullable}`);
    }
    if (relation.status === "external") {
      if (relation.target_table !== null || relation.target_field !== null || relation.cardinality !== null) {
        errors.push(`Catalog relation "${relationKey}" external relations require null target and cardinality`);
      }
      continue;
    }
    if (relation.status === "verified") {
      if (!relation.target_table || relation.target_field !== "id" || !relation.cardinality) {
        errors.push(`Catalog relation "${relationKey}" verified relations require a target id and cardinality`);
        continue;
      }
      const targetCatalog = catalog.tables[relation.target_table];
      if (!targetCatalog || targetCatalog.identity.status !== "verified" || targetCatalog.identity.fields.length !== 1 || targetCatalog.identity.fields[0] !== "id") {
        errors.push(`Catalog relation "${relationKey}" target must have verified identity ["id"]`);
        continue;
      }
      const targetRows = payload.data[relation.target_table] ?? [];
      const targetIds = new Set(targetRows.filter(isRecord).map((row) => row.id).filter((id): id is string => typeof id === "string"));
      values.forEach((value, index) => {
        if (value !== null && (typeof value !== "string" || !targetIds.has(value))) {
          errors.push(`Catalog relation "${relationKey}" has dangling target at source row ${index}`);
        }
      });
      if (relation.cardinality === "one-to-one") {
        const nonNull = values.filter((value): value is string => typeof value === "string");
        if (new Set(nonNull).size !== nonNull.length) errors.push(`Catalog relation "${relationKey}" violates one-to-one cardinality`);
      }
    }
    if (relation.edge_peer) {
      const peer = catalog.relations[relation.edge_peer];
      if (!peer || peer.edge_peer !== relationKey) {
        errors.push(`Catalog relation "${relationKey}" has malformed or nonreciprocal edge_peer`);
      } else if (
        relation.cardinality === "many-to-many-edge" &&
        peer.cardinality === "many-to-many-edge" &&
        peer.source_table === relation.source_table &&
        relationKey.localeCompare(relation.edge_peer) < 0
      ) {
        const edges = new Set<string>();
        sourceRows.filter(isRecord).forEach((row, index) => {
          const pair = [row[relation.source_field], row[peer.source_field]];
          if (pair.some((value) => value === null || value === undefined)) return;
          const key = JSON.stringify(pair);
          if (edges.has(key)) {
            errors.push(
              `Catalog relations "${relationKey}" and "${relation.edge_peer}" have duplicate edge ${key} at source row ${index}`,
            );
          }
          edges.add(key);
        });
      }
    }
  }
  return errors;
}

/** Validate only the observed dump shape and reviewed catalog semantics. */
export function validateDumpCatalog(dump: unknown, catalog: DumpCatalog): string[] {
  return catalogErrors(dump, catalog);
}

/** Build the reviewed, closed dump schema from observed facts plus catalog semantics. */
export function buildDumpSchema(dump: unknown, catalog: DumpCatalog): JsonSchema {
  const errors = catalogErrors(dump, catalog);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const payload = asDump(dump)!;
  const tableDefinitions: Record<string, JsonSchema> = {};
  const localeDefinitions: Record<string, JsonSchema> = {};
  const dataProperties: Record<string, JsonSchema> = {};

  for (const tableName of Object.keys(payload.data).sort()) {
    const rows = payload.data[tableName];
    if (rows.length === 0) {
      dataProperties[tableName] = {
        type: "array",
        items: {},
        maxItems: 0,
        "x-mfm": { observedRows: 0, rowShape: "unobserved" },
      };
      continue;
    }
    tableDefinitions[tableName] = buildObservedTable(tableName, rows, catalog, localeDefinitions);
    dataProperties[tableName] = {
      type: "array",
      items: { $ref: `#/$defs/tables/${tableName}` },
      "x-mfm": { observedRows: rows.length, rowShape: "observed" },
    };
  }

  const metadataSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      data_version: annotate(
        { type: "integer" },
        catalog.root_fields["metadata.data_version"],
        [payload.metadata.data_version],
      ),
    },
    required: ["data_version"],
    description: catalog.root_fields.metadata.description,
    "x-mfm": {
      ipClass: catalog.root_fields.metadata.ip_class,
      shapeReview: catalog.root_fields.metadata.shape_review,
      observedPresent: 1,
      observedNulls: 0,
    },
  };
  const dataSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: dataProperties,
    required: Object.keys(dataProperties).sort(),
    description: catalog.root_fields.data.description,
    "x-mfm": {
      ipClass: catalog.root_fields.data.ip_class,
      shapeReview: catalog.root_fields.data.shape_review,
      observedPresent: 1,
      observedNulls: 0,
    },
  };

  return canonicalize({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: { metadata: metadataSchema, data: dataSchema },
    required: ["metadata", "data"],
    $defs: {
      tables: tableDefinitions,
      localisations: localeDefinitions,
    },
    "x-mfm": {
      dataVersion: payload.metadata.data_version,
      catalogVersion: catalog.catalog_version,
    },
  }) as JsonSchema;
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function rewriteRefs(value: unknown, tableNames: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRefs(item, tableNames));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      const tableMatch = child.match(/^#\/\$defs\/tables\/(.+)$/);
      const localeMatch = child.match(/^#\/\$defs\/localisations\/(.+)$/);
      if (tableMatch && tableNames.has(tableMatch[1])) out[key] = `#/$defs/${pascalCase(tableMatch[1])}Row`;
      else if (localeMatch) out[key] = `#/$defs/${pascalCase(localeMatch[1])}Localisation`;
      else out[key] = child;
    } else {
      out[key] = rewriteRefs(child, tableNames);
    }
  }
  return out;
}

/** Compile deterministic TypeScript rows and verified relation types from the generated schema. */
export async function buildDumpTypes(schema: JsonSchema, catalog: DumpCatalog): Promise<string> {
  const definitions = schema.$defs as { tables: Record<string, JsonSchema>; localisations: Record<string, JsonSchema> };
  const rootProperties = schema.properties as Record<string, JsonSchema>;
  const dataSchema = rootProperties.data;
  const metadataSchema = rootProperties.metadata;
  const dataProperties = (dataSchema.properties ?? {}) as Record<string, JsonSchema>;
  const tableNames = new Set(Object.keys(dataProperties));
  const syntheticDefs: Record<string, JsonSchema> = {
    MfmMetadata: rewriteRefs(metadataSchema, tableNames) as JsonSchema,
  };
  const tableMapProperties: Record<string, JsonSchema> = {};

  for (const tableName of [...tableNames].sort()) {
    const rowName = `${pascalCase(tableName)}Row`;
    const localeName = `${pascalCase(tableName)}Localisation`;
    const rowSchema = definitions.tables[tableName];
    if (rowSchema) syntheticDefs[rowName] = rewriteRefs(rowSchema, tableNames) as JsonSchema;
    if (definitions.localisations[tableName]) {
      syntheticDefs[localeName] = rewriteRefs(definitions.localisations[tableName], tableNames) as JsonSchema;
    }
    tableMapProperties[tableName] = rewriteRefs(dataProperties[tableName], tableNames) as JsonSchema;
  }
  syntheticDefs.MfmTableMap = {
    type: "object",
    additionalProperties: false,
    properties: tableMapProperties,
    required: Object.keys(tableMapProperties).sort(),
  };

  const synthetic: JsonSchema = {
    title: "MfmDumpPayload",
    type: "object",
    additionalProperties: false,
    properties: {
      metadata: { $ref: "#/$defs/MfmMetadata" },
      data: { $ref: "#/$defs/MfmTableMap" },
    },
    required: ["metadata", "data"],
    $defs: syntheticDefs,
  };
  const compiled = await compile(synthetic as never, "MfmDumpPayload", {
    additionalProperties: false,
    bannerComment: "/* Generated from dump.catalog.json and _private/dump.json by 'npm run mfm:contract -- --write'. DO NOT EDIT BY HAND. */",
    format: true,
    style: { printWidth: 120, singleQuote: false, trailingComma: "all" },
    unknownAny: true,
    unreachableDefinitions: true,
  });

  const verifiedRelations = Object.fromEntries(
    Object.entries(catalog.relations)
      .filter(([, relation]) => relation.status === "verified")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, relation]) => [
        name,
        {
          sourceTable: relation.source_table,
          sourceField: relation.source_field,
          targetTable: relation.target_table,
          targetField: relation.target_field,
          cardinality: relation.cardinality,
          nullable: relation.nullable,
          meaning: relation.meaning,
        },
      ]),
  );
  const idTables = Object.entries(catalog.tables)
    .filter(([, table]) => table.identity.status === "verified" && table.identity.fields.length === 1 && table.identity.fields[0] === "id")
    .map(([name]) => name)
    .sort();
  const idTableUnion = idTables.map((name) => JSON.stringify(name)).join(" | ") || "never";

  return `${compiled.trimEnd()}\n\nexport type MfmTableName = keyof MfmTableMap;\nexport type MfmRow<N extends MfmTableName> = MfmTableMap[N][number];\nexport type MfmIdTableName = ${idTableUnion};\nexport type MfmStringKey<N extends MfmTableName> = {\n  [K in keyof MfmRow<N>]-?: Exclude<MfmRow<N>[K], null | undefined> extends string ? K : never;\n}[keyof MfmRow<N>] & string;\n\nexport const MFM_RELATIONS = ${JSON.stringify(verifiedRelations, null, 2)} as const;\n\nexport type MfmRelationName = keyof typeof MFM_RELATIONS;\nexport type MfmRelationSource<R extends MfmRelationName> = MfmRow<(typeof MFM_RELATIONS)[R]["sourceTable"]>;\nexport type MfmRelationTarget<R extends MfmRelationName> = MfmRow<(typeof MFM_RELATIONS)[R]["targetTable"]>;\n`;
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(document: unknown, fragment: string): unknown {
  if (fragment === "" || fragment === "#") return document;
  if (!fragment.startsWith("#/")) throw new Error(`Unsupported schema fragment "${fragment}"`);
  return fragment
    .slice(2)
    .split("/")
    .map(decodePointerToken)
    .reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), document);
}

function pointerToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Enumerate every entity instance pointer, expanding shared value refs but stopping at entity refs. */
export function enumerateEntityPointers(schemaPath: string): string[] {
  const rootPath = path.resolve(schemaPath);
  const documents = new Map<string, unknown>();
  const load = (file: string): unknown => {
    const resolved = path.resolve(file);
    const cached = documents.get(resolved);
    if (cached) return cached;
    const parsed = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
    documents.set(resolved, parsed);
    return parsed;
  };
  load(rootPath);
  const pointers = new Set<string>();
  const active = new Set<string>();

  const visit = (node: unknown, file: string, pointer: string, isRoot: boolean): void => {
    if (!isRecord(node)) return;
    const ref = node.$ref;
    if (typeof ref === "string") {
      const [filePart, rawFragment = ""] = ref.split("#", 2);
      const directTarget = filePart ? path.resolve(path.dirname(file), filePart) : file;
      const normalizedTarget =
        existsSync(directTarget) || !directTarget.includes(`${path.sep}schemas${path.sep}defs${path.sep}`)
          ? directTarget
          : directTarget.replace(`${path.sep}schemas${path.sep}defs${path.sep}`, `${path.sep}schemas${path.sep}$defs${path.sep}`);
      const targetBase = path.basename(normalizedTarget);
      const entityRoots = [CORE_SCHEMAS_DIR, path.join(REPO_ROOT, "schemas", "enrichment")];
      if (
        filePart &&
        normalizedTarget !== rootPath &&
        entityRoots.some((entityRoot) => normalizedTarget.startsWith(`${entityRoot}${path.sep}`))
      ) {
        return;
      }
      if (filePart && targetBase.endsWith("-ref.schema.json")) {
        const wrapper = load(normalizedTarget);
        visit(wrapper, normalizedTarget, pointer, false);
        return;
      }
      const key = `${normalizedTarget}#${rawFragment}`;
      if (active.has(key)) return;
      active.add(key);
      const target = resolvePointer(load(normalizedTarget), rawFragment ? `#${rawFragment}` : "#");
      visit(target, normalizedTarget, pointer, false);
      active.delete(key);
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const branches = node[keyword];
      if (Array.isArray(branches)) for (const branch of branches) visit(branch, file, pointer, false);
    }
    if (isRecord(node.properties)) {
      for (const [name, property] of Object.entries(node.properties).sort(([a], [b]) => a.localeCompare(b))) {
        const childPointer = `${pointer}/${pointerToken(name)}`;
        pointers.add(childPointer);
        visit(property, file, childPointer, false);
      }
    }
    if (node.type === "array" || node.items !== undefined) {
      const itemPointer = `${pointer}/*`;
      pointers.add(itemPointer);
      visit(node.items, file, itemPointer, false);
    }
    if (isRoot && isRecord(node.$defs)) {
      // Local definitions are reached through $ref; do not emit detached pointers.
    }
  };
  visit(load(rootPath), rootPath, "", true);
  return [...pointers].sort();
}

export function validateSourceMappings(catalog: DumpCatalog, mappingsDir: string): SourceMappingReport {
  const errors: string[] = [];
  const coverage: Record<string, number> = {};
  const schemaFiles = readdirSync(CORE_SCHEMAS_DIR).filter((name) => name.endsWith(".schema.json")).sort();
  let present = 0;
  const sourceMapSchemaPath = path.join(path.dirname(mappingsDir), "mfm-source-map.schema.json");
  let validateMapping: ValidateFunction | null = null;
  if (!existsSync(sourceMapSchemaPath)) {
    errors.push(`Missing MFM source-map schema "${path.relative(REPO_ROOT, sourceMapSchemaPath)}"`);
  } else {
    try {
      const sourceMapSchema = JSON.parse(readFileSync(sourceMapSchemaPath, "utf8"));
      validateMapping = new Ajv2020({ allErrors: true, strict: false }).compile(sourceMapSchema);
    } catch (error) {
      errors.push(
        `Invalid MFM source-map schema "${path.relative(REPO_ROOT, sourceMapSchemaPath)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const schemaFile of schemaFiles) {
    const basename = schemaFile.slice(0, -".schema.json".length);
    const mappingPath = path.join(mappingsDir, `${basename}.mapping.json`);
    const mappingFile = path.relative(REPO_ROOT, mappingPath);
    if (!existsSync(mappingPath)) {
      errors.push(`Missing MFM source mapping "${path.relative(REPO_ROOT, mappingPath)}"`);
      continue;
    }
    present++;
    let mapping: SourceMapping;
    try {
      mapping = JSON.parse(readFileSync(mappingPath, "utf8")) as SourceMapping;
    } catch (error) {
      errors.push(`Mapping "${basename}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (validateMapping && !validateMapping(mapping)) {
      const detail = (validateMapping.errors ?? []).map((item) => `${item.instancePath || "/"} ${item.message}`).join("; ");
      errors.push(`Mapping "${basename}" does not match mfm-source-map.schema.json: ${detail}`);
      continue;
    }
    const expectedEntitySchema = `schemas/core/${schemaFile}`;
    if (mapping.entity_schema !== expectedEntitySchema) errors.push(`Mapping "${basename}" entity_schema must be "${expectedEntitySchema}"`);
    const expectedPointers = enumerateEntityPointers(path.join(CORE_SCHEMAS_DIR, schemaFile));
    for (const pointer of expectedPointers.filter((item) => !Object.hasOwn(mapping.fields, item))) {
      errors.push(`MFM source-map ${mappingFile}: missing field mapping for ${pointer}`);
    }
    for (const pointer of Object.keys(mapping.fields).filter((item) => !expectedPointers.includes(item))) {
      errors.push(`MFM source-map ${mappingFile}: extra field mapping for ${pointer}`);
    }
    for (const rootTable of mapping.root_tables) {
      if (!catalog.tables[rootTable]) errors.push(`Mapping "${basename}": unknown root table "${rootTable}"`);
    }
    for (const [pointer, field] of Object.entries(mapping.fields)) {
      coverage[field.coverage] = (coverage[field.coverage] ?? 0) + 1;
      for (const source of field.sources) {
        const match = source.match(/^data\.([^.]+)\.(.+)$/);
        const sourceField =
          catalog.root_fields[source] ?? (match ? catalog.tables[match[1]]?.fields[match[2]] : undefined);
        if (!sourceField) {
          errors.push(`MFM source-map ${mappingFile}: unknown source path ${source}`);
          continue;
        }
        const ipClass = sourceField.ip_class;
        if (ipClass === "prose" && field.provenance === "direct") {
          errors.push(`Mapping "${basename}" field "${pointer}": prose source "${source}" cannot be direct entity data`);
        }
        if (ipClass === "artwork-reference" && (field.coverage === "implemented" || field.coverage === "partial")) {
          errors.push(`Mapping "${basename}" field "${pointer}": artwork source "${source}" cannot be implemented entity data`);
        }
      }
      for (const join of field.joins) {
        const relation = catalog.relations[join.relation];
        if (!relation) {
          errors.push(`Mapping "${basename}" field "${pointer}": unknown relation "${join.relation}"`);
          continue;
        }
        if ((field.coverage === "implemented" || field.coverage === "partial") && relation.status !== "verified") {
          errors.push(`Mapping "${basename}" field "${pointer}": ${field.coverage} join "${join.relation}" is not verified`);
        }
        if (join.purpose !== relation.meaning) {
          errors.push(`Mapping "${basename}" field "${pointer}": join "${join.relation}" purpose "${join.purpose}" differs from catalog meaning "${relation.meaning}"`);
        }
      }
    }
    for (const entry of mapping.unmapped_mfm_fields) {
      const match = entry.source.match(/^data\.([^.]+)\.(.+)$/);
      const sourceField =
        catalog.root_fields[entry.source] ?? (match ? catalog.tables[match[1]]?.fields[match[2]] : undefined);
      if (!sourceField) {
        errors.push(`Mapping "${basename}" unmapped source "${entry.source}" is unknown`);
      }
      if (entry.candidate_pointer !== null && !expectedPointers.includes(entry.candidate_pointer)) {
        errors.push(`Mapping "${basename}" unmapped source "${entry.source}" has unknown candidate pointer "${entry.candidate_pointer}"`);
      }
    }
  }
  return { errors, present, total: schemaFiles.length, coverage };
}

/** Validate the dump/catalog/mapping contract and return deterministic completeness diagnostics. */
export function checkDumpContract(dump: unknown, catalog: DumpCatalog, mappingsDir: string): ContractReport {
  const errors = catalogErrors(dump, catalog);
  const payload = asDump(dump);
  const mappings = validateSourceMappings(catalog, mappingsDir);
  errors.push(...mappings.errors);
  const observedPaths = payload ? Object.values(payload.data).reduce((total, rows) => total + canonicalPaths(rows).length, 0) : 0;
  return {
    ok: errors.length === 0,
    errors,
    tables: { observed: payload ? Object.keys(payload.data).length : 0, total: Object.keys(catalog.tables).length },
    paths: {
      observed: observedPaths,
      total: Object.values(catalog.tables).reduce((total, table) => total + Object.keys(table.fields).length, 0),
    },
    mappings: { present: mappings.present, total: mappings.total },
    coverage: Object.fromEntries(Object.entries(mappings.coverage).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function readCatalog(): DumpCatalog {
  const schema = JSON.parse(readFileSync(CATALOG_SCHEMA_PATH, "utf8")) as JsonSchema;
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as DumpCatalog;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(catalog)) {
    const detail = (validate.errors ?? []).map((item) => `${item.instancePath || "/"} ${item.message}`).join("\n");
    throw new Error(`Invalid MFM dump catalog:\n${detail}`);
  }
  return catalog;
}

function resolvedWritePath(target: string): string {
  return existsSync(target) ? realpathSync(target) : target;
}

function atomicWriteAll(files: Array<{ target: string; bytes: string }>): void {
  const pending: Array<{ temp: string; target: string }> = [];
  try {
    for (const file of files) {
      const target = resolvedWritePath(file.target);
      const temp = `${target}.tmp-${process.pid}`;
      writeFileSync(temp, file.bytes);
      pending.push({ temp, target });
    }
    for (const file of pending) renameSync(file.temp, file.target);
  } catch (error) {
    for (const file of pending) rmSync(file.temp, { force: true });
    throw error;
  }
}

export interface GeneratedMfmContract {
  dump: unknown;
  catalog: DumpCatalog;
  schemaBytes: string;
  typeBytes: string;
  report: ContractReport;
}

async function generate(dumpPath: string): Promise<GeneratedMfmContract> {
  if (!existsSync(dumpPath)) {
    throw new Error(`MFM dump not found at ${dumpPath}.`);
  }
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as unknown;
  const catalog = readCatalog();
  const report = checkDumpContract(dump, catalog, MAPPINGS_DIR);
  if (!report.ok) throw new Error(report.errors.join("\n"));
  const schema = buildDumpSchema(dump, catalog);
  const schemaBytes = jsonBytes(schema);
  const typeBytes = await buildDumpTypes(schema, catalog);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(dump)) {
    const detail = (validate.errors ?? []).map((item) => `${item.instancePath || "/"} ${item.message}`).join("\n");
    throw new Error(`Generated MFM schema rejected the source dump:\n${detail}`);
  }
  return { dump, catalog, schemaBytes, typeBytes, report };
}

function contractDrift(generated: GeneratedMfmContract, checkPrivateMirror: boolean): boolean {
  const files = [
    [PUBLIC_SCHEMA_PATH, generated.schemaBytes],
    [TYPES_PATH, generated.typeBytes],
    ...(checkPrivateMirror ? [[resolvedWritePath(PRIVATE_SCHEMA_PATH), generated.schemaBytes]] : []),
  ];
  return files.some(([target, bytes]) => !existsSync(target) || readFileSync(target, "utf8") !== bytes);
}

/** Validate an external MFM dump against the reviewed contract and generated artifacts. */
export async function checkMfmContract(
  dumpPath: string,
  options: { checkPrivateMirror: boolean },
): Promise<ContractReport> {
  const generated = await generate(dumpPath);
  if (contractDrift(generated, options.checkPrivateMirror)) {
    throw new Error('MFM contract drift: run "npm run mfm:contract -- --write"');
  }
  return generated.report;
}

async function runCli(argv: string[]): Promise<void> {
  const command = new Command()
    .name("mfm:contract")
    .description("Generate, check, or report the public MFM dump contract")
    .option("--write", "validate and atomically write generated contract files")
    .option("--check", "validate and fail when generated contract files drift")
    .option("--report", "print contract and source-mapping completeness")
    .option("--dump <path>", "validate an explicit dump outside _private");
  command.parse(argv, { from: "user" });
  const options = command.opts<{ write?: boolean; check?: boolean; report?: boolean; dump?: string }>();
  const modes = [options.write, options.check, options.report].filter(Boolean).length;
  if (modes !== 1) throw new Error("Choose exactly one of --write, --check, or --report");
  const dumpPath = options.dump ? path.resolve(options.dump) : DEFAULT_DUMP_PATH;

  if (options.check) {
    const report = await checkMfmContract(dumpPath, { checkPrivateMirror: !options.dump });
    console.log(`MFM contract current: ${report.tables.total}/${report.tables.total} tables, ${report.paths.total}/${report.paths.total} paths.`);
    return;
  }

  const generated = await generate(dumpPath);
  if (options.write) {
    atomicWriteAll([
      { target: PUBLIC_SCHEMA_PATH, bytes: generated.schemaBytes },
      ...(options.dump ? [] : [{ target: PRIVATE_SCHEMA_PATH, bytes: generated.schemaBytes }]),
      { target: TYPES_PATH, bytes: generated.typeBytes },
    ]);
    console.log(`Wrote MFM contract for ${generated.report.tables.total} tables and ${generated.report.paths.total} canonical paths.`);
    return;
  }

  const coverage = Object.entries(generated.report.coverage)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
  console.log(`tables ${generated.report.tables.observed}/${generated.report.tables.total}`);
  console.log(`canonical paths ${generated.report.paths.observed}/${generated.report.paths.total}`);
  console.log(`core schema mappings ${generated.report.mappings.present}/${generated.report.mappings.total}`);
  console.log(`coverage ${coverage}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
