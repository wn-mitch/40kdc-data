/**
 * Tabletop Simulator army codes. The list's share token goes to the 40kdc TTS
 * worker's `POST /yellowscribeArmyCode`, which converts it and mints a code on
 * yellowscribe.link — the server the stock Yellowscribe mod reads — so the code
 * loads without re-pointing the mod's script.
 */

export const TTS_ORIGIN = "https://tts.alpacasoft.dev";

/** Yellowscribe codes are 8 lowercase hex digits. */
const CODE = /^[0-9a-f]{8}$/;

export type TtsCodeResult =
	| { ok: true; code: string; skipped: string[] }
	| { ok: false; error: string };

/**
 * Requests an army code for a share token. Never throws: a network failure, a
 * refusal (the worker's `{err}` body), and a reply without a valid code each
 * come back as `{ok: false}` with a message for the user.
 */
export async function requestTtsCode(
	token: string,
	fetchFn: typeof fetch = fetch,
	origin: string = TTS_ORIGIN,
): Promise<TtsCodeResult> {
	let res: Response;
	try {
		// text/plain keeps this a simple CORS request (no preflight).
		res = await fetchFn(`${origin}/yellowscribeArmyCode`, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: token,
		});
	} catch {
		return { ok: false, error: "Couldn’t reach the Tabletop Simulator server. Check your connection and try again." };
	}
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	if (!res.ok) {
		const err = typeof fields.err === "string" && fields.err ? fields.err : `HTTP ${res.status}`;
		return { ok: false, error: `The Tabletop Simulator server refused the list: ${err}` };
	}
	if (typeof fields.code !== "string" || !CODE.test(fields.code)) {
		return { ok: false, error: "The Tabletop Simulator server sent back an invalid code. Try again." };
	}
	const skipped = Array.isArray(fields.skipped)
		? fields.skipped.filter((s): s is string => typeof s === "string")
		: [];
	return { ok: true, code: fields.code, skipped };
}
