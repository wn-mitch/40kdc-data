<script lang="ts">
  import { wtcResult } from "@alpaca-software/40kdc-data";

  // The sticky match scoreboard: battle round, the WTC 20-point result, reset,
  // and (below lg, where only one PlayerColumn is visible) the You/Opponent
  // switcher carrying both running totals.
  let {
    totalYou,
    totalOpp,
    round,
    onRound,
    onReset,
    activeSide,
    onSide,
    dispYouLabel,
    dispOppLabel,
  }: {
    totalYou: number;
    totalOpp: number;
    round: number;
    onRound: (r: number) => void;
    onReset: () => void;
    activeSide: "you" | "opp";
    onSide: (s: "you" | "opp") => void;
    dispYouLabel: string | null;
    dispOppLabel: string | null;
  } = $props();

  const result = $derived(wtcResult(totalYou, totalOpp));

  // Two-tap reset: the first tap arms the button, a second tap within the
  // window commits. Arming auto-expires so a stray tap can't linger.
  const DISARM_MS = 3000;
  let armed = $state(false);
  let disarmTimer: ReturnType<typeof setTimeout> | undefined;
  function tapReset(): void {
    if (armed) {
      clearTimeout(disarmTimer);
      armed = false;
      onReset();
      return;
    }
    armed = true;
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => (armed = false), DISARM_MS);
  }
  $effect(() => () => clearTimeout(disarmTimer));
</script>

<!-- Full-bleed within <main>'s padding so scrolled content passes behind a
     solid bar. Safe-area top padding keeps it clear of the notch when the PWA
     runs standalone. -->
<div class="sticky top-0 z-30 -mx-4 px-3 pt-[env(safe-area-inset-top)] bg-surface border-b border-border shadow-md">
  <div class="flex items-center justify-between gap-2 py-2">
    <!-- Battle round selector -->
    <div class="flex items-center gap-1">
      <span class="hidden lg:inline font-heading text-[10px] font-bold uppercase tracking-wider text-text-muted mr-1">Round</span>
      {#each [1, 2, 3, 4, 5] as r (r)}
        <button
          type="button"
          class="focus-ring w-11 h-11 lg:w-7 lg:h-7 rounded font-mono text-base lg:text-sm border transition-colors {r === round
            ? 'bg-accent text-accent-foreground border-accent'
            : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}"
          aria-pressed={r === round}
          aria-label="Battle round {r}"
          onclick={() => onRound(r)}>{r}</button
        >
      {/each}
    </div>

    <!-- WTC 20-point result — the figure the scoresheet exists to produce.
         Lives here on desktop; on mobile it sits between the switcher tabs. -->
    <div class="hidden lg:flex items-center gap-2 rounded bg-accent-dim border border-accent px-3 py-1.5">
      <span class="font-heading text-[10px] font-bold uppercase tracking-wider text-text">WTC</span>
      <span class="font-mono tabular-nums text-2xl font-medium text-accent">{result.a} – {result.b}</span>
    </div>

    <button
      type="button"
      class="focus-ring min-h-11 lg:min-h-0 font-heading text-[11px] uppercase tracking-wide rounded px-2 py-1 transition-colors {armed
        ? 'text-danger bg-danger/20 border border-danger'
        : 'text-danger bg-danger/5 border border-transparent hover:bg-danger/15'}"
      aria-label={armed ? "Confirm reset" : "Reset game"}
      onclick={tapReset}>{armed ? "Confirm reset" : "Reset game"}</button
    >
  </div>

  <!-- Mobile player switcher: one column shows at a time below lg, so each
       segment carries its side's running total; the WTC pill sits between. -->
  <div class="lg:hidden flex items-stretch gap-2 pb-2" role="group" aria-label="Player view">
    {#each [
      { side: "you", label: "You", disp: dispYouLabel, total: totalYou },
      { side: "opp", label: "Opponent", disp: dispOppLabel, total: totalOpp },
    ] as const as seg, i (seg.side)}
      {#if i === 1}
        <div class="flex flex-col items-center justify-center rounded bg-accent-dim border border-accent px-2" aria-label="WTC result">
          <span class="font-mono tabular-nums text-base font-medium text-accent whitespace-nowrap">{result.a}–{result.b}</span>
        </div>
      {/if}
      <button
        type="button"
        class="focus-ring flex-1 min-h-11 min-w-0 flex items-center justify-between gap-2 rounded border px-3 transition-colors {activeSide === seg.side
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-panel text-text-muted border-border-strong hover:border-accent hover:text-accent'}"
        aria-pressed={activeSide === seg.side}
        onclick={() => onSide(seg.side)}
      >
        <span class="min-w-0 truncate text-left">
          <span class="block font-heading text-xs font-bold uppercase tracking-wider leading-tight">{seg.label}</span>
          {#if seg.disp}
            <span class="block font-heading text-[9px] uppercase tracking-wide leading-tight {activeSide === seg.side ? 'opacity-80' : 'text-text-dim'}">{seg.disp}</span>
          {/if}
        </span>
        <span class="font-mono tabular-nums text-lg">{seg.total}</span>
      </button>
    {/each}
  </div>
</div>
