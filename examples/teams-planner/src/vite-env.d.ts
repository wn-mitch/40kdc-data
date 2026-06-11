/// <reference types="svelte" />
/// <reference types="vite/client" />

// Injected by Vite's `define` (see vite.config.ts) from this app's package.json
// version.
declare const __APP_VERSION__: string;

// Footer staleness stamp (shared build-stamp.ts): bundled dataset version and
// build commit.
declare const __DATA_VERSION__: string;
declare const __BUILD_SHA__: string;
