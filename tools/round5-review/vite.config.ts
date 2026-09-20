import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseReviewDocument } from "./src/model";
import { getWorkbenchRevision, openWorkbench } from "../src/round5c/db.js";
import { repairRelatedVariantProposals } from "../src/round5c/migration.js";
import { listDrafts, getDraft } from "../src/round5c/assembly.js";
import { applyAnnotationBatch, getAbilities, getAbility, getDashboard, getFactions, reviewAbility, undoBatch } from "../src/round5c/review.js";
import { importLuna, prepareLuna } from "../src/round5c/proposal.js";
import { abandonLunaRun, finishLunaRun, latestLunaRunForAbility, lunaRunView, startLunaRun } from "../src/round5c/luna-run.js";
import { applySourceAtomBatch, proposeSourceAtom } from "../src/round5c/atoms.js";
import { getFamilyCandidate, getOntology, judgeCandidate, mapCandidate, setCandidateState } from "../src/round5c/ontology.js";
import { confirmAndProposeLiteralStamp, escalateLiteralStamp } from "../src/round5c/stamp-seeds.js";
import { refreshSources } from "../src/round5c/source.js";
import { getFrontier, proposeLexical, retrieveFamilyCandidates } from "../src/round5c/retrieval.js";
import { getQueue } from "../src/round5c/queue.js";
import { listPublications } from "../src/round5c/publish.js";
import {
  applyStamps,
  approveStamp,
  decideEscalation,
  escalationEvidenceHash,
  getStamp,
  getStampAudit,
  listEscalations,
  listStamps,
  previewStamp,
  proposeLiteralStamp,
  proposeStamp,
  rejectStamp,
  recordStampAudit,
  suspendStamp,
} from "../src/round5c/stamps.js";
import { importWork, prepareWork } from "../src/round5c/work.js";
import { startWorkJob, workJobView } from "../src/round5c/work-jobs.js";
import { getCompositionQueue, reviewAbilities } from "../src/round5c/composition-queue.js";
import { abilityRoundTrip } from "../src/round5c/round-trip.js";
import { REVIEWED_FAMILY_REGISTRY, type WorkPurpose } from "../src/round5c/contracts.js";

const appRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Load workbench-only secrets from the ignored `_private/round5c/.env` so the dev server needs
 * no shell setup. Only allowlisted keys are read, and an already-set environment value wins.
 */
function loadWorkbenchSecrets(): void {
  const file = resolve(appRoot, "../../_private/round5c/.env");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*(DEEPSEEK_API_KEY)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || process.env[match[1]!]) continue;
    const value = match[2]!.replace(/^(['"])(.*)\1$/u, "$2");
    if (value) process.env[match[1]!] = value;
  }
}
loadWorkbenchSecrets();
const reviewDirectory = resolve(
  process.env.ROUND5_REVIEW_DIR ?? resolve(appRoot, "../../_private/round5b-hit-roll/review"),
);
const allowedFiles = new Set([
  "recall-audit.json",
  "train-labels.json",
  "validation-labels.json",
  "held-out-labels.json",
]);
const escalationStatuses: Record<string, "open" | "deferred" | "resolved"> = {
  open: "open",
  deferred: "deferred",
  resolved: "resolved",
};
const draftStatuses: Record<string, true> = {
  proposed: true,
  accepted: true,
  blocked: true,
  stale: true,
};

function etag(source: string): string {
  return `\"${createHash("sha256").update(source).digest("hex")}\"`;
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

function requestedFile(requestUrl: string): string | null {
  const match = /^\/__round5-review\/file\/([^/?]+)$/.exec(new URL(requestUrl, "http://localhost").pathname);
  if (!match) return null;
  const name = decodeURIComponent(match[1]);
  return allowedFiles.has(name) ? name : null;
}

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32 * 1024 * 1024) throw new Error("Review JSON exceeds the 32 MB local-write limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assertFileContract(name: string, value: unknown) {
  const document = parseReviewDocument(value);
  if (name === "recall-audit.json" && document.kind !== "recall") {
    throw new Error("recall-audit.json must contain the recall audit schema.");
  }
  if (name !== "recall-audit.json") {
    if (document.kind !== "candidate") throw new Error(`${name} must contain a candidate-label sheet.`);
    const expectedSplit = name.replace("-labels.json", "");
    if (document.sheet.split !== expectedSplit) {
      throw new Error(`${name} contains the ${document.sheet.split} split, expected ${expectedSplit}.`);
    }
  }
}

function round5ReviewBridge(): Plugin {
  return {
    name: "round5-review:local-json-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__round5-review/")) return next();
        try {
          if (request.method === "GET" && request.url === "/__round5-review/files") {
            const files = await Promise.all(
              [...allowedFiles].map(async (name) => {
                try {
                  const details = await stat(resolve(reviewDirectory, name));
                  return {
                    name,
                    exists: details.isFile(),
                    size: details.size,
                    modifiedAt: details.mtime.toISOString(),
                  };
                } catch {
                  return { name, exists: false, size: null, modifiedAt: null };
                }
              }),
            );
            return json(response, 200, { directory: reviewDirectory, files });
          }

          const name = requestedFile(request.url);
          if (!name) return json(response, 404, { error: "Unknown review file." });
          const path = resolve(reviewDirectory, name);

          if (request.method === "GET") {
            const source = await readFile(path, "utf8");
            response.setHeader("etag", etag(source));
            return json(response, 200, JSON.parse(source));
          }

          if (request.method === "PUT") {
            let currentSource: string | null = null;
            try {
              currentSource = await readFile(path, "utf8");
            } catch {
              // A missing allowlisted file can be created by an explicit save.
            }
            if (
              currentSource !== null &&
              request.headers["if-match"] !== etag(currentSource)
            ) {
              return json(response, 409, {
                error: `${name} changed on disk after it was loaded. Reload before saving.`,
              });
            }
            const source = await requestBody(request);
            const value: unknown = JSON.parse(source);
            assertFileContract(name, value);
            await mkdir(reviewDirectory, { recursive: true });
            await access(reviewDirectory);
            const serialized = `${JSON.stringify(value, null, 2)}\n`;
            const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
            await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
            await rename(temporary, path);
            response.setHeader("etag", etag(serialized));
            return json(response, 200, { saved: name });
          }

          return json(response, 405, { error: "Only GET and PUT are supported." });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json(response, 400, { error: message });
        }
      });
    },
  };
}

function round5WorkbenchBridge(): Plugin {
  return {
    name: "round5c:local-workbench",
    apply: "serve",
    configureServer(server) {
      const runningLuna = new Set<number>();
      const initialDb = openWorkbench();
      try { repairRelatedVariantProposals(initialDb); proposeLexical(initialDb); }
      finally { initialDb.close(); }
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__round5c/")) return next();
        const url = new URL(request.url, "http://localhost");
        const path = url.pathname.slice("/__round5c".length);
        const abilityMatch = /^\/abilities\/([1-9]\d*)(\/review)?$/.exec(path);
        const undoMatch = /^\/batches\/([^/]+)\/undo$/.exec(path);
        const familyMatch = /^\/families\/([a-z0-9-]+)\/candidates$/.exec(path);
        const stampMatch = /^\/stamps\/([^/]+)\/([1-9]\d*)(?:\/(preview|approve|reject|suspend|escalate))?$/.exec(path);
        const lunaRunMatch = /^\/luna\/runs\/([1-9]\d*)$/.exec(path);
        const abilityRunMatch = /^\/abilities\/([1-9]\d*)\/luna-run$/.exec(path);
        const workRunMatch = /^\/work\/runs\/([1-9]\d*)$/.exec(path);
        const roundTripMatch = /^\/abilities\/([1-9]\d*)\/round-trip$/.exec(path);
        const candidateMatch = /^\/family-candidates\/([1-9]\d*)(?:\/(judge|state|map))?$/.exec(path);
        const stampAuditMatch = /^\/stamps\/([^/]+)\/([1-9]\d*)\/audit$/.exec(path);
        const escalationMatch = /^\/escalations\/([^/]+)\/decision$/.exec(path);
        const draftMatch = /^\/drafts\/([^/]+)$/.exec(path);
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
            return json(response, 200, REVIEWED_FAMILY_REGISTRY);
          }
          if (request.method === "GET" && abilityMatch && !abilityMatch[2]) {
            return json(response, 200, getAbility(db, Number(abilityMatch[1])));
          }
          if (request.method === "POST" && abilityMatch?.[2] === "/review") {
            return json(response, 200, reviewAbility(db, Number(abilityMatch[1]), await body()));
          }
          if (request.method === "GET" && path === "/dashboard") {
            return json(response, 200, getDashboard(db));
          }
          if (request.method === "GET" && path === "/frontier") {
            return json(response, 200, getFrontier(db));
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
          if (request.method === "GET" && path === "/stamps") {
            return json(response, 200, listStamps(db, {
              status: url.searchParams.get("status") ?? undefined,
              cursor: url.searchParams.get("cursor") ?? undefined,
            }));
          }
          if (request.method === "GET" && stampMatch && !stampMatch[3]) {
            const stamp = getStamp(db, decodeURIComponent(stampMatch[1]), Number(stampMatch[2]));
            const challengeRunId = stamp.challenge_run_id;
            const challenge = typeof challengeRunId === "number"
              ? db.prepare("SELECT id, input_hash, output_json, status FROM model_runs WHERE id = ?").get(challengeRunId) ?? null
              : null;
            return json(response, 200, { ...stamp, challenge });
          }
          if (request.method === "GET" && stampAuditMatch) {
            return json(response, 200, getStampAudit(
              db,
              decodeURIComponent(stampAuditMatch[1]),
              Number(stampAuditMatch[2]),
              { cursor: url.searchParams.get("cursor") ?? undefined },
            ));
          }
          if (request.method === "POST" && stampAuditMatch) {
            const payload = await body() as {
              application_id: string;
              reviewer: string;
              source_hash: string;
              dependency_hash: string;
              verdict: "correct" | "incorrect" | "uncertain";
              scope?: "occurrence" | "rule";
            };
            return json(response, 200, recordStampAudit(db, {
              ...payload,
              stamp_id: decodeURIComponent(stampAuditMatch[1]),
              revision: Number(stampAuditMatch[2]),
            }));
          }
          if (request.method === "POST" && path === "/stamps/propose") {
            const payload = await body() as Record<string, unknown>;
            const result = typeof payload.annotation_id === "number"
              ? proposeLiteralStamp(db, payload as { annotation_id: number; reviewer: string; label?: string })
              : proposeStamp(db, payload as {
                stamp_id?: string;
                base_revision?: number;
                definition: unknown;
                positives: unknown[];
                counterexamples: unknown[];
              });
            return json(response, 200, result);
          }
          if (request.method === "POST" && stampMatch?.[3] === "preview") {
            const payload = await body() as { cursor?: string };
            return json(response, 200, previewStamp(db, decodeURIComponent(stampMatch[1]), Number(stampMatch[2]), {
              cursor: payload.cursor,
            }));
          }
          if (request.method === "POST" && stampMatch?.[3] === "approve") {
            return json(response, 200, approveStamp(
              db,
              decodeURIComponent(stampMatch[1]),
              Number(stampMatch[2]),
              await body() as { reviewer: string; preview_hash: string; objection_resolution?: string },
            ));
          }
          if (request.method === "POST" && stampMatch?.[3] === "reject") {
            return json(response, 200, rejectStamp(
              db,
              decodeURIComponent(stampMatch[1]),
              Number(stampMatch[2]),
              await body() as { reviewer: string; definition_hash: string; reason: string },
            ));
          }
          if (request.method === "POST" && stampMatch?.[3] === "suspend") {
            return json(response, 200, suspendStamp(
              db,
              decodeURIComponent(stampMatch[1]),
              Number(stampMatch[2]),
              await body() as { reviewer: string; preview_hash: string; reason: string },
            ));
          }
          if (request.method === "POST" && stampMatch?.[3] === "escalate") {
            return json(response, 200, escalateLiteralStamp(db, decodeURIComponent(stampMatch[1]), Number(stampMatch[2])));
          }
          if (request.method === "POST" && path === "/stamps/confirm-and-propose") {
            const result = confirmAndProposeLiteralStamp(db, await body());
            proposeLexical(db);
            return json(response, 200, result);
          }
          if (request.method === "POST" && path === "/stamps/apply") {
            return json(response, 200, applyStamps(db, await body() as { ability_version_ids?: number[] }));
          }
          if (request.method === "GET" && path === "/escalations") {
            const requestedStatus = url.searchParams.get("status");
            if (requestedStatus !== null && !escalationStatuses[requestedStatus]) {
              throw Object.assign(new TypeError("Unknown escalation status filter."), { status: 422 });
            }
            const page = listEscalations(db, {
              status: requestedStatus === null ? undefined : escalationStatuses[requestedStatus],
              cursor: url.searchParams.get("cursor") ?? undefined,
            });
            const escalationDb = db;
            return json(response, 200, {
              ...page,
              items: page.items.map((item) => ({
                ...item,
                evidence_hash: escalationEvidenceHash(escalationDb, String(item.id)),
              })),
            });
          }
          if (request.method === "POST" && escalationMatch) {
            return json(response, 200, decideEscalation(
              db,
              decodeURIComponent(escalationMatch[1]),
              await body() as {
                reviewer: string;
                evidence_hash: string;
                action: "defer" | "reopen" | "request-revision";
                note?: string;
              },
            ));
          }
          if (request.method === "GET" && path === "/drafts") {
            const requestedStatus = url.searchParams.get("status");
            if (requestedStatus !== null && !draftStatuses[requestedStatus]) {
              throw Object.assign(new TypeError("Unknown draft status filter."), { status: 422 });
            }
            return json(response, 200, listDrafts(db, {
              status: requestedStatus ?? undefined,
              cursor: url.searchParams.get("cursor") ?? undefined,
            }));
          }
          if (request.method === "GET" && draftMatch) {
            return json(response, 200, getDraft(db, decodeURIComponent(draftMatch[1])));
          }
          if (request.method === "GET" && path === "/publications") {
            return json(response, 200, listPublications(db, {
              cursor: url.searchParams.get("cursor") ?? undefined,
            }));
          }
          if (request.method === "GET" && path === "/revision") {
            return json(response, 200, { revision: getWorkbenchRevision(db) });
          }
          if (request.method === "POST" && path === "/work/prepare") {
            return json(response, 200, prepareWork(db, await body() as {
              purpose: WorkPurpose;
              limit?: number;
              ids?: string[];
              retry_reason?: string;
            }));
          }
          if (request.method === "POST" && path === "/work/run") {
            // DeepSeek can think for minutes; start it in the background and let the page poll.
            return json(response, 202, startWorkJob(db, () => openWorkbench(), await body()));
          }
          if (request.method === "GET" && roundTripMatch) {
            return json(response, 200, abilityRoundTrip(db, Number(roundTripMatch[1])));
          }
          if (request.method === "GET" && workRunMatch) {
            return json(response, 200, workJobView(db, workRunMatch[1]));
          }
          if (request.method === "GET" && path === "/composition-queue") {
            return json(response, 200, getCompositionQueue(db, { factionId: url.searchParams.get("faction") ?? undefined }));
          }
          if (request.method === "POST" && path === "/abilities/review-batch") {
            return json(response, 200, reviewAbilities(db, await body()));
          }
          if (request.method === "POST" && path === "/work/import") {
            return json(response, 200, importWork(db, await body() as { run_id: string; response: unknown }));
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
          if (request.method === "GET" && path === "/ontology") {
            return json(response, 200, getOntology(db, { faction: url.searchParams.get("faction") ?? undefined }));
          }
          if (request.method === "GET" && candidateMatch && !candidateMatch[2]) {
            return json(response, 200, getFamilyCandidate(db, Number(candidateMatch[1])));
          }
          if (request.method === "POST" && candidateMatch?.[2] === "judge") {
            return json(response, 200, judgeCandidate(db, Number(candidateMatch[1]), await body()));
          }
          if (request.method === "POST" && candidateMatch?.[2] === "state") {
            return json(response, 200, setCandidateState(db, Number(candidateMatch[1]), await body()));
          }
          if (request.method === "POST" && candidateMatch?.[2] === "map") {
            return json(response, 200, mapCandidate(db, Number(candidateMatch[1]), await body()));
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
            : request.method === "GET" && draftMatch
              ? 404
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
  plugins: [round5ReviewBridge(), round5WorkbenchBridge(), react()],
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
