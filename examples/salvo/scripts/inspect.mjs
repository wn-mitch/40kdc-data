// Headless screenshot pass at three target viewports. Builds Salvo, serves the
// dist with `vite preview`, then drives Chromium via Playwright. Outputs PNGs
// under `screenshots/` (gitignored).
//
// Run:  npm run inspect
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "screenshots");
const PORT = 4173;
const URL_ = `http://localhost:${PORT}/`;

const VIEWPORTS = [
  { id: "macbook-1920", width: 1920, height: 1080, scale: 1 },
  { id: "ipad", width: 1024, height: 1366, scale: 2 },
  { id: "iphone-14-pro-max", width: 430, height: 932, scale: 3 },
];

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up at ${url}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log("[inspect] vite preview --port", PORT);
  const server = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
  );
  const stop = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.on("exit", stop);
  process.on("SIGINT", () => { stop(); process.exit(130); });

  try {
    await waitForServer(URL_);

    const browser = await chromium.launch();
    try {
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.scale,
        });
        const page = await ctx.newPage();
        await page.goto(URL_, { waitUntil: "networkidle" });
        // Wait for the brand wordmark so we know Svelte hydrated.
        await page.waitForSelector(".app-header h1", { state: "visible" });
        // Settle: one extra frame after the network is idle.
        await page.waitForTimeout(150);
        const path = resolve(OUT, `${vp.id}.png`);
        await page.screenshot({ path, fullPage: false });
        console.log(`[inspect] ${vp.id} → ${path}`);
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
