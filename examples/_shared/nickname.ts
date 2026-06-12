/**
 * Session nickname helpers shared by the example apps. The nickname is
 * cosmetic (presence rosters only — never an identity), remembered per-origin
 * so the live-session widget can prompt once and stay out of the way.
 */

const STORAGE_KEY = "alpacasoft.nickname";

/** Mirror of the server's hello/nick handling (trim, cap at 40 chars). An
 *  empty result means "don't connect yet — keep prompting". */
export function normalizeNickname(raw: string): string {
  return raw.slice(0, 40).trim();
}

export function storedNickname(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const name = raw ? normalizeNickname(raw) : "";
    return name || null;
  } catch {
    return null;
  }
}

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeNickname(name));
  } catch {
    /* storage blocked — they'll be asked again next session */
  }
}
