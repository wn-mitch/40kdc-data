import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("MFM report destinations", () => {
  it("isolates dry-run reports and updates applied reports on write", () => {
    const repo = join(import.meta.dirname, "../..");
    const root = mkdtempSync(join(tmpdir(), "mfm-report-"));
    try {
      mkdirSync(join(root, "tools"));
      cpSync(join(repo, "tools/src"), join(root, "tools/src"), { recursive: true });
      cpSync(join(repo, "tools/package.json"), join(root, "tools/package.json"));
      cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
      cpSync(join(repo, "schemas"), join(root, "schemas"), { recursive: true });
      mkdirSync(join(root, "crates/wh40kdc"), { recursive: true });
      cpSync(join(repo, "crates/wh40kdc/schemas"), join(root, "crates/wh40kdc/schemas"), { recursive: true });
      symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
      const schema = JSON.parse(readFileSync(join(repo, "tools/src/mfm/dump.schema.json"), "utf8"));
      symlinkSync(join(repo, "tools/node_modules"), join(root, "tools/node_modules"), "dir");
      const data = Object.fromEntries(Object.keys(schema.properties.data.properties).map((name) => [name, []]));
      const dump = join(root, "dump.json");
      writeFileSync(dump, JSON.stringify({ metadata: { data_version: 995 }, data }));
      const applied = join(root, "data/core/_reports/mfm-base-sizes.md");
      mkdirSync(join(root, "data/core/_reports"), { recursive: true });
      writeFileSync(applied, "APPLIED fixture\n");
      const run = (write: boolean) => spawnSync(join(repo, "node_modules/.bin/tsx"), [join(root, "tools/src/ingest-mfm.ts"), "base-sizes", "--dump", dump, ...(write ? ["--write"] : [])], { cwd: root, encoding: "utf8" });
      const dry = run(false);
      expect(dry.status, dry.stderr).toBe(0);
      expect(readFileSync(applied, "utf8")).toBe("APPLIED fixture\n");
      const diagnostic = join(root, "_private/mfm/mfm-base-sizes.md");
      expect(readFileSync(diagnostic, "utf8")).toContain("DRY RUN");
      expect(dry.stdout).toContain("_private/mfm/mfm-base-sizes.md");
      const written = run(true);
      expect(written.status, written.stderr).toBe(0);
      expect(readFileSync(applied, "utf8")).toContain("APPLIED");
      expect(readFileSync(applied, "utf8")).not.toBe("APPLIED fixture\n");
      expect(written.stdout).toContain("data/core/_reports/mfm-base-sizes.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
