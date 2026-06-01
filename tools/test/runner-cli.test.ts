/**
 * End-to-end check that the runner CLI works as a real subprocess: NDJSON in
 * on stdin, NDJSON out on stdout, clean exit on shutdown. The in-process tests
 * (`runner.test.ts`) cover dispatcher behavior; this file confirms the wire
 * adapter doesn't drop, reorder, or eat lines.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_TS = join(__dirname, "../src/runner.ts");
const SPEC_VERSION = Number.parseInt(
  readFileSync(join(__dirname, "../../conformance/SPEC_VERSION"), "utf8").trim(),
  10,
);

/**
 * Spawn the runner, pipe the given requests as NDJSON, return the responses
 * as parsed objects (in order). Always appends a shutdown so the process
 * exits cleanly; the shutdown response is included in the returned array.
 */
async function driveRunner(requests: object[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", RUNNER_TS], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`runner exited ${code}; stderr: ${stderr}`));
        return;
      }
      const lines = stdout.split("\n").filter((l) => l.length > 0);
      try {
        resolve(lines.map((l) => JSON.parse(l)));
      } catch (e) {
        reject(new Error(`runner emitted non-JSON line: ${(e as Error).message}; stdout: ${stdout}`));
      }
    });
    const allRequests = [
      ...requests,
      { op: "shutdown" },
    ];
    child.stdin.write(allRequests.map((r) => JSON.stringify(r)).join("\n") + "\n");
    child.stdin.end();
  });
}

describe("runner CLI subprocess", () => {
  it("handshakes, answers a few ops, exits 0", async () => {
    const responses = (await driveRunner([
      { op: "init", args: { spec_version: SPEC_VERSION, locale: "C", tz: "UTC", seed: 0 } },
      { op: "normalize", args: { input: "Khârn the Betrayer" } },
      { op: "linked_query", args: { query: "find_unit", input: { query: "Kharn" } } },
    ])) as ({ ok: boolean; value?: unknown; error_kind?: string })[];

    expect(responses).toHaveLength(4); // init + 2 ops + shutdown
    expect(responses[0].ok).toBe(true);
    expect((responses[0].value as { impl: string }).impl).toBe("ts");
    expect(responses[1].value).toBe("kharn the betrayer");
    expect(responses[2].value).toBe("kharn-the-betrayer");
    expect(responses[3].value).toBeNull();
  }, 20_000);

  it("dispatches the attribution op end-to-end", async () => {
    const responses = (await driveRunner([
      { op: "init", args: { spec_version: SPEC_VERSION, locale: "C", tz: "UTC", seed: 0 } },
      {
        op: "attribution",
        args: {
          attacker: { weaponId: "bolt-rifle", profileIndex: 0 },
          modelsFiring: 5,
          target: { unitId: "intercessor-squad", profileIndex: 0 },
          context: { phase: "shooting", attackerStationary: false, withinHalfRange: false },
          buffs: [],
        },
      },
    ])) as ({ ok: boolean; value?: unknown })[];
    expect(responses).toHaveLength(3);
    expect(responses[1].ok).toBe(true);
    const stages = responses[1].value as { name: string }[];
    expect(stages).toHaveLength(7);
    expect(stages[0].name).toBe("attacks");
  }, 20_000);

  it("preserves request/response ordering under pipelined input", async () => {
    const requests = [
      { op: "init", args: { spec_version: SPEC_VERSION, locale: "C", tz: "UTC", seed: 0 } },
      ...Array.from({ length: 10 }, (_, i) => ({
        op: "normalize",
        args: { input: `Input ${i} Khârn` },
      })),
    ];
    const responses = (await driveRunner(requests)) as ({ ok: boolean; value?: unknown })[];
    expect(responses).toHaveLength(12); // init + 10 normalize + shutdown
    for (let i = 0; i < 10; i++) {
      expect(responses[1 + i].value).toBe(`input ${i} kharn`);
    }
  }, 20_000);
});
