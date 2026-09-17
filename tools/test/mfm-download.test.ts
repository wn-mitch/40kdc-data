import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { downloadMfmDump, MFM_DUMP_URL } from "../src/mfm/download.js";

const TEMP_DIR = mkdtempSync(path.join(tmpdir(), "mfm-download-test-"));

afterAll(() => rmSync(TEMP_DIR, { recursive: true, force: true }));

function response(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("MFM dump download", () => {
  it("writes a validated JSON object atomically", async () => {
    const outputPath = path.join(TEMP_DIR, "nested", "dump.json");
    const bytes = await downloadMfmDump(outputPath, async (url) => {
      expect(url).toBe(MFM_DUMP_URL);
      return response('{"metadata":{"data_version":1}}\n');
    });

    expect(bytes).toEqual({ bytes: 32 });
    expect(readFileSync(outputPath, "utf8")).toBe('{"metadata":{"data_version":1}}\n');
  });

  it("preserves the existing snapshot when the response is invalid", async () => {
    const outputPath = path.join(TEMP_DIR, "existing.json");
    writeFileSync(outputPath, '{"previous":true}\n');

    await expect(downloadMfmDump(outputPath, async () => response("not json"))).rejects.toThrow("not valid JSON");

    expect(readFileSync(outputPath, "utf8")).toBe('{"previous":true}\n');
    expect(existsSync(`${outputPath}.${process.pid}.tmp`)).toBe(false);
  });

  it("rejects failed HTTP responses without creating a snapshot", async () => {
    const outputPath = path.join(TEMP_DIR, "missing.json");

    await expect(downloadMfmDump(outputPath, async () => response("unavailable", 503))).rejects.toThrow("HTTP 503");

    expect(existsSync(outputPath)).toBe(false);
  });
});
