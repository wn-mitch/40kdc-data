import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { getWorkbenchRevision, openWorkbench } from "../src/round5c/db.js";
import { repairRelatedVariantProposals } from "../src/round5c/migration.js";
import { applyAnnotationBatch, getAbilities, getAbility, getDashboard, getFactions, reviewAbility, undoBatch } from "../src/round5c/review.js";
import { importLuna, prepareLuna } from "../src/round5c/proposal.js";
import { abandonLunaRun, finishLunaRun, latestLunaRunForAbility, lunaRunView, startLunaRun } from "../src/round5c/luna-run.js";
import { applySourceAtomBatch, proposeSourceAtom } from "../src/round5c/atoms.js";
import { refreshSources } from "../src/round5c/source.js";
import { approveShape, getShape, listShapes, rejectShapeMembers } from "../src/round5c/shapes.js";
import { applyLeafSurfaces, backfillLeafSurfaces, confirmSurface, leafBoard, mergeFingerprints, moveSurface, retireSurface } from "../src/round5c/leaves.js";
import { proposeLexical, retrieveFamilyCandidates } from "../src/round5c/retrieval.js";
import { getQueue } from "../src/round5c/queue.js";
import { listPublications } from "../src/round5c/publish.js";
import { REVIEWED_FAMILY_REGISTRY } from "../src/round5c/contracts.js";

const appRoot = dirname(fileURLToPath(import.meta.url));

function json(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32 * 1024 * 1024) throw new Error("Workbench request exceeds the 32 MB local limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function round5WorkbenchBridge(): Plugin {
  return {
    name: "round5c:local-workbench",
    apply: "serve",
    configureServer(server) {
      const runningLuna = new Set<number>();
      const initialDb = openWorkbench();
      try { repairRelatedVariantProposals(initialDb); proposeLexical(initialDb); backfillLeafSurfaces(initialDb); }
      finally { initialDb.close(); }
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__round5c/")) return next();
        const url = new URL(request.url, "http://localhost");
        const path = url.pathname.slice("/__round5c".length);
        const abilityMatch = /^\/abilities\/([1-9]\d*)(\/review)?$/.exec(path);
        const undoMatch = /^\/batches\/([^/]+)\/undo$/.exec(path);
        const familyMatch = /^\/families\/([a-z0-9-]+)\/candidates$/.exec(path);
        const lunaRunMatch = /^\/luna\/runs\/([1-9]\d*)$/.exec(path);
        const abilityRunMatch = /^\/abilities\/([1-9]\d*)\/luna-run$/.exec(path);
        let db: DatabaseSync | undefined;
        try {
          if (request.method === "POST") {
            const host = request.headers.host;
            if (typeof host !== "string" || !/^(?:localhost|127\.0\.0\.1):\d+$/.test(host) || request.headers.origin !== `http://${host}`) {
              return json(response, 403, { error: "Workbench writes require the local same-origin page." });
            }
            if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
              return json(response, 415, { error: "Workbench writes require application/json." });
            }
          }
          db = openWorkbench();
          const body = async () => {
            const parsed: unknown = JSON.parse(await requestBody(request));
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw Object.assign(new Error("Expected a JSON object."), { status: 422 });
            }
            return parsed;
          };
          if (request.method === "GET" && path === "/abilities") {
            const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
            return json(response, 200, getAbilities(db, { limit, cursor: url.searchParams.get("cursor") ?? undefined, query: url.searchParams.get("query") ?? undefined, factionId: url.searchParams.get("faction") ?? undefined, reviewState: url.searchParams.get("reviewState") as "pending" | "reviewed" | undefined }));
          }
          if (request.method === "GET" && path === "/factions") {
            return json(response, 200, getFactions(db));
          }
          if (request.method === "GET" && path === "/semantic-families") {
            return json(response, 200, REVIEWED_FAMILY_REGISTRY.filter((family) => !family.deprecated));
          }
          if (request.method === "GET" && abilityMatch && !abilityMatch[2]) {
            return json(response, 200, getAbility(db, Number(abilityMatch[1])));
          }
          if (request.method === "POST" && abilityMatch?.[2] === "/review") {
            return json(response, 200, reviewAbility(db, Number(abilityMatch[1]), await body()));
          }
          if (request.method === "GET" && path === "/leaves") {
            return json(response, 200, leafBoard(db, { factionId: url.searchParams.get("faction") ?? undefined }));
          }
          if (request.method === "POST" && path === "/leaves/confirm") {
            return json(response, 200, confirmSurface(db, await body()));
          }
          if (request.method === "POST" && path === "/leaves/apply") {
            return json(response, 200, applyLeafSurfaces(db, await body()));
          }
          if (request.method === "POST" && path === "/leaves/move") {
            return json(response, 200, moveSurface(db, await body()));
          }
          if (request.method === "POST" && path === "/leaves/merge") {
            return json(response, 200, mergeFingerprints(db, await body()));
          }
          if (request.method === "POST" && path === "/leaves/retire") {
            return json(response, 200, retireSurface(db, await body()));
          }
          if (request.method === "GET" && path === "/shapes") {
            return json(response, 200, listShapes(db, { factionId: url.searchParams.get("faction") ?? undefined }));
          }
          if (request.method === "GET" && path === "/shapes/members") {
            return json(response, 200, getShape(db, url.searchParams.get("signature") ?? "", { factionId: url.searchParams.get("faction") ?? undefined }));
          }
          if (request.method === "POST" && path === "/shapes/approve") {
            return json(response, 200, approveShape(db, await body()));
          }
          if (request.method === "POST" && path === "/shapes/reject") {
            return json(response, 200, rejectShapeMembers(db, await body()));
          }
          if (request.method === "GET" && path === "/dashboard") {
            return json(response, 200, getDashboard(db));
          }
          if (request.method === "GET" && path === "/queue") {
            const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
            return json(response, 200, getQueue(db, { factionId: url.searchParams.get("faction") ?? undefined, limit }));
          }
          if (request.method === "GET" && familyMatch) {
            // Candidates are materialized at startup and after human confirmation; reads do not mutate evidence.
            const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
            return json(response, 200, retrieveFamilyCandidates(db, familyMatch[1], {
              limit,
              cursor: url.searchParams.get("cursor") ?? undefined,
              signature: url.searchParams.get("signature") ?? undefined,
              factionId: url.searchParams.get("faction") ?? undefined,
            }));
          }
          if (request.method === "GET" && path === "/publications") {
            return json(response, 200, listPublications(db, {
              cursor: url.searchParams.get("cursor") ?? undefined,
            }));
          }
          if (request.method === "GET" && path === "/revision") {
            return json(response, 200, { revision: getWorkbenchRevision(db) });
          }
          if (request.method === "POST" && path === "/luna/prepare") {
            return json(response, 200, prepareLuna(db, await body()));
          }
          if (request.method === "POST" && path === "/sources/refresh") {
            await body();
            return json(response, 200, refreshSources(db));
          }
          if (request.method === "POST" && path === "/luna/run") {
            const payload = await body() as { run_id?: unknown };
            const runId = Number(payload.run_id);
            if (runningLuna.has(runId)) throw Object.assign(new Error(`Luna run ${runId} is already running in this server.`), { status: 409 });
            const claimed = await startLunaRun(db, payload.run_id);
            runningLuna.add(claimed.run_id);
            // The subprocess can take up to its 20-minute deadline; the page polls /luna/runs/:id.
            void finishLunaRun(() => openWorkbench(), claimed)
              .catch((error: unknown) => console.error(`[round5c] Luna run ${claimed.run_id} failed to finish: ${error instanceof Error ? error.name : "error"}`))
              .finally(() => runningLuna.delete(claimed.run_id));
            return json(response, 202, lunaRunView(db, claimed.run_id));
          }
          if (request.method === "GET" && abilityRunMatch) {
            return json(response, 200, { run: latestLunaRunForAbility(db, Number(abilityRunMatch[1])) });
          }
          if (request.method === "GET" && lunaRunMatch) {
            return json(response, 200, lunaRunView(db, lunaRunMatch[1]));
          }
          if (request.method === "POST" && path === "/luna/abandon") {
            return json(response, 200, abandonLunaRun(db, await body()));
          }
          if (request.method === "POST" && path === "/source-atoms/propose") {
            return json(response, 200, proposeSourceAtom(db, await body()));
          }
          if (request.method === "POST" && path === "/source-atoms/batch") {
            return json(response, 200, applySourceAtomBatch(db, await body()));
          }
          if (request.method === "POST" && path === "/luna/import") {
            return json(response, 200, importLuna(db, await body() as { run_id: string; response: unknown }));
          }
          if (request.method === "POST" && path === "/annotations/batch") {
            const result = applyAnnotationBatch(db, await body());
            proposeLexical(db);
            return json(response, 200, result);
          }
          if (request.method === "POST" && undoMatch) {
            return json(response, 200, undoBatch(db, decodeURIComponent(undoMatch[1]), await body()));
          }
          return json(response, 404, { error: "Unknown workbench operation." });
        } catch (error) {
          const status = error instanceof Error && "status" in error && typeof error.status === "number"
            ? error.status
            : error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError
              ? 422
              : 400;
          return json(response, status, { error: error instanceof Error ? error.message : String(error) });
        } finally {
          db?.close();
        }
      });
    },
  };
}

export default defineConfig({
  root: appRoot,
  plugins: [round5WorkbenchBridge(), react()],
  server: {
    host: "127.0.0.1",
    port: 4315,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4315,
    strictPort: true,
  },
  build: {
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
  },
});
