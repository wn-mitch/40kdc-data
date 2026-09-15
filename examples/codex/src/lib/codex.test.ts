import { describe, expect, it, vi } from "vitest";
import { units } from "@alpaca-software/40kdc-data";
import { formatBaseSize } from "../../../_shared/unit-card.js";
import { resolveCodexRoute } from "./catalog.js";
import { codexHref, parseCodexRoute } from "./routes.js";
import { sharePage } from "./share.js";

describe("Codex routes", () => {
  it("parses the canonical Orks routes", () => {
    expect(parseCodexRoute("/factions/orks")).toEqual({ kind: "faction", factionId: "orks" });
    expect(parseCodexRoute("/factions/orks/units/weirdboy")).toEqual({
      kind: "unit",
      factionId: "orks",
      unitId: "weirdboy",
    });
    expect(parseCodexRoute("/factions/orks/detachments/kult-of-speed")).toEqual({
      kind: "detachment",
      factionId: "orks",
      detachmentId: "kult-of-speed",
    });
    expect(codexHref({ kind: "unit", factionId: "orks", unitId: "weird boy" })).toBe(
      "/factions/orks/units/weird%20boy",
    );
  });

  it("rejects malformed and unsupported paths", () => {
    expect(parseCodexRoute("/factions/%E0%A4%A")).toEqual({ kind: "not-found" });
    expect(parseCodexRoute("/factions/orks/units")).toEqual({ kind: "not-found" });
    expect(parseCodexRoute("/factions//orks")).toEqual({ kind: "not-found" });
  });

  it("resolves only records that belong to the URL faction", () => {
    const faction = resolveCodexRoute(parseCodexRoute("/factions/orks"));
    expect(faction.kind).toBe("faction");
    if (faction.kind === "faction") expect(faction.faction.name).toBe("Orks");

    const unit = resolveCodexRoute(parseCodexRoute("/factions/orks/units/weirdboy"));
    expect(unit.kind).toBe("unit");
    if (unit.kind === "unit") expect(unit.unit.name).toBe("Weirdboy");

    const detachment = resolveCodexRoute(
      parseCodexRoute("/factions/orks/detachments/kult-of-speed"),
    );
    expect(detachment.kind).toBe("detachment");
    if (detachment.kind === "detachment") {
      expect(detachment.detachment.raw.name).toBe("Kult of Speed");
    }

    expect(resolveCodexRoute(parseCodexRoute("/factions/no-such-faction"))).toEqual({
      kind: "not-found",
    });
    expect(resolveCodexRoute(parseCodexRoute("/factions/orks/units/no-such-unit"))).toEqual({
      kind: "not-found",
    });
    expect(
      resolveCodexRoute(parseCodexRoute("/factions/orks/detachments/no-such-detachment")),
    ).toEqual({ kind: "not-found" });
    expect(resolveCodexRoute(parseCodexRoute("/factions/world-eaters/units/weirdboy"))).toEqual({
      kind: "not-found",
    });
  });

  it("resolves every declared Tyranids faction rule", () => {
    const faction = resolveCodexRoute(parseCodexRoute("/factions/tyranids"));
    expect(faction.kind).toBe("faction");
    if (faction.kind === "faction") {
      expect(faction.factionRules.map((rule) => rule.id)).toEqual([
        "shadow-in-the-warp",
        "synapse",
      ]);
    }
  });
});

describe("base-size formatting", () => {
  it("formats every schema shape and provisional entries", () => {
    expect(formatBaseSize(undefined)).toBeNull();
    expect(formatBaseSize({ shape: "round", diameter: 100 })).toBe("100mm base");
    expect(formatBaseSize({ shape: "round" })).toBe("round base");
    expect(formatBaseSize({ shape: "oval", width: 150, length: 95 })).toBe("150×95mm base");
    expect(formatBaseSize({ shape: "oval" })).toBe("oval base");
    expect(formatBaseSize({ shape: "flying-base", size: "small" })).toBe("small flying base");
    expect(formatBaseSize({ shape: "flying-base", size: "large" })).toBe("large flying base");
    expect(formatBaseSize({ shape: "hull" })).toBe("hull");
    expect(formatBaseSize({ shape: "unique", draft: true })).toBe("unique base (provisional)");
  });

  it("formats Angron's real base-size record", () => {
    const angron = units.getAny("angron");
    expect(angron?.raw.base_size_mm).toEqual({ shape: "round", diameter: 100 });
    expect(formatBaseSize(angron?.raw.base_size_mm)).toBe("100mm base");
  });
});

describe("sharePage", () => {
  const input = { title: "Weirdboy · Orks · 40kdc Codex", url: "https://codex.example/orks" };

  it("uses native sharing when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await expect(sharePage(input, { share })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(input);
  });

  it("does not show feedback for a cancelled share", async () => {
    const error = Object.assign(new Error("cancelled"), { name: "AbortError" });
    await expect(sharePage(input, { share: vi.fn().mockRejectedValue(error) })).resolves.toBe("cancelled");
  });

  it("falls back to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(sharePage(input, { clipboard: { writeText } })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(input.url);
  });

  it("reports unavailable sharing without throwing", async () => {
    await expect(sharePage(input, {})).resolves.toBe("unavailable");
    await expect(
      sharePage(input, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } }),
    ).resolves.toBe("unavailable");
  });
});
