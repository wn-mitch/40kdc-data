<script lang="ts">
import {
	unitRaw,
	unitPoints,
	eligibleEnhancements,
	defaultLoadout,
	builderViolations,
	builderUnitToDatacardData,
	type BuilderState,
	type BuilderUnit,
} from '$lib/data/builder';
import WargearEditor from './WargearEditor.svelte';
import Datacard from '../Datacard.svelte';

interface Props {
	/** The roster-selected unit, or null when nothing is selected. */
	unit: BuilderUnit | null;
	draft: BuilderState;
	onchange: (next: BuilderUnit) => void;
	onwarlord: () => void;
}
let { unit, draft, onchange, onwarlord }: Props = $props();

const raw = $derived(unit ? unitRaw(unit.datasheetId) : undefined);
const enhancements = $derived(unit ? eligibleEnhancements(draft.detachmentIds, raw) : []);
const points = $derived(unit ? unitPoints(unit) : 0);
const modelRange = $derived(raw?.model_count ?? null);
const issues = $derived(
	unit
		? builderViolations(draft)
				.filter((v) => v.unitKey === unit.key)
				.map((v) => v.message)
		: [],
);

function setModelCount(n: number) {
	if (!unit || !raw) return;
	const min = modelRange?.min ?? 1;
	const next = Math.max(min, n);
	// Re-derive the maximal loadout at the new count so options stay in range.
	onchange({ ...unit, modelCount: next, loadout: defaultLoadout(raw, next) });
}
</script>

<div class="flex h-full flex-col">
	{#if !unit}
		<p class="text-text-dim m-auto px-3 text-center text-xs italic">
			Select a unit to edit its models, wargear, and enhancement.
		</p>
	{:else}
		<!-- Header: name + live points. -->
		<div class="mb-2 flex items-baseline gap-2">
			<h3 class="text-text flex-1 text-sm font-semibold">{raw?.name ?? unit.datasheetId}</h3>
			<span class="text-text-dim shrink-0 tabular-nums text-xs">{points} pts</span>
		</div>

		<div class="flex flex-col gap-2 overflow-y-auto">
			<!-- Model count -->
			<div class="flex items-center gap-2 text-[11px]">
				<span class="text-text-dim uppercase tracking-wider">Models</span>
				<button
					class="text-text-dim hover:text-text disabled:opacity-30 px-1.5 leading-none"
					disabled={unit.modelCount <= (modelRange?.min ?? 1)}
					onclick={() => setModelCount(unit.modelCount - 1)}
					aria-label="fewer models">−</button
				>
				<span class="w-6 text-center tabular-nums">{unit.modelCount}</span>
				<button
					class="text-text-dim hover:text-text px-1.5 leading-none"
					onclick={() => setModelCount(unit.modelCount + 1)}
					aria-label="more models">+</button
				>
				{#if modelRange}<span class="text-text-dim/50">({modelRange.min}–{modelRange.max})</span>{/if}
			</div>

			{#if issues.length > 0}
				<div class="flex flex-wrap gap-1">
					{#each issues as msg (msg)}
						<span class="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">{msg}</span
						>
					{/each}
				</div>
			{/if}

			<!-- Enhancement (characters under a detachment only) -->
			{#if enhancements.length > 0}
				<label class="text-text-dim flex flex-col gap-1 text-[11px] uppercase tracking-wider">
					Enhancement
					<select
						class="bg-panel border-panel-border text-text rounded border px-1.5 py-1 text-[11px] normal-case"
						value={unit.enhancementId ?? ''}
						onchange={(e) =>
							onchange({ ...unit, enhancementId: (e.target as HTMLSelectElement).value || null })}
					>
						<option value="">— none —</option>
						{#each enhancements as enh (enh.id)}
							<option value={enh.id}>{enh.name} ({enh.cost} pts)</option>
						{/each}
					</select>
				</label>
			{/if}

			<!-- Warlord -->
			<label class="text-text-dim flex items-center gap-1.5 text-[11px]">
				<input type="radio" name="warlord" checked={unit.isWarlord} onchange={onwarlord} />
				Warlord
			</label>

			<!-- Wargear / loadout -->
			<div class="border-panel-border/50 border-t pt-2">
				<div class="text-text-dim mb-1 text-[10px] font-semibold uppercase tracking-wider">
					Wargear
				</div>
				<WargearEditor {unit} onchange={(loadout) => onchange({ ...unit, loadout })} />
			</div>

			<!-- Live datacard for the selected unit (reflects the equipped loadout). -->
			<div class="border-panel-border/50 border-t pt-1">
				<Datacard data={builderUnitToDatacardData(unit)} />
			</div>
		</div>
	{/if}
</div>
