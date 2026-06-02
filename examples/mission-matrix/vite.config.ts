import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The 40kdc-data package's barrel re-exports schema-loader and validate, which
 * touch `node:fs`/`node:url` at module-load time. This widget never calls them,
 * but Rollup still has to resolve the imports. Stub them out for the browser
 * bundle. (Lifted verbatim from examples/salvo.)
 */
function stubNodeOnlyModules(): Plugin {
  const stubbed = ["node:fs", "node:fs/promises", "node:path", "node:url"];
  return {
    name: "mission-matrix:stub-node-only-modules",
    enforce: "pre",
    resolveId(id) {
      // Real polyfill: ListForge URLs are gzipped — route node:zlib's
      // gunzipSync through fflate for browser builds.
      if (id === "node:zlib") return "\0mm-stub:node:zlib";
      if (stubbed.includes(id)) return "\0mm-stub:" + id;
      // Also stub the schema-loader + validate modules from the 40kdc-data
      // package — they pull in fs/path at top level and are useless in the
      // browser. Match by name but only when reached via the package (either
      // through the workspace symlink or directly through tools/dist).
      const isPackageNodeOnly =
        (id.endsWith("/schema-loader.js") ||
          (id.endsWith("/validate.js") && !id.includes("node_modules/svelte/")) ||
          id.endsWith("/bundle-schemas.js")) &&
        (id.includes("/tools/dist/") ||
          id.includes("/@alpaca-software/40kdc-data/"));
      if (isPackageNodeOnly) return "\0mm-stub:empty";
      return null;
    },
    load(id) {
      if (id === "\0mm-stub:node:zlib") {
        return `
          import { gunzipSync as fflateGunzip } from "fflate";
          export const gunzipSync = (buf) => fflateGunzip(new Uint8Array(buf));
        `;
      }
      if (!id.startsWith("\0mm-stub:")) return null;
      // A minimal CommonJS-style stub that returns undefined for any property.
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
  plugins: [
    stubNodeOnlyModules(),
    tailwindcss(),
    svelte(),
    // PWA bindings. vite-plugin-pwa derives the manifest scope, start_url, icon
    // paths, and service-worker registration scope from Vite's `base`, so the
    // GitHub Pages subpath (TOOLLET_BASE) is handled automatically — no manual
    // path wrangling needed.
    VitePWA({
      registerType: "autoUpdate",
      // Static icons referenced from index.html (not in the build graph) so the
      // precache manifest includes them.
      includeAssets: ["favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Mission Matrix",
        short_name: "Mission Matrix",
        description: "40kdc Force Disposition matchups — 11e WTC scoresheet",
        // Match the dark shadowboxing shell so the splash screen is seamless.
        theme_color: "#0f0f11",
        background_color: "#0f0f11",
        display: "standalone",
        // Relative src so Vite's `base` prefixes them under the deploy subpath.
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app embeds the whole 40kdc dataset, so the main JS chunk is
        // ~5.4 MB. That data *is* the app and must be cached for offline use,
        // so lift Workbox's 2 MiB precache cap. Keep an explicit ceiling (not
        // Infinity) so a runaway bundle fails the build loudly.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // App shell (JS/CSS/HTML) is precached by default. Runtime-cache the
        // Google Fonts CDN so Barlow / JetBrains Mono survive offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  base: process.env.TOOLLET_BASE ?? "/",
});
