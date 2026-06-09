/**
 * Unit tests for the backend-free share link: gzip+base64url round-trip, plus a
 * full builder → roster-json → link → import round-trip against the embedded data.
 */
import { describe, it, expect } from "vitest";
import { encodeShareLink, decodeShareLink } from "./share-link";
import {
	emptyBuilderState,
	builderToRosterJson,
	rosterTextToBuilderState,
	unitRaw,
	defaultLoadout,
	unitsForFaction,
	detachmentsForFaction,
} from "./builder";

describe("share-link codec", () => {
	it("round-trips an arbitrary string (incl. non-ASCII) and stays URL-safe", () => {
		const json = JSON.stringify({ name: "Tést 🔒", units: [{ id: "x" }] });
		const token = encodeShareLink(json);
		expect(token).not.toMatch(/[+/=]/); // base64url, no padding
		expect(decodeShareLink(token)).toBe(json);
	});

	it("returns null on malformed input rather than throwing", () => {
		expect(decodeShareLink("")).toBeNull();
		expect(decodeShareLink("not%%valid")).toBeNull();
	});
});

describe("share-link list round-trip", () => {
	it("rebuilds the same list from its share link", () => {
		const state = emptyBuilderState();
		state.factionId = "adeptus-astartes";
		const firstDet = detachmentsForFaction("adeptus-astartes")[0]?.id;
		state.detachmentIds = firstDet ? [firstDet] : [];
		const unit = unitsForFaction("adeptus-astartes").find(
			(u) => (u.points?.length ?? 0) > 0 && u.model_count != null,
		)!;
		const raw = unitRaw(unit.id)!;
		const modelCount = raw.model_count?.min ?? 1;
		state.units = [
			{
				key: "k0",
				datasheetId: unit.id,
				modelCount,
				loadout: defaultLoadout(raw, modelCount),
				enhancementId: null,
				isWarlord: false,
			},
		];

		const json = builderToRosterJson(state);
		const decoded = decodeShareLink(encodeShareLink(json));
		expect(decoded).toBe(json);

		const back = rosterTextToBuilderState(decoded!, "Shared list", null);
		expect(back).not.toBeNull();
		expect(back!.factionId).toBe(state.factionId);
		expect(back!.detachmentIds).toEqual(state.detachmentIds);
		expect(back!.units).toHaveLength(1);
		expect(back!.units[0].datasheetId).toBe(unit.id);
	});
});
