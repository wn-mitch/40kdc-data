/** Items in alphabetical order of the text a select shows for each; the input is left unchanged. */
export function alphabetical<T>(items: readonly T[], label: (item: T) => string = String): T[] {
  return [...items].sort((left, right) => label(left).localeCompare(label(right), undefined, { sensitivity: "base", numeric: true }));
}

/** Render an unknown API value for display. */
export const readable = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "Unknown";

/** Call the local same-origin workbench bridge; non-2xx responses throw with the server's reason. */
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/__round5c${path}`, {
    method: body === undefined ? "GET" : "POST", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "error" in payload ? readable(payload.error) : response.statusText;
    const hint = response.status === 409 ? " Reload the source before retrying; nothing in this batch was applied." : "";
    throw new Error(`${response.status}: ${detail || "Request failed"}${hint}`);
  }
  if (payload === null) throw new Error("The local API returned an empty or non-JSON response.");
  return payload as T;
}
