/**
 * The Tabletop Simulator code request: what goes to the TTS worker, and how
 * each kind of reply (code, refusal, malformed, network failure) reaches the UI.
 */
import { describe, it, expect } from "vitest";
import { decodeShareToken } from "@alpaca-software/40kdc-data";
import { requestTtsCode, TTS_ORIGIN } from "./tts-code";
import { tryEncodeShareToken } from "./share-link";
import { emptyBuilderState, detachmentsForFaction } from "./builder";

interface Call {
	url: string;
	init: RequestInit | undefined;
}

function fakeFetch(reply: () => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return reply();
	}) as typeof fetch;
	return { fetch: fn, calls };
}

const jsonReply = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("requestTtsCode", () => {
	it("posts the bare share token to the stock-mod route and returns the code", async () => {
		const { fetch, calls } = fakeFetch(() =>
			jsonReply({ code: "0a1b2c3d", server: "https://yellowscribe.link", skipped: ["Made-up Unit"] }),
		);
		const res = await requestTtsCode("AbC_123-xyz", fetch);

		expect(res).toEqual({ ok: true, code: "0a1b2c3d", skipped: ["Made-up Unit"] });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${TTS_ORIGIN}/yellowscribeArmyCode`);
		expect(calls[0].init?.method).toBe("POST");
		expect(calls[0].init?.body).toBe("AbC_123-xyz");
		// A non-simple content type would trigger a CORS preflight.
		expect(new Headers(calls[0].init?.headers).get("Content-Type")).toBe("text/plain");
	});

	it("surfaces the worker's refusal message", async () => {
		const { fetch } = fakeFetch(() => jsonReply({ err: "Yellowscribe refused the army (HTTP 500)" }, 502));
		const res = await requestTtsCode("tok", fetch);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toContain("Yellowscribe refused the army (HTTP 500)");
	});

	it("falls back to the HTTP status when a refusal has no JSON body", async () => {
		const { fetch } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 504 }));
		const res = await requestTtsCode("tok", fetch);
		expect(res).toEqual({ ok: false, error: expect.stringContaining("HTTP 504") });
	});

	it.each([
		["a missing code", {}],
		["a code that isn't 8 hex digits", { code: "0A1B2C3D" }],
		["a short code", { code: "abc123" }],
		["a non-string code", { code: 12345678 }],
	])("rejects a 200 reply with %s", async (_label, body) => {
		const { fetch } = fakeFetch(() => jsonReply(body));
		const res = await requestTtsCode("tok", fetch);
		expect(res).toEqual({ ok: false, error: expect.stringContaining("invalid code") });
	});

	it("rejects a 200 reply that isn't JSON", async () => {
		const { fetch } = fakeFetch(() => new Response("not json", { status: 200 }));
		expect((await requestTtsCode("tok", fetch)).ok).toBe(false);
	});

	it("reports a network failure instead of throwing", async () => {
		const { fetch } = fakeFetch(() => {
			throw new TypeError("Failed to fetch");
		});
		const res = await requestTtsCode("tok", fetch);
		expect(res).toEqual({ ok: false, error: expect.stringContaining("Couldn’t reach") });
	});

	it("drops non-string entries from skipped", async () => {
		const { fetch } = fakeFetch(() => jsonReply({ code: "deadbeef", skipped: ["A", 3, null] }));
		expect(await requestTtsCode("tok", fetch)).toEqual({ ok: true, code: "deadbeef", skipped: ["A"] });
	});
});

describe("tryEncodeShareToken", () => {
	it("yields a token that decodes back to the draft's faction and detachment", () => {
		const state = emptyBuilderState();
		state.factionId = "adeptus-astartes";
		const det = detachmentsForFaction("adeptus-astartes")[0]?.id;
		state.detachmentIds = det ? [det] : [];

		const encoded = tryEncodeShareToken(state);
		expect(encoded.ok).toBe(true);
		if (!encoded.ok) return;
		const decoded = decodeShareToken(encoded.token);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(decoded.list.factionId).toBe("adeptus-astartes");
	});

	it("returns the codec error for an id the registry lacks", () => {
		const encoded = tryEncodeShareToken({ ...emptyBuilderState(), factionId: "not-in-registry" });
		expect(encoded.ok).toBe(false);
	});
});
