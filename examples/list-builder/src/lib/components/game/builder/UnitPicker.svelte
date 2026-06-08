<script lang="ts">
import {
	unitsForFaction,
	baseUnitPoints,
	groupUnitsByRole,
	unitTypeKeywords,
	type BuilderState,
} from '$lib/data/builder';
import type { Unit } from '@alpaca-software/40kdc-data';

interface Props {
	draft: BuilderState;
	onadd: (datasheetId: string) => void;
}
let { draft, onadd }: Props = $props();

let query = $state('');
/** Active unit-type facet (Infantry/Vehicle/…); null = no type filter. */
let facet = $state<string | null>(null);
/** Per-role collapse state (role id → collapsed?). */
let collapsed = $state<Record<string, boolean>>({});

const units = $derived(unitsForFaction(draft.factionId));
const facets = $derived([...new Set(units.flatMap((u) => unitTypeKeywords(u)))].sort());
const filtered = $derived(
	units.filter((u) => {
		const q = query.trim().toLowerCase();
		if (q && !u.name.toLowerCase().includes(q)) return false;
		if (facet && !unitTypeKeywords(u).includes(facet)) return false;
		return true;
	}),
);
const groups = $derived(groupUnitsByRole(filtered));

/** Cheapest tier, for an at-a-glance cost in the picker. */
function fromPoints(u: Unit): number {
	const tiers = u.points ?? [];
	if (tiers.length === 0) return 0;
	return Math.min(...tiers.map((t) => baseUnitPoints(u, t.models)));
}

function toggleRole(role: string) {
	collapsed = { ...collapsed, [role]: !collapsed[role] };
}
</script>

<div class="flex h-full flex-col">
	<input
		type="text"
		class="bg-panel border-panel-border text-text mb-1.5 w-full rounded border px-2 py-1 text-xs"
		placeholder={draft.factionId ? 'Search units…' : 'Pick a faction first'}
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
		{:else if filtered.length === 0}
			<p class="text-text-dim px-1 py-2 text-xs italic">
				No units match{query.trim() ? ` “${query.trim()}”` : ''}{facet ? ` · ${facet}` : ''}.
			</p>
		{:else}
			<div class="flex flex-col gap-1.5">
				{#each groups as group (group.key)}
					<div>
						<button
							class="text-text-dim hover:text-text flex w-full items-center gap-1 px-0.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
							onclick={() => toggleRole(group.key)}
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
											<span class="text-text-dim shrink-0 tabular-nums text-[11px]"
												>{fromPoints(u)}+</span
											>
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
