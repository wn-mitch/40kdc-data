<script lang="ts">
  import type { RoundCell } from "@alpaca-software/40kdc-data";
  import { GAME_VP_CAP } from "@alpaca-software/40kdc-data";

  let {
    rounds,
    current,
  }: {
    rounds: RoundCell[];
    current: number;
  } = $props();

  const primaryTotal = $derived(rounds.reduce((s, c) => s + c.primary, 0));
  const secondaryTotal = $derived(rounds.reduce((s, c) => s + c.secondary, 0));
  const grand = $derived(Math.min(GAME_VP_CAP, primaryTotal + secondaryTotal));
</script>

<table class="w-full border-collapse font-mono tabular-nums text-sm">
  <thead>
    <tr>
      <th class="text-left font-heading text-[10px] font-bold uppercase tracking-wide text-text-muted px-1 py-1"
        >Battle round</th
      >
      {#each rounds as _, i (i)}
        <th
          class="w-9 text-center font-heading text-xs font-bold px-0 py-1 border-l border-border {i + 1 ===
          current
            ? 'text-accent'
            : 'text-text-muted'}">{i + 1}</th
        >
      {/each}
      <th class="w-10 text-center font-heading text-[10px] font-bold uppercase tracking-wide text-text-muted px-1 py-1 border-l border-border"
        >Σ</th
      >
    </tr>
  </thead>
  <tbody>
    <tr class="border-t border-border">
      <td class="font-heading text-[11px] uppercase tracking-wide text-text-muted px-1 py-1">Primary</td>
      {#each rounds as cell, i (i)}
        <td class="border-l border-border text-center text-text px-0 py-1 {i + 1 === current ? 'bg-accent-dim' : ''}"
          >{cell.primary || ""}</td
        >
      {/each}
      <td class="border-l border-border text-center text-text px-1">{primaryTotal}</td>
    </tr>
    <tr class="border-t border-border">
      <td class="font-heading text-[11px] uppercase tracking-wide text-text-muted px-1 py-1">Secondary</td>
      {#each rounds as cell, i (i)}
        <td class="border-l border-border text-center text-text px-0 py-1 {i + 1 === current ? 'bg-accent-dim' : ''}"
          >{cell.secondary || ""}</td
        >
      {/each}
      <td class="border-l border-border text-center text-text px-1">{secondaryTotal}</td>
    </tr>
    <tr class="border-t border-border bg-panel-surface">
      <td class="font-heading text-[11px] font-bold uppercase tracking-wide text-text px-1 py-1">Total</td>
      {#each rounds as cell, i (i)}
        <td class="border-l border-border text-center text-text-muted px-0 py-1"
          >{cell.primary + cell.secondary || ""}</td
        >
      {/each}
      <td class="border-l border-border text-center text-accent font-medium px-1">{grand}</td>
    </tr>
  </tbody>
</table>
