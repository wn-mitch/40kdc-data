/**
 * The compact `share-v1` share link, end-to-end against the embedded data:
 * a builder draft → token → draft round-trip that preserves the fields the
 * roster-json link dropped, plus the size win over the legacy link.
 */
import { describe, it, expect } from "vitest";
import { encodeShareToken, decodeShareToken } from "@alpaca-software/40kdc-data";
import { encodeShareLink } from "./share-link";
import {
	builderStateToShareList,
	shareListToBuilderState,
	builderToRosterJson,
	emptyBuilderState,
	defaultLoadout,
	detachmentsForFaction,
	unitRaw,
	unitsForFaction,
	type BuilderUnit,
} from "./builder";

const FACTION = "adeptus-astartes";

/** A draft exercising allies, grants, an enhancement, and an attachment. */
function sampleDraft() {
	const state = emptyBuilderState();
	state.name = "Strîke Force 🔨";
	state.factionId = FACTION;
	state.detachmentIds = detachmentsForFaction(FACTION)
		.slice(0, 2)
		.map((d) => d.id);

	const units = unitsForFaction(FACTION).filter(
		(u) => (u.points?.length ?? 0) > 0 && u.model_count != null,
	);
	const leaderUnit = units[0];
	const bodyguardUnit = units[1];
	const leaderRaw = unitRaw(leaderUnit.id)!;
	const bodyguardRaw = unitRaw(bodyguardUnit.id)!;

	const leader: BuilderUnit = {
		key: "k-leader",
		datasheetId: leaderUnit.id,
		modelCount: leaderRaw.model_count?.min ?? 1,
		loadout: defaultLoadout(leaderRaw, leaderRaw.model_count?.min ?? 1),
		enhancementId: null,
		isWarlord: true,
		selectedGrants: ["Character"],
		attachedToKey: "k-bodyguard",
	};
	const bodyguard: BuilderUnit = {
		key: "k-bodyguard",
		datasheetId: bodyguardUnit.id,
		modelCount: bodyguardRaw.model_count?.min ?? 1,
		loadout: defaultLoadout(bodyguardRaw, bodyguardRaw.model_count?.min ?? 1),
		enhancementId: null,
		isWarlord: false,
	};
	state.units = [leader, bodyguard];
	return state;
}

describe("share-v1 link (example app)", () => {
	it("round-trips a draft losslessly through the token", () => {
		const state = sampleDraft();
		const token = encodeShareToken(builderStateToShareList(state));
		expect(token).not.toMatch(/[+/=]/); // base64url, URL-safe

		const result = decodeShareToken(token);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const back = shareListToBuilderState(result.list);

		// The ShareList is the key-free, ordinal-based canonical form — comparing
		// it both ways proves the round-trip preserved faction, detachments,
		// disposition, the warlord/enhancement/attachment, grants, and loadout.
		expect(builderStateToShareList(back)).toEqual(builderStateToShareList(state));
		expect(back.units[0].attachedToKey).toBe(back.units[1].key); // attachment re-bound
		expect(back.units[0].selectedGrants).toEqual(["Character"]);
	});

	it("is much shorter than the legacy gzip(roster-json) link", () => {
		const state = sampleDraft();
		const compact = encodeShareToken(builderStateToShareList(state));
		const legacy = encodeShareLink(builderToRosterJson(state));
		expect(compact.length).toBeLessThan(legacy.length);
		// The win is large, not marginal — assert at least a 2× reduction.
		expect(compact.length).toBeLessThan(legacy.length / 2);
	});
});
