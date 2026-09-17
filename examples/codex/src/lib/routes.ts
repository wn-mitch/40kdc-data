export interface HomeRoute {
  kind: "home";
}

export interface FactionRoute {
  kind: "faction";
  factionId: string;
}

export interface UnitRoute {
  kind: "unit";
  factionId: string;
  unitId: string;
}

export interface DetachmentRoute {
  kind: "detachment";
  factionId: string;
  detachmentId: string;
}

export interface NotFoundRoute {
  kind: "not-found";
}

export type CodexRoute =
  | HomeRoute
  | FactionRoute
  | UnitRoute
  | DetachmentRoute
  | NotFoundRoute;

/** Parse only the canonical Codex URL shapes. */
export function parseCodexRoute(pathname: string): CodexRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return { kind: "home" };

  const rawSegments = normalized.split("/");
  if (rawSegments[0] !== "" || rawSegments.some((segment, index) => index > 0 && segment === "")) {
    return { kind: "not-found" };
  }

  let segments: string[];
  try {
    segments = rawSegments.slice(1).map(decodeURIComponent);
  } catch {
    return { kind: "not-found" };
  }

  if (segments.length === 2 && segments[0] === "factions") {
    return { kind: "faction", factionId: segments[1] };
  }
  if (segments.length === 4 && segments[0] === "factions" && segments[2] === "units") {
    return { kind: "unit", factionId: segments[1], unitId: segments[3] };
  }
  if (segments.length === 4 && segments[0] === "factions" && segments[2] === "detachments") {
    return { kind: "detachment", factionId: segments[1], detachmentId: segments[3] };
  }
  return { kind: "not-found" };
}

/** Build a canonical Codex path, encoding every route identifier. */
export function codexHref(route: Exclude<CodexRoute, NotFoundRoute>): string {
  if (route.kind === "home") return "/";
  const faction = encodeURIComponent(route.factionId);
  if (route.kind === "faction") return `/factions/${faction}`;
  if (route.kind === "unit") return `/factions/${faction}/units/${encodeURIComponent(route.unitId)}`;
  return `/factions/${faction}/detachments/${encodeURIComponent(route.detachmentId)}`;
}
