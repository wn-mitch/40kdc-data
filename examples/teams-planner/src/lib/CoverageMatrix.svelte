<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import {
    columnFull,
    dispositionCap,
    effectivePlacement,
    findArmy,
    teamLegalityIssues,
    type Player,
    type TeamCoverage,
    type TeamPlan,
  } from "./coverage";
  import { DISPOSITION_LABELS, DISPOSITIONS } from "../../../_shared/matchup-grid.js";
  import { DISPOSITION_COLORS, TIER_SYMBOL } from "./dispositions";
  import DispoPill from "./DispoPill.svelte";

  let {
    plan,
    coverage,
    onchange,
  }: {
    plan: TeamPlan;
    coverage: TeamCoverage;
    onchange: (next: Player) => void;
  } = $props();

  const filled = $derived(plan.players.filter((p) => p.factionIds.length > 0).length);
  const lockCap = $derived(dispositionCap(plan.size));
  const legality = $derived(teamLegalityIssues(plan));

  // Toggle the captain's lock for a player on a disposition. Pins the player's
  // *effective* army (the one the cell shows) so a later preference reshuffle
  // can't silently re-point the committed assignment.
  function toggleLock(p: Player, d: ForceDispositionId) {
    const eff = effectivePlacement(p, d);
    if (!eff) return;
    const locked = { ...p.locked };
    if (locked[d]) delete locked[d];
    else locked[d] = eff.armyId;
    onchange({ ...p, locked });
  }
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

  {#if legality.length > 0}
    <!-- Advisory only — planning is allowed to explore illegal shapes. -->
    <div class="mx-2 mb-1 flex flex-col gap-1">
      {#each legality as issue (issue.detail)}
        <div class="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning" role="note">
          ⚠ {issue.detail}
        </div>
      {/each}
    </div>
  {/if}

  {#if plan.players.length === 0}
    <p class="px-3 py-6 text-center text-sm text-text-dim">
      Add players, then build each one an army pool to see disposition coverage.
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
                <DispoPill disposition={d} tier="could" />
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
                {@const eff = can ? effectivePlacement(p, d) : null}
                {@const army = eff ? findArmy(p, eff.armyId) : null}
                {@const locked = !!p.locked?.[d]}
                {@const blocked = !locked && columnFull(plan.size, coverage, d)}
                <td
                  class="px-2 py-1.5 text-center align-top {locked ? 'bg-accent-dim' : ''} {blocked ? 'opacity-40' : ''}"
                >
                  {#if !eff}
                    <span class="text-text-dim" aria-label="cannot field {DISPOSITION_LABELS[d]}">·</span>
                  {:else}
                    <div class="flex flex-col items-center gap-0.5">
                      <span
                        style="color:{DISPOSITION_COLORS[d]}"
                        title="{eff.tier} — {DISPOSITION_LABELS[d]}"
                        aria-label="{eff.tier} {DISPOSITION_LABELS[d]}"
                      >
                        {TIER_SYMBOL[eff.tier]}
                      </span>
                      <span class="max-w-[6rem] truncate text-[10px] leading-tight text-text-muted" title={army?.name}>
                        {army?.name}
                      </span>
                      <input
                        type="checkbox"
                        class="focus-ring h-3 w-3 cursor-pointer disabled:cursor-not-allowed"
                        checked={locked}
                        disabled={blocked}
                        onchange={() => toggleLock(p, d)}
                        title={locked
                          ? `Locked in for ${DISPOSITION_LABELS[d]}`
                          : blocked
                            ? `${DISPOSITION_LABELS[d]} already has ${lockCap} locked player${lockCap === 1 ? "" : "s"}`
                            : `Lock ${p.name || "player"} into ${DISPOSITION_LABELS[d]}`}
                        aria-label="Lock {p.name || 'player'} into {DISPOSITION_LABELS[d]}"
                      />
                    </div>
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
              {@const roll = coverage.tierByDisposition[d]}
              {@const lockedN = coverage.lockedByDisposition[d].length}
              <td
                class="px-2 py-1.5 text-center align-top font-mono text-xs font-bold
                       {n === 0 ? 'bg-danger/20 text-danger' : 'text-text'}"
                title={n === 0 ? `GAP — no player covers ${DISPOSITION_LABELS[d]}` : `${n} player(s) can field ${DISPOSITION_LABELS[d]}`}
              >
                {n === 0 ? "GAP" : n}
                {#if roll.want.length > 0 || roll.pref.length > 0 || roll.could.length > 0}
                  <div class="mt-0.5 font-sans text-[10px] font-normal" style="color:{DISPOSITION_COLORS[d]}">
                    {#if roll.want.length > 0}<span title="{roll.want.length} want">{TIER_SYMBOL.want}{roll.want.length}</span>{/if}
                    {#if roll.pref.length > 0}<span title="{roll.pref.length} pref"> {TIER_SYMBOL.pref}{roll.pref.length}</span>{/if}
                    {#if roll.could.length > 0}<span title="{roll.could.length} could"> {TIER_SYMBOL.could}{roll.could.length}</span>{/if}
                  </div>
                {/if}
                {#if lockedN > 0}
                  <div class="mt-0.5 font-sans text-[10px] font-normal text-text-muted" title="{lockedN} of {lockCap} locked">
                    🔒 {lockedN}/{lockCap}
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
