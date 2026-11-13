/**
 * The army-code worker end to end: uploads in every accepted shape, the stored
 * document the TTS mod fetches, and the failures a client sees.
 */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { encodeShareToken } from "../../../tools/src/share/index.js";
import type { ArmyStore } from "../src/army-store";
import { buildScript, machineScript } from "../src/script";

const BASE = "https://tts.example";
const daemonsRos = env.FIXTURE_DAEMONS_ROS;
const gwText = env.FIXTURE_GW_TEXT;

async function upload(path: string, body: BodyInit, query = ""): Promise<Response> {
  return SELF.fetch(`${BASE}${path}${query}`, { method: "POST", body });
}

async function codeFor(body: BodyInit, query = ""): Promise<string> {
  const res = await upload("/makeArmyAndReturnCode", body, query);
  expect(res.status, await res.clone().text()).toBe(200);
  const { code } = (await res.json()) as { code: string };
  expect(code).toMatch(/^[0-9a-f]{8}$/);
  return code;
}

interface Served {
  edition: string;
  order: string[];
  armyData: Record<string, { name: string; models: { totalNumberOfModels: number } }>;
  uiHeight: string;
  uiWidth: string;
  decorativeNames: string;
  baseScript: string;
}

async function fetchArmy(code: string): Promise<Served> {
  const res = await SELF.fetch(`${BASE}/get_army_by_id?id=${code}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Served;
}

const names = (army: Served): string[] => army.order.map((id) => army.armyData[id]!.name);

describe("army codes", () => {
  it("stores a .rosz upload and serves it in Yellowscribe's document shape", async () => {
    const rosz = zipSync({ "Daemons check.ros": strToU8(daemonsRos) });
    const code = await codeFor(rosz, "?filename=Daemons%20check.rosz&uiHeight=800&decorativeNames=true");
    const army = await fetchArmy(code);
    expect(army.edition).toBe("11e");
    expect(names(army)).toEqual(["Bloodmaster", "Bloodletters"]);
    expect(army.armyData[army.order[1]!]!.models.totalNumberOfModels).toBe(10);
    expect([army.uiHeight, army.uiWidth, army.decorativeNames]).toEqual(["800", "1200", "true"]);
    expect(army.baseScript).toBe(buildScript(["MatchedPlay"]));
  });

  it("accepts .ros XML, GW app text and a list-builder share link", async () => {
    const fromRos = await fetchArmy(await codeFor(daemonsRos));
    expect(names(fromRos)).toEqual(["Bloodmaster", "Bloodletters"]);

    const fromText = await fetchArmy(await codeFor(gwText));
    expect(names(fromText)).toContain("Intercessor Squad");

    const token = encodeShareToken({
      name: "Shared",
      factionId: "chaos-daemons",
      detachmentIds: ["blood-legion"],
      battleSize: "strike-force",
      disposition: null,
      units: [{ datasheetId: "bloodletters", modelCount: 10, isWarlord: false, enhancementId: null, allyFactionId: null, allyRuleId: null, attachedToOrdinal: null, grants: [], loadout: [["hellblade", 10]] }],
    });
    for (const input of [token, `https://list-builder.alpacasoft.dev/#l=${token}`]) {
      const army = await fetchArmy(await codeFor(input));
      expect(names(army)).toEqual(["Bloodletters"]);
    }
  });

  it("keeps < and > out of the stored army, as Yellowscribe does", async () => {
    const army = await fetchArmy(await codeFor(gwText));
    expect(JSON.stringify(army.armyData)).not.toMatch(/[<>]/);
  });

  it("formats an army without storing it, and stores formatted army data on request", async () => {
    const res = await upload("/getFormattedArmy", daemonsRos);
    expect(res.status).toBe(200);
    const formatted = (await res.json()) as { edition: string; order: string[]; units: Record<string, unknown>; errors: string[] };
    expect(formatted.errors).toEqual([]);
    const stored = await upload("/getArmyCode", JSON.stringify(formatted), "?modules=MatchedPlay,Crusade");
    const { code } = (await stored.json()) as { code: string };
    const army = await fetchArmy(code);
    expect(army.order).toEqual(formatted.order);
    // Only the vendored module builds; an unknown one is ignored, as Yellowscribe does.
    expect(army.baseScript).toBe(buildScript(["MatchedPlay"]));
  });

  it("rejects what it cannot read", async () => {
    expect((await upload("/makeArmyAndReturnCode", "")).status).toBe(400);
    expect((await upload("/makeArmyAndReturnCode", "hello there")).status).toBe(415);
    expect((await upload("/makeArmyAndReturnCode", "x".repeat(200_001))).status).toBe(413);
    expect((await upload("/makeArmyAndReturnCode", "<roster/>")).status).toBe(415);
    expect((await upload("/getArmyCode", "{nope")).status).toBe(400);
    expect((await upload("/getArmyCode", JSON.stringify({ edition: "11e", order: ["0000dead"], units: {} }))).status).toBe(400);
    const err = (await (await upload("/makeArmyAndReturnCode", "hello there")).json()) as { err: string };
    expect(err.err).toMatch(/none recognised/);
  });

  it("answers 404 for an unknown, malformed or expired code", async () => {
    expect((await SELF.fetch(`${BASE}/get_army_by_id?id=0badc0de`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/get_army_by_id?id=../etc`)).status).toBe(404);
    const stub = env.ARMIES.get(env.ARMIES.idFromName("feedface"));
    expect(await stub.create("{}", 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await stub.read()).toBeNull();
    // An expired code can be minted again; a live one cannot.
    expect(await stub.create("{}", 60_000)).toBe(true);
    expect(await stub.create("{}", 60_000)).toBe(false);
    await runInDurableObject(stub, async (instance: ArmyStore) => {
      await instance.alarm();
      expect(await instance.read()).toBeNull();
    });
  });
});

describe("Lua", () => {
  it("builds the scripting table the way Yellowscribe's ScriptBuilder does", () => {
    const script = buildScript(["MatchedPlay"]);
    expect(script.startsWith("\n\n\n\n\nlocal scriptingFunctions\n\n\n\n\n")).toBe(true);
    const table = script.slice(script.lastIndexOf("scriptingFunctions = {"));
    const slots = table.split("\n").slice(1, 11);
    expect(slots[0]).toBe("\t--[[1]]  function (playerColor) showCard('dataCard', playerColor) end,");
    expect(slots[7]).toBe("\t--[[8]]  toggleRectangularMeasuring,");
    expect(slots.slice(8)).toEqual(["\tnone,", "\tnone"]);
    expect(table.endsWith("\tnone\n}")).toBe(true);
  });

  it("serves the Yellow Machine script pointed at this host", async () => {
    const res = await SELF.fetch(`${BASE}/machine.lua`);
    const text = await res.text();
    expect(text).toBe(machineScript(BASE));
    expect(text).toContain(`"${BASE}/get_army_by_id?id="`);
    expect(text).not.toContain("yellowscribe.link/get_army_by_id");
  });
});
