<script lang="ts">
  import { wtcResult } from "@alpaca-software/40kdc-data";

  let {
    totalYou,
    totalOpp,
    round,
    onRound,
    onReset,
  }: {
    totalYou: number;
    totalOpp: number;
    round: number;
    onRound: (r: number) => void;
    onReset: () => void;
  } = $props();

  const result = $derived(wtcResult(totalYou, totalOpp));
</script>

<div class="rounded border border-border bg-surface shadow-md p-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
  <!-- Battle round selector -->
  <div class="flex items-center gap-1 justify-self-start">
    <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text-muted mr-1">Round</span>
    {#each [1, 2, 3, 4, 5] as r (r)}
      <button
        type="button"
        class="focus-ring w-7 h-7 rounded font-mono text-sm border transition-colors {r === round
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-panel text-text-muted border-border hover:border-accent hover:text-accent'}"
        aria-pressed={r === round}
        onclick={() => onRound(r)}>{r}</button
      >
    {/each}
  </div>

  <!-- WTC 20-point result — centered; the figure the scoresheet exists to produce. -->
  <div class="justify-self-center flex items-center gap-2 rounded bg-accent-dim border border-accent px-3 py-1.5">
    <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text">WTC</span>
    <span class="font-mono tabular-nums text-2xl font-medium text-accent">{result.a} – {result.b}</span>
  </div>

  <button
    type="button"
    class="focus-ring justify-self-end font-heading text-[11px] uppercase tracking-wide rounded px-2 py-1 text-danger bg-danger/5 border border-transparent hover:bg-danger/15"
    onclick={onReset}>Reset game</button
  >
</div>
