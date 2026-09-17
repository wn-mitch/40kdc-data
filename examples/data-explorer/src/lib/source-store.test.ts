import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSource,
  entryKind,
  entryToText,
  loadFactionIndex,
  _clearMemCache,
  DEFAULT_SOURCE,
} from "./source-store.js";

describe("parseSource", () => {
  it("resolves owner/repo to a main-branch raw base URL", () => {
    const p = parseSource("wn-mitch/40kdc-abilities");
    expect(p.baseUrl).toBe(
      "https://raw.githubusercontent.com/wn-mitch/40kdc-abilities/main",
    );
    expect(p.label).toBe("wn-mitch/40kdc-abilities@main");
  });

  it("honours an explicit @ref", () => {
    const p = parseSource("bmerrill17/40kdc-abilities@dev");
    expect(p.baseUrl).toBe(
      "https://raw.githubusercontent.com/bmerrill17/40kdc-abilities/dev",
    );
    expect(p.label).toBe("bmerrill17/40kdc-abilities@dev");
  });

  it("blank falls back to the default source", () => {
    expect(parseSource("").baseUrl).toBe(parseSource(DEFAULT_SOURCE).baseUrl);
    expect(parseSource("   ").label).toBe(parseSource(DEFAULT_SOURCE).label);
  });

  it("accepts a raw base URL", () => {
    expect(parseSource("https://example.com/store/").baseUrl).toBe(
      "https://example.com/store",
    );
  });

  it("normalizes a direct index.json URL to its containing directory", () => {
    expect(parseSource("https://example.com/store/index.json").baseUrl).toBe(
      "https://example.com/store",
    );
  });

  it("rejects malformed specs", () => {
    expect(() => parseSource("not a repo")).toThrow();
    expect(() => parseSource("toomany/slashes/here")).toThrow();
  });
});

describe("entryKind / entryToText", () => {
  it("classifies a raw_text entry", () => {
    const e = { faction: "necrons", raw_text: "Deals D3 mortal wounds." };
    expect(entryKind(e)).toBe("raw");
    expect(entryToText(e)).toBe("Deals D3 mortal wounds.");
  });

  it("classifies a structured stratagem-shaped entry", () => {
    const e = { when: "Your turn.", target: "One unit.", effect: "It fights." };
    expect(entryKind(e)).toBe("structured");
    expect(entryToText(e)).toBe(
      "WHEN: Your turn.\nTARGET: One unit.\nEFFECT: It fights.",
    );
  });

  it("treats whitespace-only raw_text and missing entries as empty", () => {
    expect(entryKind({ raw_text: "   " })).toBe("empty");
    expect(entryKind(undefined)).toBe("empty");
    expect(entryToText(undefined)).toBe("");
  });
});


describe("loadFactionIndex", () => {
  beforeEach(() => _clearMemCache());

  it("loads only core plus the selected faction and overlays duplicate ids", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (url: string) => {
      requests.push(url);
      const body = url.endsWith("/core.json")
        ? [{ ability_id: "leader", faction_id: "core", raw_text: "Core leader." }]
        : [{ ability_id: "leader", faction_id: "orks", raw_text: "Orks leader." }];
      return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
    }) as typeof fetch;
    const result = await loadFactionIndex("owner/repo@main", "orks", { fetchImpl });
    expect(result.index.leader.raw_text).toBe("Orks leader.");
    expect(requests).toEqual([
      "https://raw.githubusercontent.com/owner/repo/main/core.json",
      "https://raw.githubusercontent.com/owner/repo/main/orks.json",
    ]);
  });

  it("rejects a faction file containing another faction's record", async () => {
    const fetchImpl = (async (url: string) => {
      const body = url.endsWith("/core.json") ? [] : [{ ability_id: "leader", faction_id: "tyranids" }];
      return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
    }) as typeof fetch;
    await expect(loadFactionIndex("owner/repo@main", "orks", { fetchImpl })).rejects.toThrow(/Invalid ability entry/);
  });

  it("rejects malformed text fields before caching", async () => {
    const fetchImpl = (async (url: string) => {
      const body = url.endsWith("/core.json") ? [] : [{ ability_id: "leader", faction_id: "orks", raw_text: 42 }];
      return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
    }) as typeof fetch;
    await expect(loadFactionIndex("owner/repo@main", "orks", { fetchImpl })).rejects.toThrow(/Invalid ability entry/);
  });
});
