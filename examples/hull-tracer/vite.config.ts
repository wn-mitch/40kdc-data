import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { buildSha, dataPackageVersion } from "../_shared/build-stamp.js";

/**
 * The tracer only imports the `HullShape` *type* from @alpaca-software/40kdc-data
 * (erased at build), so no package runtime code reaches the bundle. But the
 * package's barrel re-exports schema-loader/validate, which touch
 * `node:fs`/`node:url` at module-load time; should any transitive resolution
 * pull them, stub them out for the browser. (Pattern lifted from the sibling
 * toollets, minus the ListForge gzip path this tool has no use for.)
 */
function stubNodeOnlyModules(): Plugin {
  const stubbed = ["node:fs", "node:fs/promises", "node:path", "node:url"];
  return {
    name: "hull-tracer:stub-node-only-modules",
    enforce: "pre",
    resolveId(id) {
      if (stubbed.includes(id)) return "\0ht-stub:" + id;
      const isPackageNodeOnly =
        (id.endsWith("/schema-loader.js") ||
          (id.endsWith("/validate.js") && !id.includes("node_modules/svelte/")) ||
          id.endsWith("/bundle-schemas.js")) &&
        (id.includes("/tools/dist/") || id.includes("/@alpaca-software/40kdc-data/"));
      if (isPackageNodeOnly) return "\0ht-stub:empty";
      return null;
    },
    load(id) {
      if (!id.startsWith("\0ht-stub:")) return null;
      return `
        const handler = { get: () => () => { throw new Error("Node-only module not available in browser"); } };
        export default new Proxy({}, handler);
        export const fileURLToPath = (u) => String(u);
        export const URL = globalThis.URL;
        export const dirname = (p) => p.replace(/\\/[^/]*$/, "");
        export const resolve = (...parts) => parts.join("/");
        export const join = (...parts) => parts.join("/");
        export const readFileSync = () => "";
        export const existsSync = () => false;
        export const readdirSync = () => [];
        export const statSync = () => ({ isFile: () => false, isDirectory: () => false });
        export const createValidator = () => { throw new Error("createValidator is not available in the browser"); };
        export const findSchemaFiles = () => [];
        export const listSchemaIds = () => [];
        export const SCHEMAS_ROOT = "";
      `;
    },
  };
}

export default defineConfig({
  plugins: [stubNodeOnlyModules(), tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  base: process.env.TOOLLET_BASE ?? "/",
  define: {
    __DATA_VERSION__: JSON.stringify(dataPackageVersion(import.meta.url)),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
});
