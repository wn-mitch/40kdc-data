<script lang="ts">
  import LayoutThumb from "../../../../_shared/LayoutThumb.svelte";
  import { DISPOSITION_LABELS } from "../../../../_shared/matchup-grid.js";
  import { ds } from "../dataset";
  import FactionCard from "./FactionCard.svelte";
  import { layoutFor, missionFor } from "./missions";
  import type { Matchup } from "./types";

  /**
   * One resolved table in the TABLES zone: the two army cards face up, side
   * by side, over the table facts — both asymmetric primary missions (each
   * side reads its own FD card), the declared layout letter (+ thumbnail
   * when the dataset has that layout authored), and who chose it.
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

<article class="rounded-md border border-panel-border bg-panel-surface p-2.5">
  <p class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-dim">
    {sourceLabel}
  </p>
  <div class="mt-1.5 flex items-start gap-2">
    <FactionCard player={table.user} size="sm" />
    <span class="self-center text-xs uppercase text-text-dim">vs</span>
    <FactionCard player={table.cpu} size="sm" />
    <dl class="ml-1 flex min-w-0 flex-1 flex-col gap-0.5 self-center text-xs">
      <div class="flex gap-1">
        <dt class="shrink-0 text-text-dim">You score</dt>
        <dd class="text-text" title="Read {DISPOSITION_LABELS[table.cpu.fd]} on your own card">
          {userMission?.name ?? "—"}
        </dd>
      </div>
      <div class="flex gap-1">
        <dt class="shrink-0 text-text-dim">They score</dt>
        <dd class="text-text" title="Read {DISPOSITION_LABELS[table.user.fd]} on their card">
          {cpuMission?.name ?? "—"}
        </dd>
      </div>
      <div class="flex flex-wrap gap-1">
        <dt class="text-text-dim">Layout</dt>
        <dd class="font-semibold text-text">{table.layout}</dd>
        <dd class="text-text-dim">({chooserLabel})</dd>
      </div>
    </dl>
    {#if layout}
      <div class="w-12 shrink-0 self-center">
        <LayoutThumb {ds} {layout} />
      </div>
    {/if}
  </div>
</article>
