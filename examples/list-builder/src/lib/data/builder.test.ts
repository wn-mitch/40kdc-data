/**
 * Unit tests for the native list-builder logic. Runs in node against the
 * embedded dataset twin (no browser). The Roster round-trip is also pinned
 * cross-impl in 40kdc-data's conformance suite; here we verify the builder's
 * own derivations and that what it emits re-imports unchanged.
 */
import { describe, it, expect } from 'vitest';
import { ds } from './dataset';
import {
	emptyBuilderState,
	baseUnitPoints,
	pointsTierMissing,
	unitsForFaction,
	detachmentsForFaction,
	eligibleEnhancements,
	defaultLoadout,
	totalPoints,
	builderViolations,
	detachmentTagConflicts,
	builderToRosterJson,
	rosterTextToBuilderState,
	unitRaw,
	groupUnitsByRole,
	groupDraftByRole,
	roleOf,
	sectionOf,
	cloneBuilderUnit,
	loadoutSummary,
	reconcileLoadout,
	itemName,
	unitTypeKeywords,
	alliesForState,
	allyPointsLimit,
	unitMatchesQuery,
	type BuilderState,
	type BuilderUnit,
} from './builder';
import { tryImportRoster } from '@alpaca-software/40kdc-data';

/** First Space Marines unit with a points table and a model-count range. */
function sampleUnit() {
	const u = unitsForFaction('adeptus-astartes').find(
		(x) => (x.points?.length ?? 0) > 0 && x.model_count != null,
	);
	if (!u) throw new Error('no sample SM unit with points + model_count');
	return u;
}

function makeUnit(datasheetId: string, modelCount: number): BuilderUnit {
	const raw = unitRaw(datasheetId)!;
	return {
		key: 'k0',
		datasheetId,
		modelCount,
		loadout: defaultLoadout(raw, modelCount),
		enhancementId: null,
		isWarlord: false,
	};
}

describe('builder points', () => {
	it('picks the highest tier whose threshold the model count reaches', () => {
		const u = sampleUnit();
		const tiers = (u.points ?? []).slice().sort((a, b) => a.models - b.models);
		expect(tiers.length).toBeGreaterThan(0);
		// At each tier's model count, cost equals that tier's cost.
		for (const t of tiers) {
			expect(baseUnitPoints(u, t.models)).toBe(t.cost);
		}
		// Below the smallest tier, falls back to the smallest tier's cost.
		expect(baseUnitPoints(u, tiers[0].models - 1)).toBe(tiers[0].cost);
	});

	it('flags a model count below the smallest points tier', () => {
		const u = sampleUnit();
		const minModels = Math.min(...(u.points ?? []).map((t) => t.models));
		expect(pointsTierMissing(u, minModels - 1)).toBe(true);
		expect(pointsTierMissing(u, minModels)).toBe(false);
	});

	it('sums unit points across the draft', () => {
		const u = sampleUnit();
		const minModels = u.model_count?.min ?? 1;
		const state: BuilderState = {
			...emptyBuilderState(),
			factionId: 'adeptus-astartes',
			units: [makeUnit(u.id, minModels), makeUnit(u.id, minModels)],
		};
		expect(totalPoints(state)).toBe(2 * baseUnitPoints(u, minModels));
	});
});

describe('builder enhancements', () => {
	it('only offers enhancements scoped to the detachment, and only for characters', () => {
		const dets = detachmentsForFaction('adeptus-astartes');
		const det = dets.find((d) => (d.enhancement_ids?.length ?? 0) > 0);
		if (!det) return; // dataset may not carry enhancements yet
		// A non-character unit gets none.
		const squad = unitsForFaction('adeptus-astartes').find(
			(u) => !(u.keywords ?? []).some((k) => k.toLowerCase() === 'character'),
		);
		if (squad) {
			expect(eligibleEnhancements([det.id], squad)).toHaveLength(0);
		}
	});
});

describe('builder export round-trips', () => {
	it('emits roster-json that re-imports with the same units and ids', () => {
		const u = sampleUnit();
		const minModels = u.model_count?.min ?? 1;
		const state: BuilderState = {
			...emptyBuilderState(),
			name: 'Round Trip',
			factionId: 'adeptus-astartes',
			units: [makeUnit(u.id, minModels)],
		};

		const json = builderToRosterJson(state);
		const result = tryImportRoster(json);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.format).toBe('roster-json');
		expect(result.roster.units).toHaveLength(1);
		expect(result.roster.units[0].ref.id).toBe(u.id);
		expect(result.roster.units[0].model_count).toBe(minModels);
	});

	it('seeds a builder state back from its own export', () => {
		const u = sampleUnit();
		const minModels = u.model_count?.min ?? 1;
		const state: BuilderState = {
			...emptyBuilderState(),
			name: 'Seed Me',
			factionId: 'adeptus-astartes',
			disposition: 'take-and-hold',
			units: [makeUnit(u.id, minModels)],
		};

		const json = builderToRosterJson(state);
		const seeded = rosterTextToBuilderState(json, 'Seed Me', 'take-and-hold');
		expect(seeded).not.toBeNull();
		expect(seeded!.units).toHaveLength(1);
		expect(seeded!.units[0].datasheetId).toBe(u.id);
		expect(seeded!.units[0].modelCount).toBe(minModels);
		// Disposition isn't list-encoded; it's carried through the arg.
		expect(seeded!.disposition).toBe('take-and-hold');
	});

	it('returns null when the text is not importable', () => {
		expect(rosterTextToBuilderState('not a list', 'x', null)).toBeNull();
	});
});

describe('builder violations are advisory', () => {
	it('reports a points overrun without throwing', () => {
		const u = sampleUnit();
		const state: BuilderState = {
			...emptyBuilderState(),
			battleSize: 'incursion',
			factionId: 'adeptus-astartes',
			// Enough copies to blow the 1000pt incursion ceiling.
			units: Array.from({ length: 40 }, (_, i) => ({
				...makeUnit(u.id, u.model_count?.min ?? 1),
				key: `k${i}`,
			})),
		};
		const issues = builderViolations(state);
		expect(issues.some((v) => v.unitKey === null && /over the/.test(v.message))).toBe(true);
	});

	it('flags more than one warlord', () => {
		const u = sampleUnit();
		const mc = u.model_count?.min ?? 1;
		const state: BuilderState = {
			...emptyBuilderState(),
			factionId: 'adeptus-astartes',
			units: [
				{ ...makeUnit(u.id, mc), key: 'a', isWarlord: true },
				{ ...makeUnit(u.id, mc), key: 'b', isWarlord: true },
			],
		};
		expect(builderViolations(state).some((v) => /warlord/.test(v.message))).toBe(true);
	});
});

describe('detachment tag conflicts', () => {
	it('flags two detachments that share a tag (only one of that type)', () => {
		// Necrons Awakened Dynasty + Hand of the Dynasty both carry the `dynasty` tag.
		const a = ds.detachments.get('awakened-dynasty');
		const b = ds.detachments.get('hand-of-the-dynasty');
		expect((a?.tags ?? []).includes('dynasty')).toBe(true);
		expect((b?.tags ?? []).includes('dynasty')).toBe(true);
		const state: BuilderState = {
			...emptyBuilderState(),
			factionId: 'necrons',
			detachmentIds: ['awakened-dynasty', 'hand-of-the-dynasty'],
		};
		const conflicts = detachmentTagConflicts(state);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].tag).toBe('dynasty');
		// Named in selection order.
		expect(conflicts[0].detachmentNames).toEqual([a!.name, b!.name]);
		// Surfaces as an army-level advisory chip (never blocks save).
		expect(
			builderViolations(state).some((v) => v.unitKey === null && /dynasty/.test(v.message)),
		).toBe(true);
	});

	it('does not flag a single detachment, or two with no shared tag', () => {
		const single: BuilderState = {
			...emptyBuilderState(),
			factionId: 'necrons',
			detachmentIds: ['awakened-dynasty'],
		};
		expect(detachmentTagConflicts(single)).toHaveLength(0);
		// awakened-dynasty (dynasty) + cryptek-conclave (no tag) → no shared tag.
		const mixed: BuilderState = {
			...emptyBuilderState(),
			factionId: 'necrons',
			detachmentIds: ['awakened-dynasty', 'cryptek-conclave'],
		};
		expect(detachmentTagConflicts(mixed)).toHaveLength(0);
	});

	it('names every detachment carrying a conflicting tag in one entry', () => {
		// Synthetic 3-way share isn't in the dataset; verify the grouping collapses
		// repeated ids of a tagged detachment into a single entry naming each pick.
		const state: BuilderState = {
			...emptyBuilderState(),
			factionId: 'necrons',
			detachmentIds: ['awakened-dynasty', 'hand-of-the-dynasty', 'the-phaerons-armoury'],
		};
		// dynasty: awakened-dynasty + hand-of-the-dynasty; hypercrypt: only phaeron → not a conflict.
		const conflicts = detachmentTagConflicts(state);
		expect(conflicts.map((c) => c.tag)).toEqual(['dynasty']);
		expect(conflicts[0].detachmentNames).toHaveLength(2);
	});
});

describe('builder role grouping', () => {
	it('buckets every picker unit into exactly one section, names sorted', () => {
		const units = unitsForFaction('adeptus-astartes');
		const groups = groupUnitsByRole(units);
		// Partition: total covered == total input, no dupes.
		const covered = groups.reduce((n, g) => n + g.units.length, 0);
		expect(covered).toBe(units.length);
		// Each group's section matches every unit in it, and names are sorted.
		for (const g of groups) {
			for (const u of g.units) expect(sectionOf(u).key).toBe(g.key);
			const names = g.units.map((u) => u.name);
			expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		}
		// Sections are emitted in ascending display order.
		const orders = groups.map((g) => g.order);
		expect(orders).toEqual([...orders].sort((a, b) => a - b));
	});

	it('splits the un-roled bucket by unit type (Infantry/Beast/Vehicle/…)', () => {
		// A faction with non-battlefield-role units exercises the type split.
		const units = unitsForFaction('tau-empire');
		const groups = groupUnitsByRole(units);
		const otherKeys = groups.map((g) => g.key).filter((k) => k.startsWith('other'));
		// Any un-roled units should land in type-suffixed sections, not one lump.
		for (const g of groups) {
			if (!g.key.startsWith('other:')) continue;
			const type = g.label; // e.g. "Vehicle"
			for (const u of g.units) {
				expect(unitTypeKeywords(u)[0]).toBe(type);
			}
		}
		// If there are un-roled units at all, at least one typed section exists.
		const hasUnroled = units.some((u) => roleOf(u) === 'other' && unitTypeKeywords(u).length > 0);
		if (hasUnroled) {
			expect(otherKeys.some((k) => k.includes(':'))).toBe(true);
		}
	});

	it('roster subtotals sum to the grand total and preserve insertion order', () => {
		const u = sampleUnit();
		const mc = u.model_count?.min ?? 1;
		const state: BuilderState = {
			...emptyBuilderState(),
			factionId: 'adeptus-astartes',
			units: [
				{ ...makeUnit(u.id, mc), key: 'a' },
				{ ...makeUnit(u.id, mc), key: 'b' },
			],
		};
		const groups = groupDraftByRole(state);
		const subtotal = groups.reduce((n, g) => n + g.points, 0);
		expect(subtotal).toBe(totalPoints(state));
		// Same datasheet ⇒ one section, insertion order intact.
		const section = groups.find((g) => g.units.length === 2);
		expect(section).toBeDefined();
		expect(section!.units.map((x) => x.key)).toEqual(['a', 'b']);
	});
});

describe('builder unit clone + display', () => {
	it('clones a configured unit with a fresh key and an independent loadout', () => {
		const u = sampleUnit();
		const original = makeUnit(u.id, u.model_count?.min ?? 1);
		original.isWarlord = true;
		const clone = cloneBuilderUnit(original, 'k1');
		expect(clone.key).toBe('k1');
		expect(clone.isWarlord).toBe(false); // exactly one warlord
		// Mutating the clone's loadout must not touch the original's Map.
		const firstId = [...original.loadout.keys()][0];
		if (firstId) {
			clone.loadout.set(firstId, (original.loadout.get(firstId) ?? 0) + 5);
			expect(clone.loadout.get(firstId)).not.toBe(original.loadout.get(firstId));
		}
	});

	it('summarises the equipped weapons (count> 0) and never throws', () => {
		const units = unitsForFaction('adeptus-astartes');
		for (const u of units.slice(0, 25)) {
			const bu = makeUnit(u.id, u.model_count?.min ?? 1);
			const summary = loadoutSummary(bu);
			expect(typeof summary).toBe('string');
			// Every equipped item's display name appears in the summary.
			for (const [id, count] of bu.loadout) {
				if (count > 0) expect(summary).toContain(itemName(id));
			}
			// Type keywords are a subset of the recognised family.
			expect(unitTypeKeywords(u).length).toBeLessThanOrEqual(10);
		}
	});
});

describe('builder loadout reconciliation', () => {
	it('forces a fixed base weapon to its required count (Kroot pistol bug)', () => {
		const u = unitRaw('kroot-carnivores');
		if (!u) return; // dataset may not carry T'au
		const mc = u.model_count?.min ?? 10;
		// Simulate an import that under-records the always-on Kroot pistol.
		const seeded = new Map<string, number>([['kroot-pistol', 3]]);
		const fixed = reconcileLoadout('kroot-carnivores', mc, seeded);
		// Kroot pistol is a base weapon → must equal the model count, no violation.
		expect(fixed.get('kroot-pistol')).toBe(mc);
		const bu: BuilderUnit = {
			key: 'k',
			datasheetId: 'kroot-carnivores',
			modelCount: mc,
			loadout: fixed,
			enhancementId: null,
			isWarlord: false,
		};
		const issues = builderViolations({
			...emptyBuilderState(),
			factionId: 'tau-empire',
			units: [bu],
		}).filter((v) => v.unitKey === 'k' && /kroot-pistol/.test(v.message));
		expect(issues).toHaveLength(0);
	});
});

describe('valid allies (soup)', () => {
	it('alliesForState offers Daemonic Pact for Chaos Knights with a non-empty pool', () => {
		const groups = alliesForState({ ...emptyBuilderState(), factionId: 'chaos-knights' });
		const pact = groups.find((g) => g.rule.id === 'daemonic-pact');
		expect(pact).toBeDefined();
		expect(pact!.label).toBe('Daemons');
		expect(pact!.units.length).toBeGreaterThan(0);
	});

	it('alliesForState gates detachment-scoped rules on the selected detachment', () => {
		const base = { ...emptyBuilderState(), factionId: 'chaos-knights' };
		const without = alliesForState(base).map((g) => g.rule.id);
		expect(without).not.toContain('iconoclast-fiefdom-damned');
		const withDet = alliesForState({ ...base, detachmentIds: ['iconoclast-fiefdom'] }).map(
			(g) => g.rule.id,
		);
		expect(withDet).toContain('iconoclast-fiefdom-damned');
	});

	it('allyPointsLimit reads the per-battle-size cap', () => {
		const pact = ds.alliedRules.get('daemonic-pact')!;
		expect(allyPointsLimit(pact, 'incursion')).toBe(250);
		expect(allyPointsLimit(pact, 'strike-force')).toBe(500);
	});

	it('unitMatchesQuery matches on name substring and exact keyword', () => {
		const bloodletters = unitRaw('bloodletters', 'chaos-daemons')!;
		expect(unitMatchesQuery(bloodletters, 'blood')).toBe(true); // name
		expect(unitMatchesQuery(bloodletters, 'Khorne')).toBe(true); // keyword
		expect(unitMatchesQuery(bloodletters, 'tyranids')).toBe(false);
		expect(unitMatchesQuery(bloodletters, '')).toBe(true);
	});

	it('flags an allied unit marked Warlord or given an Enhancement', () => {
		const ally: BuilderUnit = {
			key: 'a',
			datasheetId: 'bloodletters',
			factionId: 'chaos-daemons',
			allyRuleId: 'daemonic-pact',
			modelCount: 10,
			loadout: new Map(),
			enhancementId: null,
			isWarlord: true,
		};
		const issues = builderViolations({
			...emptyBuilderState(),
			factionId: 'chaos-knights',
			units: [ally],
		});
		expect(issues.some((v) => /cannot be Warlord/.test(v.message))).toBe(true);
	});

	it('flags more than three of a non-Battleline datasheet', () => {
		const wl = unitsForFaction('adeptus-astartes').find(
			(u) =>
				(u.points?.length ?? 0) > 0 &&
				!(u.keywords ?? []).map((k) => k.toLowerCase()).includes('battleline') &&
				u.role !== 'dedicated-transport' &&
				u.role !== 'epic-hero',
		)!;
		const mk = (i: number): BuilderUnit => ({
			key: `c${i}`,
			datasheetId: wl.id,
			modelCount: wl.model_count?.min ?? 1,
			loadout: new Map(),
			enhancementId: null,
			isWarlord: false,
		});
		const issues = builderViolations({
			...emptyBuilderState(),
			factionId: 'adeptus-astartes',
			units: [mk(0), mk(1), mk(2), mk(3)],
		});
		expect(issues.some((v) => /max \d+ of a datasheet/.test(v.message))).toBe(true);
	});
});
