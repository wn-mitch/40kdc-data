<script lang="ts">
  import type { TerrainLayout } from "@alpaca-software/40kdc-data";
  import LayoutDiagram from "../../../_shared/LayoutDiagram.svelte";
  import { diagramModel } from "../../../_shared/layout-geometry.js";
  import { ds } from "./data.js";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  // The matchup's three terrain layout cards. Variant tabs across the top;
  // an unauthored variant shows a terse coming-soon slot, so the section
  // doubles as the live 45-card progress indicator for this pairing.
  let {
    layouts,
    matchupLabel,
    playerFacing = $bindable(true),
  }: {
    /** Authored layouts for the current matchup, ordered by variant. */
    layouts: TerrainLayout[];
    matchupLabel: string;
    /** Rotate keystone labels to face the player whose half holds the piece. */
    playerFacing?: boolean;
  } = $props();

  const VARIANTS = [1, 2, 3] as const;

  let open = $state(true);
  let variant = $state<number>(1);

  // Snap the selected tab to the first authored variant when the MATCHUP
  // changes — and only then, so a player can still open an unauthored
  // variant's coming-soon slot by hand.
  let matchupKey = $state("");
  $effect(() => {
    const key = layouts.map((l) => l.id).join("|") || matchupLabel;
    if (key !== matchupKey) {
      matchupKey = key;
      variant = layouts[0]?.variant ?? 1;
    }
  });

  const active = $derived(layouts.find((l) => (l.variant ?? 0) === variant));
  const model = $derived(active ? diagramModel(ds, active, { playerFacing }) : null);
  const patternName = $derived(
    active?.deployment_pattern_id
      ? (ds.deploymentPatterns.get(active.deployment_pattern_id)?.name ??
          active.deployment_pattern_id)
      : null,
  );
</script>

<div class="rounded border border-border bg-surface">
  <div class="flex items-center gap-2 px-3 py-2">
    <button
      type="button"
      class="flex-1 min-w-0 text-left flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-accent"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <span class="inline-block transition-transform duration-200 {open ? 'rotate-90' : ''}">▶</span>
      Terrain
      <span class="truncate text-text-dim font-normal normal-case tracking-normal">
        — {matchupLabel} · {layouts.length} of {VARIANTS.length} layouts
      </span>
    </button>
  </div>

  {#if open}
    <div class="px-3 pb-3 flex flex-col gap-3" transition:slide={{ duration: 220, easing: quintOut }}>
      <div class="flex items-center gap-1" role="group" aria-label="Layout variant">
        {#each VARIANTS as v (v)}
          {@const authored = layouts.some((l) => (l.variant ?? 0) === v)}
          <button
            type="button"
            class="focus-ring w-11 h-11 lg:w-7 lg:h-7 rounded font-mono text-base lg:text-sm border transition-colors {v === variant
              ? 'bg-accent text-accent-foreground border-accent'
              : authored
                ? 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'
                : 'bg-panel text-text-dim border-border'}"
            aria-pressed={v === variant}
            aria-label="Layout variant {v}{authored ? '' : ' (coming soon)'}"
            onclick={() => (variant = v)}>{v}</button
          >
        {/each}
        <!-- rotate dimension labels toward each player (reads right-side-up
             from both sides of the table instead of upright on the screen) -->
        <button
          type="button"
          class="focus-ring ml-auto h-11 lg:h-7 px-2 rounded font-heading text-[10px] uppercase tracking-wide border transition-colors {playerFacing
            ? 'bg-accent text-accent-foreground border-accent'
            : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}"
          aria-pressed={playerFacing}
          title="Rotate dimension labels to face each player"
          onclick={() => (playerFacing = !playerFacing)}>Face players</button
        >
      </div>

      {#if active && model}
        <div class="flex flex-col gap-2">
          <div class="flex items-baseline justify-between gap-2 flex-wrap">
            <span class="font-heading text-sm font-bold uppercase tracking-wide text-text">{active.name}</span>
            <span class="font-heading text-[10px] uppercase tracking-wide text-text-dim">
              {#if patternName}{patternName}{/if}{#if active.source}{patternName ? " · " : ""}{active.source}{/if}
            </span>
          </div>
          <div class="max-w-100 mx-auto w-full">
            <LayoutDiagram
              pieces={model.pieces}
              zones={model.zones}
              divider={model.divider}
              markers={model.markers}
              guides={model.guides}
            />
          </div>
          <p class="m-0 text-[11px] leading-snug text-text-dim">
            Dimensions run from the board edge to the marked corner; place with a tape measure.
          </p>
        </div>
      {:else}
        <div class="rounded bg-panel-surface border border-panel-border px-3 py-6 text-center text-xs text-text-muted">
          Layout {variant} for this pairing: coming soon.
        </div>
      {/if}
    </div>
  {/if}
</div>
