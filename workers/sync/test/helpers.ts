/** Mint real Ed25519 entitlement tokens with the committed TEST keypair (the
 *  worker env pins the matching public key), so tests exercise the production
 *  verification path — no DEV_ALLOW_ALL. */
import { SELF } from "cloudflare:test";
import { TEST_PRIVATE_KEY_PKCS8_B64 } from "./keypair";

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function mintToken(sub: string, expMs = Date.now() + 60_000): Promise<string> {
  const der = Uint8Array.from(atob(TEST_PRIVATE_KEY_PKCS8_B64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  const payload = b64url(enc.encode(JSON.stringify({ v: 2, sub, exp: expMs })));
  const sig = await crypto.subtle.sign("Ed25519", key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await SELF.fetch(`https://sync.test${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
