import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeGolden } from "../src/mfm/golden.js";
import { MfmDump } from "../src/mfm/loader.js";

describe("MFM golden version guard", () => {
  it("preserves both artifacts on downgrade or malformed versions and accepts equal or newer snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "mfm-golden-"));
    const paths = { golden: join(dir, "golden.json"), gaps: join(dir, "gaps.json") };
    const dump = (version: number) => new MfmDump({ metadata: { data_version: version }, data: new Proxy({}, { get: () => [] }) });
    try {
      writeFileSync(paths.golden, '{"data_version":42}\n');
      writeFileSync(paths.gaps, 'original gaps\n');
      const golden = readFileSync(paths.golden, "utf8");
      const gaps = readFileSync(paths.gaps, "utf8");
      expect(() => writeGolden(dump(41), paths)).toThrow(/41.*42/u);
      expect(() => writeGolden(dump(-1), paths)).toThrow(/Invalid incoming/u);
      expect(readFileSync(paths.golden, "utf8")).toBe(golden);
      expect(readFileSync(paths.gaps, "utf8")).toBe(gaps);
      writeFileSync(paths.golden, "not JSON");
      expect(() => writeGolden(dump(42), paths)).toThrow(/Invalid existing/u);
      writeFileSync(paths.golden, "{}");
      expect(() => writeGolden(dump(42), paths)).toThrow(/Invalid existing/u);
      writeFileSync(paths.golden, golden);
      writeGolden(dump(42), paths);
      rmSync(paths.golden);
      writeGolden(dump(0), paths);
      expect(JSON.parse(readFileSync(paths.golden, "utf8")).data_version).toBe(0);
      writeFileSync(paths.golden, golden);
      writeGolden(dump(43), paths);
      expect(JSON.parse(readFileSync(paths.golden, "utf8")).data_version).toBe(43);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
