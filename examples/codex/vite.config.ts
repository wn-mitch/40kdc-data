import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { buildSha, dataPackageVersion } from "../_shared/build-stamp.js";

function stubNodeOnlyModules(): Plugin {
  const stubbed = ["node:fs", "node:fs/promises", "node:path", "node:url"];
  return {
    name: "codex:stub-node-only-modules",
    enforce: "pre",
    resolveId(id) {
      if (id === "node:zlib") return "\0codex-stub:node:zlib";
      if (stubbed.includes(id)) return "\0codex-stub:" + id;
      const isPackageNodeOnly =
        (id.endsWith("/schema-loader.js") ||
          (id.endsWith("/validate.js") && !id.includes("node_modules/svelte/")) ||
          id.endsWith("/bundle-schemas.js")) &&
        (id.includes("/tools/dist/") || id.includes("/@alpaca-software/40kdc-data/"));
      return isPackageNodeOnly ? "\0codex-stub:empty" : null;
    },
    load(id) {
      if (id === "\0codex-stub:node:zlib") {
        return `
          import { gunzipSync as fflateGunzip } from "fflate";
          export const gunzipSync = (buf) => fflateGunzip(new Uint8Array(buf));
        `;
      }
      if (!id.startsWith("\0codex-stub:")) return null;
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
        export const lstatSync = statSync;
        export const writeFileSync = () => {};
        export const mkdtempSync = () => "";
        export const mkdirSync = () => "";
        export const rmSync = () => {};
        export const tmpdir = () => "";
        export const createValidator = () => { throw new Error("createValidator is not available in the browser"); };
        export const findSchemaFiles = () => [];
        export const listSchemaIds = () => [];
        export const SCHEMAS_ROOT = "";
      `;
    },
  };
}

export default defineConfig({
  plugins: [stubNodeOnlyModules(), svelte()],
  base: process.env.TOOLLET_BASE ?? "/",
  define: {
    __DATA_VERSION__: JSON.stringify(dataPackageVersion(import.meta.url)),
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
});
