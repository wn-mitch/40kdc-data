import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The published package (its `exports` and `bin` entries) runs on the Node range `engines`
 * declares and installs only `dependencies`. Its source import graph must therefore reach no
 * built-in newer than that range (node:sqlite) and no package outside `dependencies` (the
 * authoring tools' dev-only SDKs).
 */
const TOOLS = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(TOOLS, "package.json"), "utf8")) as {
  engines: { node: string };
  dependencies: Record<string, string>;
  exports: Record<string, string | { default: string }>;
  bin: Record<string, string>;
};

/** `./dist/x.js` → `src/x.ts`. */
const sourceOf = (published: string) => join(TOOLS, published.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts"));

const entries = [
  ...Object.values(pkg.exports).map((target) => (typeof target === "string" ? target : target.default)).filter((target) => target.startsWith("./dist/")),
  ...Object.values(pkg.bin),
].map(sourceOf);

/** Every import specifier reachable from `entries`, by the file that imports it (type-only imports skipped). */
function reachableImports(): Map<string, string> {
  const seen = new Set<string>();
  const bare = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gmu)) {
      const spec = match[1] ?? match[2]!;
      if (!spec.startsWith(".")) {
        if (!bare.has(spec)) bare.set(spec, file);
        continue;
      }
      const base = resolve(dirname(file), spec);
      const candidate = [base.replace(/\.js$/u, ".ts"), `${base}.ts`, join(base, "index.ts"), base].find((path) => existsSync(path) && path.endsWith(".ts"));
      if (candidate) visit(candidate);
    }
  };
  for (const entry of entries) visit(entry);
  return bare;
}

describe("published package imports", () => {
  const imports = reachableImports();

  it("finds the published entry points", () => {
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) expect(existsSync(entry), entry).toBe(true);
  });

  it("reaches no node:sqlite, which the declared Node range does not have", () => {
    expect(pkg.engines.node).toBe(">=20");
    expect([...imports.keys()].filter((spec) => spec === "node:sqlite" || spec === "sqlite")).toEqual([]);
  });

  it("imports only built-ins and runtime dependencies", () => {
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    const packageOf = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
    const outside = [...imports].filter(([spec]) => !builtins.has(spec) && !(packageOf(spec) in pkg.dependencies)).map(([spec, file]) => `${spec} (${file})`);
    expect(outside).toEqual([]);
  });
});
