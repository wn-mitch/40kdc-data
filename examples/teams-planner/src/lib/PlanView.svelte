<script lang="ts">
  import { sanitizeTeamSize, TEAM_SIZES, type Player, type TeamCoverage, type TeamPlan } from "./coverage";
  import CoverageMatrix from "./CoverageMatrix.svelte";
  import PlayerRow from "./PlayerRow.svelte";

  /**
   * The coverage-planning body, extracted from App.svelte so the shell can
   * switch between it and the pairings simulator. All state stays in App —
   * this renders the plan and forwards edits.
   */
  let {
    plan,
    coverage,
    showGoLive,
    onPlanChange,
    onUpdatePlayer,
    onAddPlayer,
    onRemovePlayer,
    onCopyShare,
    onReset,
    onGoLive,
  }: {
    plan: TeamPlan;
    coverage: TeamCoverage;
    /** "Go live" renders only while no session is active. */
    showGoLive: boolean;
    onPlanChange: (next: TeamPlan) => void;
    onUpdatePlayer: (next: Player) => void;
    onAddPlayer: () => void;
    onRemovePlayer: (id: string) => void;
    onCopyShare: () => void;
    onReset: () => void;
    onGoLive: () => void;
  } = $props();
</script>

<!-- Team controls -->
<div class="mb-4 flex flex-wrap items-end gap-3">
  <label class="flex flex-col gap-1">
    <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">Team name</span>
    <input
      class="focus-ring rounded border border-border-strong bg-panel px-2 py-1.5 text-sm text-text placeholder:text-text-dim"
      placeholder="Team name"
      value={plan.teamName}
      oninput={(e) => onPlanChange({ ...plan, teamName: (e.currentTarget as HTMLInputElement).value })}
    />
  </label>
  <label class="flex flex-col gap-1">
    <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">Team size</span>
    <select
      class="focus-ring rounded border border-border-strong bg-panel px-2 py-1.5 text-sm text-text"
      value={String(plan.size)}
      onchange={(e) => {
        const v = Number((e.currentTarget as HTMLSelectElement).value);
        onPlanChange({ ...plan, size: sanitizeTeamSize(v) });
      }}
    >
      {#each TEAM_SIZES as n (n)}
        <option value={String(n)}>{n} players</option>
      {/each}
    </select>
  </label>
  <div class="ml-auto flex gap-2">
    {#if showGoLive}
      <button
        type="button"
        class="focus-ring rounded bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-foreground hover:bg-accent-hover"
        onclick={onGoLive}
        title="Share a live link — everyone edits this plan together and changes save to the cloud"
      >
        ⦿ Go live
      </button>
    {/if}
    <button
      type="button"
      class="focus-ring rounded border border-border-strong px-3 py-1.5 text-xs uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
      onclick={onCopyShare}
    >
      Copy share link
    </button>
    <button
      type="button"
      class="focus-ring rounded border border-border-strong px-3 py-1.5 text-xs uppercase tracking-wide text-text-muted hover:border-danger hover:text-danger"
      onclick={onReset}
    >
      Reset
    </button>
  </div>
</div>

<!-- Coverage summary -->
<div class="mb-4">
  <CoverageMatrix {plan} {coverage} onchange={onUpdatePlayer} />
</div>

<!-- Players -->
<div class="flex flex-col gap-2">
  {#each plan.players as p (p.id)}
    <PlayerRow
      player={p}
      coverage={coverage.perPlayer.get(p.id) ?? new Set()}
      onchange={onUpdatePlayer}
      onremove={() => onRemovePlayer(p.id)}
    />
  {/each}
</div>

<button
  type="button"
  class="focus-ring mt-3 w-full rounded border border-dashed border-border-strong px-3 py-2 text-sm uppercase tracking-wide text-text-muted hover:border-accent hover:text-accent"
  onclick={onAddPlayer}
>
  + Add player
</button>
