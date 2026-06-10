<script lang="ts">
import {
	unitsForFaction,
	baseUnitPoints,
	groupUnitsByRole,
	unitTypeKeywords,
	unitMatchesQuery,
	alliesForState,
	allyPointsLimit,
	type BuilderState,
} from '$lib/data/builder';
import type { Unit } from '@alpaca-software/40kdc-data';

interface Props {
	draft: BuilderState;
	/** Add a unit; allied units carry their source faction + the rule they enter under. */
	onadd: (datasheetId: string, factionId?: string, allyRuleId?: string) => void;
}
let { draft, onadd }: Props = $props();

let query = $state('');
/** Active unit-type facet (Infantry/Vehicle/…); null = no type filter. */
let facet = $state<string | null>(null);
/** Per-section collapse state (section id → collapsed?). */
let collapsed = $state<Record<string, boolean>>({});

const units = $derived(unitsForFaction(draft.factionId));
const facets = $derived([...new Set(units.flatMap((u) => unitTypeKeywords(u)))].sort());

/** Name-or-keyword search (so "Khorne" surfaces all Khorne units) + type facet. */
function matches(u: Unit): boolean {
	if (!unitMatchesQuery(u, query)) return false;
	if (facet && !unitTypeKeywords(u).includes(facet)) return false;
	return true;
}

const filtered = $derived(units.filter(matches));
const groups = $derived(groupUnitsByRole(filtered));

/** Ally pools for the chosen faction + detachments, each filtered by the query. */
const allyGroups = $derived(
	alliesForState(draft)
		.map((g) => ({ ...g, units: g.units.filter(matches) }))
		.filter((g) => g.units.length > 0),
);

/** Cheapest tier, for an at-a-glance cost in the picker. */
function fromPoints(u: Unit): number {
	const tiers = u.points ?? [];
	if (tiers.length === 0) return 0;
	return Math.min(...tiers.map((t) => baseUnitPoints(u, t.models)));
}

function toggle(key: string) {
	collapsed = { ...collapsed, [key]: !collapsed[key] };
}
</script>

<div class="flex h-full flex-col">
	<input
		type="text"
		class="bg-panel border-panel-border text-text mb-1.5 w-full rounded border px-2 py-1 text-xs"
		placeholder={draft.factionId ? 'Search units or keywords…' : 'Pick a faction first'}
		disabled={!draft.factionId}
		bind:value={query}
	/>

	{#if draft.factionId && facets.length > 0}
		<!-- Unit-type facet chips (Infantry/Vehicle/…). Toggle to filter; click again to clear. -->
		<div class="mb-1.5 flex flex-wrap gap-1">
			{#each facets as f (f)}
				<button
					class="rounded border px-1.5 py-0.5 text-[10px] transition-colors {facet === f
						? 'border-accent bg-accent/15 text-accent'
						: 'border-panel-border text-text-dim hover:text-text'}"
					aria-pressed={facet === f}
					onclick={() => (facet = facet === f ? null : f)}>{f}</button
				>
			{/each}
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !draft.factionId}
			<p class="text-text-dim px-1 py-2 text-xs italic">Choose a faction to list its units.</p>
		{:else if filtered.length === 0 && allyGroups.length === 0}
			<p class="text-text-dim px-1 py-2 text-xs italic">
				No units match{query.trim() ? ` “${query.trim()}”` : ''}{facet ? ` · ${facet}` : ''}.
			</p>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each groups as group (group.key)}
					<div>
						<button
							class="text-text-dim hover:text-text flex w-full items-center gap-1 px-0.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
							onclick={() => toggle(group.key)}
							aria-expanded={!collapsed[group.key]}
						>
							<span class="w-2 text-center">{collapsed[group.key] ? '▸' : '▾'}</span>
							<span class="flex-1 text-left">{group.label}</span>
							<span class="text-text-dim/60 tabular-nums">{group.units.length}</span>
						</button>
						{#if !collapsed[group.key]}
							<ul class="flex flex-col gap-0.5 pl-1">
								{#each group.units as u (u.id)}
									<li>
										<button
											class="hover:bg-panel-hover flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
											onclick={() => onadd(u.id)}
										>
											<span class="text-text flex-1 truncate text-xs">{u.name}</span>
											<span class="text-text-dim shrink-0 tabular-nums text-[11px]">{fromPoints(u)}+</span>
											<span class="text-accent shrink-0 text-xs">＋</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}

				<!-- Valid allies ("soup") pools — units from other factions a rule grants. -->
				{#each allyGroups as group (group.rule.id)}
					{@const cap = allyPointsLimit(group.rule, draft.battleSize)}
					<div class="mt-1 border-t border-dashed border-amber-500/25 pt-1">
						<button
							class="flex w-full items-center gap-1 px-0.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80 hover:text-amber-200"
							onclick={() => toggle(`ally:${group.rule.id}`)}
							aria-expanded={!collapsed[`ally:${group.rule.id}`]}
						>
							<span class="w-2 text-center">{collapsed[`ally:${group.rule.id}`] ? '▸' : '▾'}</span>
							<span class="flex-1 text-left">Allies · {group.label}</span>
							{#if cap != null}
								<span class="text-amber-300/50 normal-case tabular-nums">≤{cap} pts</span>
							{/if}
							<span class="text-amber-300/50 tabular-nums">{group.units.length}</span>
						</button>
						{#if !collapsed[`ally:${group.rule.id}`]}
							<ul class="flex flex-col gap-0.5 pl-1">
								{#each group.units as u (`${u.faction_id}:${u.id}`)}
									<li>
										<button
											class="hover:bg-panel-hover flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
											onclick={() => onadd(u.id, u.faction_id, group.rule.id)}
										>
											<span class="text-text flex-1 truncate text-xs">{u.name}</span>
											<span class="text-text-dim shrink-0 tabular-nums text-[11px]">{fromPoints(u)}+</span>
											<span class="text-accent shrink-0 text-xs">＋</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
