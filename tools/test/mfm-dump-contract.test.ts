import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildDumpSchema,
  buildDumpTypes,
  validateDumpCatalog,
  type CatalogField,
  type DumpCatalog,
} from "../src/mfm/gen-dump-schema.js";

const SENTINEL_NAME = "SENTINEL_DISPLAY_VALUE_ZZZ";
const SENTINEL_PROSE = "SENTINEL_RULE_PROSE_QWX";

function field(
  ipClass: CatalogField["ip_class"],
  shapeReview: CatalogField["shape_review"] = "observed",
  relation?: string,
): CatalogField {
  return {
    description: `Reviewed ${ipClass} field.`,
    ip_class: ipClass,
    shape_review: shapeReview,
    ...(relation ? { relation } : {}),
  };
}

function catalog(): DumpCatalog {
  return {
    $schema: "./dump-catalog.schema.json",
    catalog_version: 1,
    root_fields: {
      metadata: field("structural"),
      "metadata.data_version": field("numeric"),
      data: field("structural"),
    },
    tables: {
      alpha: {
        description: "Fixture source rows.",
        row_shape: "observed",
        identity: { fields: ["id"], status: "verified" },
        fields: {
          count: field("numeric"),
          id: field("identifier"),
          localisations: field("structural"),
          "localisations.*": field("structural"),
          "localisations.*.lore": field("prose"),
          "localisations.*.name": field("display-name"),
          note: field("prose", "null-only"),
          optional: field("identifier"),
          targetId: field("identifier", "observed", "alpha.targetId"),
        },
      },
      beta: {
        description: "Fixture relation targets.",
        row_shape: "observed",
        identity: { fields: ["id"], status: "verified" },
        fields: { id: field("identifier") },
      },
      edge: {
        description: "Fixture many-to-many edges.",
        row_shape: "observed",
        identity: { fields: [], status: "none" },
        fields: {
          leftId: field("identifier", "observed", "edge.leftId"),
          rightId: field("identifier", "observed", "edge.rightId"),
        },
      },
      empty: {
        description: "Observed empty table.",
        row_shape: "unobserved",
        identity: { fields: [], status: "none" },
        fields: {},
      },
    },
    relations: {
      "alpha.targetId": {
        source_table: "alpha",
        source_field: "targetId",
        target_table: "beta",
        target_field: "id",
        cardinality: "many-to-one",
        nullable: false,
        status: "verified",
        meaning: "ownership",
      },
      "edge.leftId": {
        source_table: "edge",
        source_field: "leftId",
        target_table: "alpha",
        target_field: "id",
        cardinality: "many-to-many-edge",
        nullable: false,
        status: "verified",
        meaning: "general",
        edge_peer: "edge.rightId",
      },
      "edge.rightId": {
        source_table: "edge",
        source_field: "rightId",
        target_table: "beta",
        target_field: "id",
        cardinality: "many-to-many-edge",
        nullable: false,
        status: "verified",
        meaning: "general",
        edge_peer: "edge.leftId",
      },
    },
  };
}

function dump(): Record<string, unknown> {
  return {
    metadata: { data_version: 867 },
    data: {
      alpha: [
        {
          id: "a-1",
          targetId: "b-1",
          count: 1,
          note: null,
          optional: null,
          localisations: {
            en: { name: SENTINEL_NAME, lore: SENTINEL_PROSE },
            "pt-BR": { name: SENTINEL_NAME, lore: SENTINEL_PROSE },
          },
        },
        {
          id: "a-2",
          targetId: "b-1",
          count: 2,
          note: null,
          optional: "present",
          localisations: {
            en: { name: SENTINEL_NAME, lore: SENTINEL_PROSE },
            "pt-BR": { name: SENTINEL_NAME, lore: SENTINEL_PROSE },
          },
        },
      ],
      beta: [{ id: "b-1" }],
      edge: [{ leftId: "a-1", rightId: "b-1" }],
      empty: [],
    },
  };
}

function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reversed(child)]),
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function tableSchema(schema: Record<string, unknown>, table: string): Record<string, unknown> {
  const definitions = schema.$defs as { tables: Record<string, Record<string, unknown>> };
  return definitions.tables[table];
}

describe("MFM dump contract generation", () => {
  it("is byte-stable across object and table key order", async () => {
    const firstSchema = buildDumpSchema(dump(), catalog());
    const secondSchema = buildDumpSchema(reversed(dump()), catalog());
    expect(JSON.stringify(firstSchema)).toBe(JSON.stringify(secondSchema));
    expect(await buildDumpTypes(firstSchema, catalog())).toBe(await buildDumpTypes(secondSchema, catalog()));
  });

  it("preserves integer, exact nullable/null-only types, locale, required, and empty-table shape", async () => {
    const schema = buildDumpSchema(dump(), catalog());
    const alpha = tableSchema(schema, "alpha");
    const properties = alpha.properties as Record<string, Record<string, unknown>>;
    expect(properties.count.type).toBe("integer");
    expect(properties.note.type).toBe("null");
    expect(properties.optional.type).toEqual(["null", "string"]);
    expect(alpha.required).toEqual(["count", "id", "localisations", "note", "optional", "targetId"]);
    const localisations = properties.localisations;
    expect(localisations.patternProperties).toHaveProperty("^[a-z]{2}(?:-[A-Z]{2})?$");
    const data = (schema.properties as Record<string, Record<string, unknown>>).data;
    const empty = (data.properties as Record<string, Record<string, unknown>>).empty;
    expect(empty.maxItems).toBe(0);
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(dump())).toBe(true);
    const types = await buildDumpTypes(schema, catalog());
    expect(types).toContain("note: null;");
    expect(types).toContain("optional: null | string;");
    expect(types).not.toMatch(/note: (?:any|unknown|\\{\\});/);
  });

  it("rejects rows in an unobserved table until the catalog is reviewed", () => {
    const populated = clone(dump()) as { data: { empty: Array<Record<string, unknown>> } };
    populated.data.empty.push({ id: "new-row" });
    expect(validateDumpCatalog(populated, catalog())).toContain(
      'Catalog table "empty" row_shape is "unobserved" but the dump is "observed"',
    );
    const reviewed = clone(catalog());
    reviewed.tables.empty.row_shape = "observed";
    reviewed.tables.empty.fields.id = field("identifier");
    expect(validateDumpCatalog(populated, reviewed)).toEqual([]);
    expect(() => buildDumpSchema(populated, reviewed)).not.toThrow();
  });

  it("keeps reviewed fields and relations when a formerly populated table becomes empty", () => {
    const noEdges = clone(dump()) as { data: { edge: Array<Record<string, unknown>> } };
    noEdges.data.edge = [];
    const reviewed = clone(catalog());
    reviewed.tables.edge.row_shape = "unobserved";
    expect(validateDumpCatalog(noEdges, reviewed)).toEqual([]);
    const schema = buildDumpSchema(noEdges, reviewed);
    const data = (schema.properties as Record<string, Record<string, unknown>>).data;
    const edge = (data.properties as Record<string, Record<string, unknown>>).edge;
    expect(edge.maxItems).toBe(0);
    expect(validateDumpCatalog(dump(), reviewed)).toContain(
      'Catalog table "edge" row_shape is "unobserved" but the dump is "observed"',
    );
  });
  it("closes generated rows and emits no source values", () => {
    const schema = buildDumpSchema(dump(), catalog());
    const validate = new Ajv2020({ strict: false }).compile(schema);
    const withUnknown = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    withUnknown.data.alpha[0].unknown = true;
    expect(validate(withUnknown)).toBe(false);
    const bytes = `${JSON.stringify(schema)}\n${JSON.stringify(buildDumpSchema(reversed(dump()), catalog()))}`;
    expect(bytes).not.toContain(SENTINEL_NAME);
    expect(bytes).not.toContain(SENTINEL_PROSE);
  });

  it("fails synthetic source-shape drift before generated artifacts can be produced", () => {
    const unreviewed = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    unreviewed.data.alpha[0].newSourceProperty = "review required";

    expect(validateDumpCatalog(unreviewed, catalog())).toEqual([
      expect.stringContaining("newSourceProperty"),
    ]);
    expect(() => buildDumpSchema(unreviewed, catalog())).toThrow(/newSourceProperty/);
  });
});

describe("MFM catalog diagnostics", () => {
  it("rejects missing, null, and duplicate verified identities deterministically", () => {
    const missing = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    missing.data.alpha.push({ ...missing.data.alpha[0], id: undefined });
    expect(validateDumpCatalog(missing, catalog())).toContain(
      'Catalog table "alpha" verified identity is missing or null at row 2',
    );

    const duplicate = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    duplicate.data.alpha.push(clone(duplicate.data.alpha[0]));
    expect(validateDumpCatalog(duplicate, catalog())).toContain(
      'Catalog table "alpha" has duplicate verified identity ["a-1"]',
    );
  });

  it("rejects dangling, nullable, and one-to-one relation violations", () => {
    const dangling = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    dangling.data.alpha[0].targetId = "missing";
    expect(validateDumpCatalog(dangling, catalog())).toContain(
      'Catalog relation "alpha.targetId" has dangling target at source row 0',
    );

    const nullable = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    nullable.data.alpha.push({ ...clone(nullable.data.alpha[0]), id: "a-2", targetId: null });
    expect(validateDumpCatalog(nullable, catalog())).toContain(
      'Catalog relation "alpha.targetId" nullable=false does not match observed nullable=true',
    );

    const oneToOneDump = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    oneToOneDump.data.alpha.push({ ...clone(oneToOneDump.data.alpha[0]), id: "a-2" });
    const oneToOneCatalog = clone(catalog());
    oneToOneCatalog.relations["alpha.targetId"].cardinality = "one-to-one";
    expect(validateDumpCatalog(oneToOneDump, oneToOneCatalog)).toContain(
      'Catalog relation "alpha.targetId" violates one-to-one cardinality',
    );
  });

  it("rejects malformed peers and duplicate edge pairs", () => {
    const malformed = clone(catalog());
    malformed.relations["edge.rightId"].edge_peer = "alpha.targetId";
    expect(validateDumpCatalog(dump(), malformed)).toContain(
      'Catalog relation "edge.leftId" has malformed or nonreciprocal edge_peer',
    );

    const duplicate = clone(dump()) as { data: { edge: Array<Record<string, unknown>> } };
    duplicate.data.edge.push(clone(duplicate.data.edge[0]));
    expect(validateDumpCatalog(duplicate, catalog())).toContain(
      'Catalog relations "edge.leftId" and "edge.rightId" have duplicate edge ["a-1","b-1"] at source row 1',
    );
  });

  it("fails closed on malformed and duplicate semantic relation declarations", () => {
    const missing = clone(catalog()) as unknown as {
      relations: Record<string, Record<string, unknown>>;
    };
    delete missing.relations["alpha.targetId"].target_field;
    expect(validateDumpCatalog(dump(), missing as never)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /MFM dump catalog \/relations\/alpha\.targetId must have required property 'target_field'/,
        ),
      ]),
    );

    const duplicate = clone(catalog());
    duplicate.relations["alpha.targetId-copy"] = clone(duplicate.relations["alpha.targetId"]);
    expect(validateDumpCatalog(dump(), duplicate)).toContain(
      'Catalog relations "alpha.targetId" and "alpha.targetId-copy" duplicate semantic relation alpha.targetId -> beta.id -> many-to-one -> ownership',
    );
  });

  it("requires null-only fields to be reviewed before populated generation", () => {
    const populated = clone(dump()) as { data: { alpha: Array<Record<string, unknown>> } };
    populated.data.alpha[0].note = "now populated";
    expect(validateDumpCatalog(populated, catalog())).toContain(
      'Catalog field "alpha.note" shape_review is "null-only" but observed shape is "observed"',
    );
    expect(() => buildDumpSchema(populated, catalog())).toThrow(/alpha\.note/);
  });
});
