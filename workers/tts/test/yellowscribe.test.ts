/**
 * Codes minted on Yellowscribe's server (`POST /yellowscribeArmyCode`). The
 * upstream is stubbed; nothing leaves the test runner.
 */
import { env, fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const BASE = "https://tts.example";
const UPSTREAM = "https://yellowscribe.test";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const post = (body: string, query = ""): Promise<Response> => SELF.fetch(`${BASE}/yellowscribeArmyCode${query}`, { method: "POST", body });

describe("Yellowscribe codes", () => {
  it("posts the converted army to getArmyCode with the upload's settings and returns its code", async () => {
    let sent: { edition: string; order: string[]; units: Record<string, { name: string }> } | undefined;
    fetchMock
      .get(UPSTREAM)
      .intercept({ method: "POST", path: "/getArmyCode?uiHeight=800&uiWidth=1200&decorativeNames=true&modules=MatchedPlay" })
      .reply(200, (req) => {
        sent = JSON.parse(String(req.body));
        return '{ "code": "592b84be" }';
      });
    const res = await post(env.FIXTURE_DAEMONS_ROS, "?uiHeight=800&decorativeNames=true");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "592b84be", server: UPSTREAM, skipped: [] });
    // The body is exactly what /getFormattedArmy returns, minus its error list.
    const formatted = (await (await SELF.fetch(`${BASE}/getFormattedArmy`, { method: "POST", body: env.FIXTURE_DAEMONS_ROS })).json()) as Record<string, unknown>;
    const { errors: _errors, ...army } = formatted;
    expect(sent!.edition).toBe("11e");
    expect(sent!.order.map((id) => sent!.units[id]!.name)).toEqual(["Bloodmaster", "Bloodletters"]);
    expect(Object.keys(sent!)).toEqual(Object.keys(army));
  });

  it("answers 502 when Yellowscribe fails or answers without a code", async () => {
    fetchMock.get(UPSTREAM).intercept({ method: "POST", path: /^\/getArmyCode/ }).reply(500, '{ "err": "boom" }');
    expect((await post(env.FIXTURE_GW_TEXT)).status).toBe(502);
    fetchMock.get(UPSTREAM).intercept({ method: "POST", path: /^\/getArmyCode/ }).reply(200, "<html>maintenance</html>");
    const res = await post(env.FIXTURE_GW_TEXT);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { err: string }).err).toMatch(/refused/);
  });

  it("rejects an unreadable list before calling Yellowscribe", async () => {
    // No interceptor: a call upstream would fail the test via disableNetConnect.
    expect((await post("hello there")).status).toBe(415);
  });
});
