<script lang="ts">
import { totalPoints, pointsLimit, type BuilderState } from '$lib/data/builder';
import {
	DOUBLES_POINTS_PRESETS,
	doublesToSolo,
	encodeDoublesShare,
	forceKind,
	teamDispositionOptions,
	teamViolations,
	withPointsPerPlayer,
	armyAt,
	type DoublesDraft,
	type DoublesSide,
} from '$lib/data/doubles';
import ArmyBuilder from './ArmyBuilder.svelte';

/**
 * The Doubles team workspace: a team header (name, per-player points level,
 * the team's single Force Disposition, unified/convenience chip, team-level
 * advisory strip) over two tabbed army editors. Each tab is the ordinary
 * `ArmyBuilder` in embedded mode — the full per-army machinery (pickers,
 * loadouts, per-army violations) is reused unchanged; this component only
 * owns what the Doubles Companion adds at team level.
 */
interface Props {
	initial: DoublesDraft;
	onsave: (draft: DoublesDraft) => void;
	oncancel: () => void;
	/** Doubles toggle off — back to a solo build of Army A. */
	onsolo: (army: BuilderState) => void;
	onflash?: (msg: string) => void;
}
let { initial, onsave, oncancel, onsolo, onflash }: Props = $props();

function cloneArmy(s: BuilderState): BuilderState {
	return { ...s, units: s.units.map((u) => ({ ...u, loadout: new Map(u.loadout) })) };
}
// Mount-time snapshot by design (the same seeding pattern as ArmyBuilder):
// the workspace owns its working copy and the host remounts to re-seed.
// svelte-ignore state_referenced_locally
let team = $state<DoublesDraft>({
	...initial,
	armies: [cloneArmy(initial.armies[0]), cloneArmy(initial.armies[1])],
});
let tab = $state<DoublesSide>(0);
/** Custom points entry visibility (presets cover most events). */
// svelte-ignore state_referenced_locally
let customPoints = $state(!DOUBLES_POINTS_PRESETS.includes(team.pointsPerPlayer as 500));

const kind = $derived(forceKind(team.armies[0].factionId, team.armies[1].factionId));
const issues = $derived(teamViolations(team));
const dispositionOptions = $derived(teamDispositionOptions(team));
const teamTotal = $derived(team.armies.reduce((s, a) => s + totalPoints(a), 0));
const teamLimit = $derived(team.armies.reduce((s, a) => s + pointsLimit(a), 0));

/** Mirror every army edit back into the team draft (the active tab's
 *  ArmyBuilder owns its own working state and reports through this tap). */
function captureArmy(side: DoublesSide, draft: BuilderState): void {
	const next: [BuilderState, BuilderState] = [...team.armies];
	next[side] = armyAt(draft, team.pointsPerPlayer);
	team = { ...team, armies: next };
}

function setPoints(p: number): void {
	if (!Number.isFinite(p) || p <= 0) return;
	team = withPointsPerPlayer(team, Math.round(p));
}

function toggleOff(): void {
	if (team.armies[1].units.length > 0 && !confirm('Leave Doubles mode? Army B will be discarded.')) {
		return;
	}
	onsolo(doublesToSolo(team));
}

const dispositionValue = $derived(
	team.teamDisposition ? `${team.teamDisposition.side}|${team.teamDisposition.id}` : '',
);
function setTeamDisposition(value: string): void {
	if (!value) {
		team = { ...team, teamDisposition: null };
		return;
	}
	const [side, id] = value.split('|');
	team = { ...team, teamDisposition: { side: Number(side) as DoublesSide, id } };
}

async function copyShareLink(): Promise<void> {
	const url = `${location.origin}${location.pathname}#dbl=${encodeDoublesShare(team)}`;
	try {
		await navigator.clipboard.writeText(url);
		onflash?.('Doubles share link copied to clipboard.');
	} catch {
		history.replaceState(null, '', url);
		onflash?.("Couldn't reach the clipboard — link is in the address bar.");
	}
}
</script>

<div class="flex h-full flex-col gap-2">
	<!-- Team header -->
	<div class="flex shrink-0 flex-wrap items-end gap-2">
		<label class="flex flex-col text-xs uppercase tracking-wider text-text-muted">
			Team name
			<input
				type="text"
				class="bg-panel border-panel-border text-text mt-0.5 w-44 rounded border px-2 py-1 text-sm normal-case"
				placeholder="Our team"
				bind:value={team.teamName}
			/>
		</label>
		<label
			class="border-panel-border bg-panel flex items-center gap-1.5 self-end rounded border px-2 py-1.5 text-xs uppercase tracking-wider text-text-muted"
			title="Back to a solo list (keeps Army A)"
		>
			<input type="checkbox" checked onchange={toggleOff} />
			Doubles
		</label>
		<label class="flex flex-col text-xs uppercase tracking-wider text-text-muted">
			Points / player
			<div class="mt-0.5 flex items-center gap-1">
				<select
					class="bg-panel border-panel-border text-text rounded border px-1.5 py-1 text-sm"
					value={customPoints ? 'custom' : String(team.pointsPerPlayer)}
					onchange={(e) => {
						const v = (e.target as HTMLSelectElement).value;
						if (v === 'custom') {
							customPoints = true;
						} else {
							customPoints = false;
							setPoints(Number(v));
						}
					}}
				>
					{#each DOUBLES_POINTS_PRESETS as p (p)}
						<option value={String(p)}>{p} pts</option>
					{/each}
					<option value="custom">custom…</option>
				</select>
				{#if customPoints}
					<input
						type="number"
						min="1"
						step="50"
						class="bg-panel border-panel-border text-text w-20 rounded border px-1.5 py-1 text-sm"
						value={team.pointsPerPlayer}
						onchange={(e) => setPoints(Number((e.target as HTMLInputElement).value))}
					/>
				{/if}
			</div>
		</label>
		<label class="flex flex-col text-xs uppercase tracking-wider text-text-muted">
			Team disposition
			<select
				class="bg-panel border-panel-border text-text mt-0.5 rounded border px-1.5 py-1 text-sm"
				value={dispositionValue}
				onchange={(e) => setTeamDisposition((e.target as HTMLSelectElement).value)}
			>
				<option value="">— unset —</option>
				{#each dispositionOptions as opt (`${opt.side}|${opt.id}`)}
					<option value={`${opt.side}|${opt.id}`}>{opt.label}</option>
				{/each}
			</select>
		</label>
		{#if kind}
			<span
				class="border-panel-border bg-panel self-end rounded border px-2 py-1.5 text-xs uppercase tracking-wider {kind === 'unified' ? 'text-emerald-300' : 'text-sky-300'}"
				title={kind === 'unified'
					? 'Both armies share their faction keywords — one set of army rules, shared CP'
					: 'Different faction keywords — each army uses its own rules'}
			>
				{kind === 'unified' ? 'Unified force' : 'Force of convenience'}
			</span>
		{/if}
		<div class="ml-auto text-right">
			<div
				class="font-heading text-lg font-bold tabular-nums {teamTotal > teamLimit ? 'text-amber-400' : 'text-text'}"
			>
				{teamTotal} / {teamLimit}
			</div>
			<div class="text-text-muted text-xs uppercase tracking-wider">team points</div>
		</div>
	</div>

	{#if issues.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each issues as issue (issue.message)}
				<span
					class="rounded px-1.5 py-0.5 text-xs {issue.severity === 'info'
						? 'bg-sky-900/40 text-sky-200'
						: 'bg-amber-900/40 text-amber-200'}">{issue.message}</span
				>
			{/each}
		</div>
	{/if}

	<!-- Army tabs -->
	<div class="flex shrink-0 gap-1">
		{#each [0, 1] as side (side)}
			<button
				type="button"
				class="rounded-t px-3 py-1 text-xs font-semibold uppercase tracking-wider
				       {tab === side ? 'bg-panel text-text' : 'text-text-muted hover:text-text'}"
				aria-selected={tab === side}
				role="tab"
				onclick={() => (tab = side as DoublesSide)}
			>
				Army {side === 0 ? 'A' : 'B'}
				<span class="normal-case tabular-nums">
					· {totalPoints(team.armies[side])} pts
				</span>
			</button>
		{/each}
	</div>

	<!-- The active army's full builder. Keyed so switching tabs (or changing
	     the points level) remounts seeded from the captured team state. -->
	<div class="min-h-0 flex-1">
		{#key `${tab}:${team.pointsPerPlayer}`}
			<ArmyBuilder
				doubles
				initial={team.armies[tab]}
				ondraftchange={(d) => captureArmy(tab, d)}
				onsave={() => {}}
				oncancel={() => {}}
			/>
		{/key}
	</div>

	<!-- Team footer -->
	<div class="flex shrink-0 items-center justify-between">
		<button class="text-text-muted hover:text-text text-xs" onclick={oncancel}>Cancel</button>
		<div class="flex items-center gap-2">
			<button
				class="border-panel-border text-text hover:border-panel-border/80 rounded border px-3 py-1.5 text-sm font-medium transition-colors"
				onclick={copyShareLink}
			>
				Copy share link
			</button>
			<button
				class="bg-accent text-accent-foreground hover:bg-accent-hover rounded px-4 py-1.5 text-sm font-semibold transition-colors"
				onclick={() => onsave(team)}
			>
				Save to Library
			</button>
		</div>
	</div>
</div>
