/**
 * Warhammer Doubles support — a team of two players whose armies fight as a
 * single force. A doubles list is a pair of ordinary `BuilderState` drafts
 * plus team-level metadata; every per-army rule keeps running through the
 * existing builder machinery (each army carries a `pointsLimitOverride` for
 * the event's per-player level), and this module adds the *team-level* muster
 * checks the Doubles Event Companion layers on top:
 *
 *  - EPIC HERO units (and other once-per-army items, for which the epic-hero
 *    role is the dataset's proxy) can't appear in both armies;
 *  - an Enhancement/Upgrade may repeat within one army per its usual rules,
 *    but can't be included in both armies;
 *  - the team selects ONE CHARACTER from either army as the team's WARLORD;
 *  - the team records ONE Force Disposition, available to either army.
 *
 * Like everything in the builder, checks are advisory — reported, never
 * enforced. Share links compose two unchanged `share-v1` tokens plus a tiny
 * versioned meta segment, so the byte-pinned codec and the package `Roster`
 * are untouched.
 */

import { decodeShareToken, encodeShareToken } from '@alpaca-software/40kdc-data';
import { ds } from '$lib/data/dataset';
import {
	builderStateToShareList,
	buRaw,
	shareListToBuilderState,
	type BuilderState,
	type BuilderViolation,
	emptyBuilderState,
} from './builder';

/** Which army a team-level item belongs to / a violation points at. */
export type DoublesSide = 0 | 1;

export interface DoublesDraft {
	teamName: string;
	/** Event-chosen per-player points level (companion fixes none; 500/750/1000 common). */
	pointsPerPlayer: number;
	armies: [BuilderState, BuilderState];
	/** The team's single recorded Force Disposition, and whose card it is. */
	teamDisposition: { side: DoublesSide; id: string } | null;
}

export const DOUBLES_POINTS_PRESETS = [500, 750, 1000] as const;
export const DEFAULT_POINTS_PER_PLAYER = 1000;

/** A fresh empty doubles draft at the default points level. */
export function emptyDoublesDraft(): DoublesDraft {
	return {
		teamName: '',
		pointsPerPlayer: DEFAULT_POINTS_PER_PLAYER,
		armies: [armyAt(emptyBuilderState(), DEFAULT_POINTS_PER_PLAYER), armyAt(emptyBuilderState(), DEFAULT_POINTS_PER_PLAYER)],
		teamDisposition: null,
	};
}

/** An army draft re-pinned to the team's per-player points level. */
export function armyAt(state: BuilderState, pointsPerPlayer: number): BuilderState {
	return { ...state, pointsLimitOverride: pointsPerPlayer };
}

/** Convert the current solo draft into Army A of a doubles team. */
export function soloToDoubles(state: BuilderState, pointsPerPlayer = DEFAULT_POINTS_PER_PLAYER): DoublesDraft {
	return {
		teamName: state.name ? `${state.name} & co.` : '',
		pointsPerPlayer,
		armies: [armyAt(state, pointsPerPlayer), armyAt(emptyBuilderState(), pointsPerPlayer)],
		teamDisposition:
			state.disposition ? { side: 0, id: state.disposition } : null,
	};
}

/** Back to a solo draft: keeps Army A and drops the override. */
export function doublesToSolo(draft: DoublesDraft): BuilderState {
	const a = { ...draft.armies[0] };
	delete a.pointsLimitOverride;
	return a;
}

/** Re-pin both armies after a points-per-player change. */
export function withPointsPerPlayer(draft: DoublesDraft, pointsPerPlayer: number): DoublesDraft {
	return {
		...draft,
		pointsPerPlayer,
		armies: [armyAt(draft.armies[0], pointsPerPlayer), armyAt(draft.armies[1], pointsPerPlayer)],
	};
}

// ── Unified force / force of convenience ──────────────────────────────────────

/**
 * "Unified force" = both armies share all their faction keywords; any two
 * Adeptus Astartes chapters count (units in one army need not share the
 * Chapter keyword with the other). Approximated by the faction's keyword
 * identity — its `parent_faction_id` when it has one (successor chapters →
 * `adeptus-astartes`), else itself. Null until both factions are picked.
 * In-game effect only (shared CP, stratagem limits…), surfaced as a chip.
 */
export function forceKind(
	aFactionId: string | null,
	bFactionId: string | null,
): 'unified' | 'convenience' | null {
	if (!aFactionId || !bFactionId) return null;
	const identity = (id: string) => ds.factions.get(id)?.raw.parent_faction_id ?? id;
	return identity(aFactionId) === identity(bFactionId) ? 'unified' : 'convenience';
}

// ── Team-level muster checks ──────────────────────────────────────────────────

export interface TeamViolation extends BuilderViolation {
	/** The army the issue points at, when it isn't team-wide. */
	side: DoublesSide | null;
}

const SIDE_LABEL: Record<DoublesSide, string> = { 0: 'Army A', 1: 'Army B' };

/** The team-level advisory issues across both armies. */
export function teamViolations(draft: DoublesDraft): TeamViolation[] {
	const out: TeamViolation[] = [];
	const [a, b] = draft.armies;

	// Epic Heroes (the dataset's once-per-army proxy) can't be in both armies.
	const epicIn = (army: BuilderState) =>
		new Map(
			army.units
				.filter((u) => buRaw(u)?.role === 'epic-hero')
				.map((u) => [u.datasheetId, buRaw(u)?.name ?? u.datasheetId]),
		);
	const epicA = epicIn(a);
	for (const [id, name] of epicIn(b)) {
		if (epicA.has(id)) {
			out.push({
				side: null,
				unitKey: null,
				message: `${name} is in both armies (Epic Heroes are unique across the team)`,
			});
		}
	}

	// An Enhancement may repeat within one army per its usual rules, never in both.
	const enhIn = (army: BuilderState) =>
		new Set(army.units.flatMap((u) => (u.enhancementId ? [u.enhancementId] : [])));
	const enhA = enhIn(a);
	for (const id of enhIn(b)) {
		if (enhA.has(id)) {
			out.push({
				side: null,
				unitKey: null,
				message: `Enhancement '${ds.enhancements.get(id)?.name ?? id}' is used in both armies`,
			});
		}
	}

	// One team WARLORD, a CHARACTER from either army.
	const warlords = draft.armies.flatMap((army, side) =>
		army.units.filter((u) => u.isWarlord).map(() => side as DoublesSide),
	);
	if (warlords.length === 0) {
		out.push({
			side: null,
			unitKey: null,
			severity: 'info',
			message: 'no team Warlord yet — select one CHARACTER from either army',
		});
	} else if (warlords.length > 1) {
		out.push({
			side: null,
			unitKey: null,
			message: `${warlords.length} warlords across the team (${warlords.map((s) => SIDE_LABEL[s]).join(', ')}) — a team has one`,
		});
	}

	// One recorded Force Disposition for the whole team.
	if (!draft.teamDisposition) {
		out.push({
			side: null,
			unitKey: null,
			severity: 'info',
			message: 'no team Force Disposition recorded yet (one card, from either army)',
		});
	}

	return out;
}

/**
 * Disposition options available to the team: each army's detachment-granted
 * set (or all five when its detachments grant none), labelled by side.
 */
export function teamDispositionOptions(
	draft: DoublesDraft,
): { side: DoublesSide; id: string; label: string }[] {
	const all = ds.forceDispositions.all.map((d) => d.id);
	return draft.armies.flatMap((army, i) => {
		const side = i as DoublesSide;
		const granted = [
			...new Set(
				army.detachmentIds.flatMap((id) => ds.detachments.get(id)?.force_dispositions ?? []),
			),
		];
		const ids = granted.length > 0 ? granted : all;
		return ids.map((id) => ({
			side,
			id,
			label: `${ds.forceDispositions.get(id)?.name ?? id} (${SIDE_LABEL[side]})`,
		}));
	});
}

// ── Doubles share links ───────────────────────────────────────────────────────
//
// `#dbl=<meta>.<tokenA>.<tokenB>` — two unchanged share-v1 tokens (base64url,
// dot-free) plus a base64url JSON meta segment {v, t, p, d}. Old clients don't
// recognize the fragment and simply open the app; the codec bytes are pinned
// by conformance and untouched.

interface DoublesShareMeta {
	v: 1;
	t: string;
	p: number;
	d: { side: DoublesSide; id: string } | null;
}

function b64urlEncode(text: string): string {
	return btoa(unescape(encodeURIComponent(text)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function b64urlDecode(token: string): string | null {
	try {
		const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
		const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
		return decodeURIComponent(escape(atob(padded)));
	} catch {
		return null;
	}
}

export function encodeDoublesShare(draft: DoublesDraft): string {
	const meta: DoublesShareMeta = {
		v: 1,
		t: draft.teamName,
		p: draft.pointsPerPlayer,
		d: draft.teamDisposition,
	};
	const tokens = draft.armies.map((army) => encodeShareToken(builderStateToShareList(army)));
	return [b64urlEncode(JSON.stringify(meta)), ...tokens].join('.');
}

export type DoublesDecodeResult =
	| { ok: true; draft: DoublesDraft }
	| { ok: false; reason: 'malformed' | 'stale-registry' | 'unsupported-version' };

export function decodeDoublesShare(fragment: string): DoublesDecodeResult {
	const parts = fragment.split('.');
	if (parts.length !== 3) return { ok: false, reason: 'malformed' };
	const metaJson = b64urlDecode(parts[0]);
	if (!metaJson) return { ok: false, reason: 'malformed' };
	let meta: DoublesShareMeta;
	try {
		meta = JSON.parse(metaJson);
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (meta?.v !== 1) return { ok: false, reason: 'unsupported-version' };
	const pointsPerPlayer =
		typeof meta.p === 'number' && meta.p > 0 ? meta.p : DEFAULT_POINTS_PER_PLAYER;

	const armies: BuilderState[] = [];
	for (const token of parts.slice(1)) {
		const result = decodeShareToken(token);
		if (!result.ok) {
			return {
				ok: false,
				reason: result.reason === 'stale-registry' ? 'stale-registry' : 'malformed',
			};
		}
		armies.push(armyAt(shareListToBuilderState(result.list), pointsPerPlayer));
	}

	const teamDisposition =
		meta.d && (meta.d.side === 0 || meta.d.side === 1) && typeof meta.d.id === 'string'
			? { side: meta.d.side, id: meta.d.id }
			: null;
	return {
		ok: true,
		draft: {
			teamName: typeof meta.t === 'string' ? meta.t : '',
			pointsPerPlayer,
			armies: [armies[0], armies[1]],
			teamDisposition,
		},
	};
}
