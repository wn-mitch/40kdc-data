<script lang="ts">
  import LayoutThumb from "../../../../_shared/LayoutThumb.svelte";
  import { DISPOSITION_LABELS } from "../../../../_shared/matchup-grid.js";
  import { ds } from "../dataset";
  import DispoPill from "../DispoPill.svelte";
  import { layoutFor, missionFor } from "./missions";
  import type { Matchup } from "./types";

  /**
   * One resolved table: both players with their dispositions, the asymmetric
   * primary missions (each side reads its own card), the declared layout
   * letter, and a thumbnail when that layout is authored in the dataset.
   */
  let { table }: { table: Matchup } = $props();

  const userMission = $derived(missionFor(table.user.fd, table.cpu.fd));
  const cpuMission = $derived(missionFor(table.cpu.fd, table.user.fd));
  const layout = $derived(layoutFor(table));
  const chooserLabel = $derived(
    table.layoutChooser === "round"
      ? "set by round"
      : table.layoutChooser === "user"
        ? "your defender's choice"
        : "their defender's choice",
  );
  const sourceLabel = $derived(
    {
      "defender-user": "Your defender's table",
      "defender-cpu": "Their defender's table",
      refused: "Refused attackers",
      champion: "Champions",
    }[table.source],
  );
</script>

<article class="flex gap-3 rounded-md border border-panel-border bg-panel-surface p-3">
  <div class="min-w-0 flex-1">
    <p class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">
      {sourceLabel}
    </p>
    <div class="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-text">{table.user.name}</p>
        <p class="truncate text-[11px] text-text-dim">
          {ds.factions.get(table.user.factionId)?.name ?? table.user.factionId}
        </p>
        <DispoPill disposition={table.user.fd} tier="could" />
      </div>
      <span class="text-xs uppercase text-text-dim">vs</span>
      <div class="min-w-0 text-right">
        <p class="truncate text-sm font-semibold text-text">{table.cpu.name}</p>
        <p class="truncate text-[11px] text-text-dim">
          {ds.factions.get(table.cpu.factionId)?.name ?? table.cpu.factionId}
        </p>
        <DispoPill disposition={table.cpu.fd} tier="could" />
      </div>
    </div>
    <dl class="mt-2 flex flex-col gap-0.5 text-xs">
      <div class="flex gap-1">
        <dt class="text-text-dim">You score</dt>
        <dd class="text-text" title="Read {DISPOSITION_LABELS[table.cpu.fd]} on your own card">
          {userMission?.name ?? "—"}
        </dd>
      </div>
      <div class="flex gap-1">
        <dt class="text-text-dim">They score</dt>
        <dd class="text-text" title="Read {DISPOSITION_LABELS[table.user.fd]} on their card">
          {cpuMission?.name ?? "—"}
        </dd>
      </div>
      <div class="flex gap-1">
        <dt class="text-text-dim">Layout</dt>
        <dd class="font-semibold text-text">{table.layout}</dd>
        <dd class="text-text-dim">({chooserLabel})</dd>
      </div>
    </dl>
  </div>
  {#if layout}
    <div class="w-16 shrink-0 self-center">
      <LayoutThumb {ds} {layout} />
    </div>
  {/if}
</article>
