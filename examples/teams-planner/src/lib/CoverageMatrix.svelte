<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import type { TeamCoverage, TeamPlan } from "./coverage";
  import { DISPOSITION_LABELS, DISPOSITIONS } from "../../../_shared/matchup-grid.js";
  import { DISPOSITION_COLORS } from "./dispositions";
  import DispoPill from "./DispoPill.svelte";

  let { plan, coverage }: { plan: TeamPlan; coverage: TeamCoverage } = $props();

  const filled = $derived(plan.players.filter((p) => p.factionIds.length > 0).length);
</script>

<section class="rounded-md border border-panel-border bg-panel-surface shadow-sm">
  <!-- Readiness banner -->
  <div
    class="flex flex-wrap items-center justify-between gap-2 rounded-t-md px-3 py-2
           {coverage.ready ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}"
  >
    <span class="font-heading text-sm font-bold uppercase tracking-wider">
      {#if coverage.ready}
        ✓ All five dispositions covered
      {:else}
        {coverage.gaps.length} disposition{coverage.gaps.length === 1 ? "" : "s"} uncovered
      {/if}
    </span>
    {#if !coverage.ready}
      <span class="text-xs">
        Missing: {coverage.gaps.map((g) => DISPOSITION_LABELS[g]).join(", ")}
      </span>
    {/if}
  </div>

  <div class="px-1 py-1 text-text-dim text-[11px]">
    {filled} of {plan.size} slots have a faction.
  </div>

  {#if plan.players.length === 0}
    <p class="px-3 py-6 text-center text-sm text-text-dim">
      Add players to see disposition coverage.
    </p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th class="sticky left-0 z-10 bg-panel-surface px-3 py-2 text-left font-heading text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Player
            </th>
            {#each DISPOSITIONS as d (d)}
              <th class="px-2 py-2 text-center">
                <DispoPill disposition={d} tier="can" />
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each plan.players as p (p.id)}
            {@const cov = coverage.perPlayer.get(p.id)}
            <tr class="border-t border-panel-border">
              <td class="sticky left-0 z-10 max-w-[10rem] truncate bg-panel-surface px-3 py-1.5 text-text">
                {p.name || "(unnamed)"}
              </td>
              {#each DISPOSITIONS as d (d)}
                {@const can = cov?.has(d) ?? false}
                {@const tier = can ? (p.intent?.[d] ?? "can") : null}
                <td class="px-2 py-1.5 text-center">
                  {#if !can}
                    <span class="text-text-dim" aria-label="does not cover {DISPOSITION_LABELS[d]}">·</span>
                  {:else if tier === "prefer"}
                    <span style="color:{DISPOSITION_COLORS[d]}" aria-label="prefers {DISPOSITION_LABELS[d]}">★</span>
                  {:else if tier === "leaning"}
                    <span style="color:{DISPOSITION_COLORS[d]}" aria-label="leaning toward {DISPOSITION_LABELS[d]}">☆</span>
                  {:else}
                    <span class="text-accent" aria-label="can cover {DISPOSITION_LABELS[d]}">✓</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="border-t-2 border-border-strong">
            <td class="sticky left-0 z-10 bg-panel-surface px-3 py-1.5 font-heading text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Covered by
            </td>
            {#each DISPOSITIONS as d (d)}
              {@const n = coverage.byDisposition[d].length}
              {@const roll = coverage.intentByDisposition[d]}
              <td
                class="px-2 py-1.5 text-center align-top font-mono text-xs font-bold
                       {n === 0 ? 'bg-danger/20 text-danger' : 'text-text'}"
                title={n === 0 ? `GAP — no player covers ${DISPOSITION_LABELS[d]}` : `${n} player(s) can field ${DISPOSITION_LABELS[d]}`}
              >
                {n === 0 ? "GAP" : n}
                {#if roll.prefer.length > 0 || roll.leaning.length > 0}
                  <div class="mt-0.5 font-sans text-[10px] font-normal" style="color:{DISPOSITION_COLORS[d]}">
                    {#if roll.prefer.length > 0}<span title="{roll.prefer.length} prefer">★{roll.prefer.length}</span>{/if}
                    {#if roll.leaning.length > 0}<span title="{roll.leaning.length} leaning">{roll.prefer.length > 0 ? " " : ""}☆{roll.leaning.length}</span>{/if}
                  </div>
                {/if}
              </td>
            {/each}
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</section>
