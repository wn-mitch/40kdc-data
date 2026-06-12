/**
 * Doubles-team logic: per-army points banding through the override, the
 * team-level muster checks (cross-army epic heroes / enhancements, one team
 * warlord, one recorded disposition), unified-vs-convenience, and the
 * composed `#dbl=` share fragment (two unchanged share-v1 tokens + meta).
 * Runs in node against the embedded dataset twin.
 */
import { describe, it, expect } from 'vitest';
import { ds } from './dataset';
import {
	builderStateToShareList,
	defaultLoadout,
	detachmentPointCap,
	effectiveBattleSize,
	emptyBuilderState,
	pointsLimit,
	unitRaw,
	unitsForFaction,
	type BuilderState,
	type BuilderUnit,
} from './builder';
import {
	armyAt,
	decodeDoublesShare,
	doublesToSolo,
	emptyDoublesDraft,
	encodeDoublesShare,
	forceKind,
	soloToDoubles,
	teamDispositionOptions,
	teamViolations,
	withPointsPerPlayer,
	type DoublesDraft,
} from './doubles';
import { encodeShareToken } from '@alpaca-software/40kdc-data';

let keyCounter = 0;
function makeUnit(datasheetId: string, over: Partial<BuilderUnit> = {}): BuilderUnit {
	const raw = unitRaw(datasheetId)!;
	const modelCount = raw.model_count?.min ?? 1;
	return {
		key: `t${keyCounter++}`,
		datasheetId,
		modelCount,
		loadout: defaultLoadout(raw, modelCount),
		enhancementId: null,
		isWarlord: false,
		...over,
	};
}

function army(over: Partial<BuilderState>): BuilderState {
	return { ...emptyBuilderState(), factionId: 'adeptus-astartes', ...over };
}

function draft(a: Partial<BuilderState>, b: Partial<BuilderState>, p = 1000): DoublesDraft {
	return {
		teamName: 'T',
		pointsPerPlayer: p,
		armies: [armyAt(army(a), p), armyAt(army(b), p)],
		teamDisposition: { side: 0, id: 'take-and-hold' },
	};
}

const epicHero = () => {
	const u = unitsForFaction('adeptus-astartes').find((x) => x.role === 'epic-hero');
	if (!u) throw new Error('no SM epic hero');
	return u;
};
const character = () => {
	const u = unitsForFaction('adeptus-astartes').find(
		(x) => x.role !== 'epic-hero' && (x.keywords ?? []).includes('Character'),
	);
	if (!u) throw new Error('no SM character');
	return u;
};

describe('points override banding', () => {
	it('pointsLimit honours the override; effectiveBattleSize bands it', () => {
		for (const p of [500, 750, 1000]) {
			const a = armyAt(army({}), p);
			expect(pointsLimit(a)).toBe(p);
			expect(effectiveBattleSize(a)).toBe('incursion');
			expect(detachmentPointCap(a)).toBe(2);
		}
		const big = armyAt(army({}), 1500);
		expect(effectiveBattleSize(big)).toBe('strike-force');
		expect(detachmentPointCap(big)).toBe(3);
		// Solo passthrough.
		const solo = army({ battleSize: 'strike-force' });
		expect(pointsLimit(solo)).toBe(2000);
		expect(effectiveBattleSize(solo)).toBe('strike-force');
	});

	it('withPointsPerPlayer re-pins both armies', () => {
		const d = withPointsPerPlayer(draft({}, {}), 750);
		expect(d.pointsPerPlayer).toBe(750);
		expect(d.armies.map(pointsLimit)).toEqual([750, 750]);
	});
});

describe('solo ⇄ doubles conversion', () => {
	it('soloToDoubles keeps the draft as Army A and carries its disposition', () => {
		const solo = army({ name: 'Fists', disposition: 'disruption' });
		const d = soloToDoubles(solo, 750);
		expect(d.armies[0].name).toBe('Fists');
		expect(pointsLimit(d.armies[0])).toBe(750);
		expect(d.armies[1].units).toEqual([]);
		expect(d.teamDisposition).toEqual({ side: 0, id: 'disruption' });
	});

	it('doublesToSolo drops the override', () => {
		const solo = doublesToSolo(draft({ name: 'A' }, {}));
		expect(solo.name).toBe('A');
		expect(solo.pointsLimitOverride).toBeUndefined();
		expect(pointsLimit(solo)).toBe(2000);
	});
});

describe('teamViolations', () => {
	it('flags an Epic Hero present in both armies', () => {
		const hero = epicHero();
		const d = draft({ units: [makeUnit(hero.id, { isWarlord: true })] }, { units: [makeUnit(hero.id)] });
		const messages = teamViolations(d).map((v) => v.message);
		expect(messages.some((m) => m.includes(hero.name) && m.includes('both armies'))).toBe(true);
	});

	it('flags an Enhancement used in both armies, but not within one', () => {
		const enh = 'artificer-armour';
		const c = character();
		const both = draft(
			{ units: [makeUnit(c.id, { enhancementId: enh, isWarlord: true })] },
			{ units: [makeUnit(c.id, { enhancementId: enh })] },
		);
		expect(teamViolations(both).some((v) => v.message.includes('both armies') && v.message.includes('Enhancement'))).toBe(true);

		const oneSide = draft(
			{ units: [makeUnit(c.id, { enhancementId: enh, isWarlord: true }), makeUnit(c.id, { enhancementId: enh })] },
			{ units: [makeUnit(c.id)] },
		);
		// Within-army duplication is the per-army checker's business, not the team's.
		expect(oneSide.armies[0].units).toHaveLength(2);
		expect(teamViolations(oneSide).some((v) => v.message.includes('Enhancement'))).toBe(false);
	});

	it('warlord count: zero is an info note, one is clean, two warns', () => {
		const c = character();
		const zero = draft({ units: [makeUnit(c.id)] }, { units: [makeUnit(c.id)] });
		const zeroV = teamViolations(zero).filter((v) => v.message.includes('Warlord') || v.message.includes('warlord'));
		expect(zeroV).toHaveLength(1);
		expect(zeroV[0].severity).toBe('info');

		const one = draft({ units: [makeUnit(c.id, { isWarlord: true })] }, { units: [makeUnit(c.id)] });
		expect(teamViolations(one).some((v) => (v.message.includes('warlord') || v.message.includes('Warlord')) && v.severity !== 'info')).toBe(false);

		const two = draft(
			{ units: [makeUnit(c.id, { isWarlord: true })] },
			{ units: [makeUnit(c.id, { isWarlord: true })] },
		);
		const twoV = teamViolations(two).filter((v) => v.message.includes('warlords'));
		expect(twoV).toHaveLength(1);
		expect(twoV[0].severity).not.toBe('info');
	});

	it('missing team disposition is an info note', () => {
		const d = { ...draft({}, {}), teamDisposition: null };
		const v = teamViolations(d).find((x) => x.message.includes('Force Disposition'));
		expect(v?.severity).toBe('info');
	});
});

describe('forceKind', () => {
	it('same faction and Astartes chapters are unified; cross-faction is convenience', () => {
		expect(forceKind('adeptus-astartes', 'adeptus-astartes')).toBe('unified');
		expect(forceKind('crimson-fists', 'imperial-fists')).toBe('unified');
		expect(forceKind('crimson-fists', 'adeptus-astartes')).toBe('unified');
		expect(forceKind('adeptus-astartes', 'tyranids')).toBe('convenience');
		expect(forceKind('world-eaters', 'chaos-daemons')).toBe('convenience');
		expect(forceKind(null, 'tyranids')).toBeNull();
	});
});

describe('teamDispositionOptions', () => {
	it('offers each army its detachment-granted set, or all five', () => {
		const d = draft({ detachmentIds: ['gladius-task-force'] }, {});
		const opts = teamDispositionOptions(d);
		const sideA = opts.filter((o) => o.side === 0);
		const sideB = opts.filter((o) => o.side === 1);
		// gladius grants priority-assets only.
		expect(sideA.map((o) => o.id)).toEqual(['priority-assets']);
		expect(sideA[0].label).toContain('Army A');
		expect(sideB.length).toBe(ds.forceDispositions.all.length);
	});
});

describe('doubles share fragment', () => {
	it('round-trips a full team', () => {
		const hero = epicHero();
		const c = character();
		const d = draft(
			{ name: 'Alpha', detachmentIds: ['gladius-task-force'], units: [makeUnit(hero.id, { isWarlord: true })] },
			{ name: 'Beta', units: [makeUnit(c.id, { enhancementId: 'artificer-armour' })] },
			750,
		);
		const decoded = decodeDoublesShare(encodeDoublesShare(d));
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(decoded.draft.teamName).toBe('T');
		expect(decoded.draft.pointsPerPlayer).toBe(750);
		expect(decoded.draft.teamDisposition).toEqual({ side: 0, id: 'take-and-hold' });
		expect(decoded.draft.armies[0].name).toBe('Alpha');
		expect(decoded.draft.armies[0].detachmentIds).toEqual(['gladius-task-force']);
		expect(decoded.draft.armies[0].units[0].isWarlord).toBe(true);
		expect(decoded.draft.armies[1].units[0].enhancementId).toBe('artificer-armour');
		expect(decoded.draft.armies.map(pointsLimit)).toEqual([750, 750]);
	});

	it('the embedded army tokens are byte-identical to solo share tokens', () => {
		const d = draft({ name: 'Alpha' }, { name: 'Beta' });
		const [, tokenA, tokenB] = encodeDoublesShare(d).split('.');
		expect(tokenA).toBe(encodeShareToken(builderStateToShareList(d.armies[0])));
		expect(tokenB).toBe(encodeShareToken(builderStateToShareList(d.armies[1])));
	});

	it('rejects malformed and future-versioned fragments', () => {
		expect(decodeDoublesShare('garbage')).toEqual({ ok: false, reason: 'malformed' });
		expect(decodeDoublesShare('a.b.c').ok).toBe(false);
		const future = encodeDoublesShare(emptyDoublesDraft()).replace(/^[^.]+/, btoa('{"v":9}').replace(/=+$/, ''));
		expect(decodeDoublesShare(future)).toEqual({ ok: false, reason: 'unsupported-version' });
	});
});
