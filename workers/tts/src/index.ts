/**
 * 40kdc-tts — Tabletop Simulator army codes at tts.alpacasoft.dev, speaking
 * Yellowscribe's protocol (github.com/ThePants999/Yellowscribe) so its TTS mod
 * loads 40kdc lists:
 *
 * - `POST /makeArmyAndReturnCode` — upload a list, get `{code}`.
 * - `POST /getFormattedArmy` — upload a list, get the army data without storing it.
 * - `POST /getArmyCode` — store army data (as `getFormattedArmy` returns it), get `{code}`.
 * - `POST /yellowscribeArmyCode` — upload a list, get `{code}` minted on
 *   yellowscribe.link, which the stock TTS mod reads (codes from this host
 *   need the mod's script re-pointed here).
 * - `GET /get_army_by_id?id=<code>` — what the mod fetches.
 * - `GET /machine.lua` — the Yellow Machine script pointed at this host.
 *
 * Upload query parameters follow Yellowscribe: `filename`, `uiHeight` (700),
 * `uiWidth` (1200), `decorativeNames`, `modules` (`MatchedPlay`).
 */
import { yellowscribeArmy, type YellowscribeUnit } from "../../../tools/src/export/yellowscribe-army.js";
import { ArmyStore } from "./army-store";
import { embeddedDataset, rosterFromUpload } from "./inputs";
import { buildScript, KNOWN_MODULES, machineScript } from "./script";

export { ArmyStore };

export interface Env {
  ARMIES: DurableObjectNamespace<ArmyStore>;
  CODE_TTL_MINUTES?: string;
  MAX_UPLOAD_BYTES?: string;
  /** Yellowscribe server that mints codes for the stock mod. */
  YELLOWSCRIBE_ORIGIN?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const CODE_ATTEMPTS = 5;
const YELLOWSCRIBE_TIMEOUT_MS = 15_000;

function json(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

const fail = (err: string, status: number): Response => json({ err }, status);

/** Yellowscribe's substitutions, which keep army text from breaking the mod's XML UI. */
export function sanitize(text: string): string {
  return text.replace(/ & |>|</g, (m) => (m === " & " ? " and " : m === ">" ? "＞" : "＜"));
}

interface ArmyData {
  edition: string;
  order: string[];
  units: Record<string, YellowscribeUnit>;
}

/** Display settings an upload carries in its query string. */
interface Settings {
  uiHeight: string;
  uiWidth: string;
  decorativeNames: string;
  modules: string[];
}

function settingsOf(url: URL): Settings {
  const modules = (url.searchParams.get("modules") || "MatchedPlay").split(",").map((m) => m.trim()).filter((m) => KNOWN_MODULES.includes(m));
  return {
    uiHeight: url.searchParams.get("uiHeight") || "700",
    uiWidth: url.searchParams.get("uiWidth") || "1200",
    decorativeNames: url.searchParams.get("decorativeNames") || "",
    modules,
  };
}

/** The stored record, without the Lua (rebuilt on read so codes stay small). */
interface StoredArmy extends Settings {
  edition: string;
  order: string[];
  armyData: Record<string, YellowscribeUnit>;
}

async function readUpload(request: Request, env: Env): Promise<Uint8Array | Response> {
  const limit = Number(env.MAX_UPLOAD_BYTES ?? 1048576);
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > limit) return fail(`upload is over ${limit} bytes`, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) return fail(`upload is over ${limit} bytes`, 413);
  if (bytes.byteLength === 0) return fail("upload is empty", 400);
  return bytes;
}

async function armyFromUpload(request: Request, url: URL, env: Env): Promise<{ army: ArmyData; skipped: string[] } | Response> {
  const bytes = await readUpload(request, env);
  if (bytes instanceof Response) return bytes;
  const ds = embeddedDataset();
  const result = rosterFromUpload(bytes, url.searchParams.get("filename"), ds);
  if (!result.ok) return fail(result.message, result.reason === "no-adapter-matched" || result.reason === "empty-input" ? 415 : 400);
  const { edition, order, units, skipped } = yellowscribeArmy(result.roster, ds);
  if (order.length === 0) return fail("no unit in the list matched a datasheet", 422);
  return { army: { edition, order, units }, skipped };
}

/** True when `value` has the army-data shape the mod reads: every ordered uuid names a unit. */
function isArmyData(value: unknown): value is ArmyData {
  if (!value || typeof value !== "object") return false;
  const { edition, order, units } = value as Record<string, unknown>;
  if (typeof edition !== "string" || !Array.isArray(order) || !units || typeof units !== "object" || Array.isArray(units)) return false;
  return order.length > 0 && order.every((id) => typeof id === "string" && Object.hasOwn(units, id));
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function store(env: Env, army: ArmyData, settings: Settings): Promise<string | null> {
  const record: StoredArmy = { edition: army.edition, order: army.order, armyData: army.units, ...settings };
  const body = sanitize(JSON.stringify(record));
  const ttlMs = Number(env.CODE_TTL_MINUTES ?? 10) * 60_000;
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const code = newCode();
    if (await env.ARMIES.get(env.ARMIES.idFromName(code)).create(body, ttlMs)) return code;
  }
  return null;
}

/**
 * Mints a code for `army` on Yellowscribe's own server (`POST /getArmyCode`, the
 * call its site makes), so the stock TTS mod can load it. Returns the code, or a
 * 502 when that server fails or answers with something other than a code.
 */
async function yellowscribeCode(env: Env, army: ArmyData, settings: Settings): Promise<string | Response> {
  const origin = env.YELLOWSCRIBE_ORIGIN ?? "https://yellowscribe.link";
  const query = new URLSearchParams({ uiHeight: settings.uiHeight, uiWidth: settings.uiWidth, decorativeNames: settings.decorativeNames, modules: settings.modules.join(",") });
  let res: Response;
  try {
    res = await fetch(`${origin}/getArmyCode?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(army),
      signal: AbortSignal.timeout(YELLOWSCRIBE_TIMEOUT_MS),
    });
  } catch (err) {
    return fail(`Yellowscribe did not answer: ${(err as Error).message}`, 502);
  }
  const text = await res.text();
  let code: unknown;
  try {
    code = (JSON.parse(text) as { code?: unknown }).code;
  } catch {
    code = undefined;
  }
  if (!res.ok || typeof code !== "string" || !/^[0-9a-f]{8}$/.test(code)) return fail(`Yellowscribe refused the army (HTTP ${res.status})`, 502);
  return code;
}

/** The document Yellowscribe serves for a code: the stored army plus the Lua its modules build. */
function served(stored: StoredArmy): string {
  const { modules, armyData, ...rest } = stored;
  return JSON.stringify({ xml: undefined, edition: rest.edition, order: rest.order, height: undefined, armyData, uiHeight: rest.uiHeight, uiWidth: rest.uiWidth, decorativeNames: rest.decorativeNames, baseScript: buildScript(modules) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET") {
      if (url.pathname === "/get_army_by_id") {
        const id = (url.searchParams.get("id") ?? "").trim().toLowerCase();
        if (!/^[0-9a-f]{8}$/.test(id)) return fail("Your roster code appears to have expired, please upload it again and get a new code.", 404);
        const body = await env.ARMIES.get(env.ARMIES.idFromName(id)).read();
        if (body === null) return fail("Your roster code appears to have expired, please upload it again and get a new code.", 404);
        return json(served(JSON.parse(body) as StoredArmy));
      }
      if (url.pathname === "/machine.lua") return new Response(machineScript(url.origin), { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
      if (url.pathname === "/") return json({ service: "40kdc-tts", endpoints: ["POST /makeArmyAndReturnCode", "POST /getFormattedArmy", "POST /getArmyCode", "POST /yellowscribeArmyCode", "GET /get_army_by_id?id=", "GET /machine.lua"] });
      return fail("not found", 404);
    }

    if (request.method !== "POST") return fail("method not allowed", 405);

    if (url.pathname === "/makeArmyAndReturnCode" || url.pathname === "/getFormattedArmy" || url.pathname === "/yellowscribeArmyCode") {
      const made = await armyFromUpload(request, url, env);
      if (made instanceof Response) return made;
      if (url.pathname === "/yellowscribeArmyCode") {
        const code = await yellowscribeCode(env, made.army, settingsOf(url));
        return code instanceof Response ? code : json({ code, server: env.YELLOWSCRIBE_ORIGIN ?? "https://yellowscribe.link", skipped: made.skipped });
      }
      if (url.pathname === "/getFormattedArmy") return json({ ...made.army, errors: made.skipped.map((name) => `${name}: no matching datasheet`) });
      const code = await store(env, made.army, settingsOf(url));
      return code ? json({ code, skipped: made.skipped }) : fail("could not allocate a code; try again", 503);
    }

    if (url.pathname === "/getArmyCode") {
      const bytes = await readUpload(request, env);
      if (bytes instanceof Response) return bytes;
      let army: unknown;
      try {
        army = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return fail("body is not JSON", 400);
      }
      if (!isArmyData(army)) return fail("body is not army data: needs edition, order and units", 400);
      const code = await store(env, { edition: army.edition, order: army.order, units: army.units }, settingsOf(url));
      return code ? json({ code }) : fail("could not allocate a code; try again", 503);
    }

    return fail("not found", 404);
  },
} satisfies ExportedHandler<Env>;
