<script lang="ts">
  // The combined volley's exact spread: how likely each number of kills is, not only the average.
  // Two volleys with the same expected kills can have very different odds of finishing a unit.
  import { atLeast, fmtChance as pct, type KillOdds } from "./line-results.js";

  let { odds, modelCount, leaderName = null, mortalsLeftOut }: {
    odds: KillOdds | { error: string } | null;
    /** The target's models, counting a CHARACTER leading it. */
    modelCount: number;
    /** The CHARACTER leading the target, when one does. */
    leaderName?: string | null;
    mortalsLeftOut: boolean;
  } = $props();

  const shown = $derived.by(() => {
    if (!odds || "error" in odds) return null;
    const tail = atLeast(odds.modelsDestroyed);
    // Every count with a real chance, and the wipe however unlikely.
    const rows = tail
      .map((p, i) => ({ k: i + 1, p }))
      .filter((row) => row.p >= 0.005 || row.k === modelCount);
    // The kill count at a cumulative probability `q`.
    const quantile = (q: number): number => {
      let sum = 0;
      for (let k = 0; k < odds.modelsDestroyed.length; k += 1) {
        sum += odds.modelsDestroyed[k] ?? 0;
        if (sum >= q - 1e-12) return k;
      }
      return modelCount;
    };
    return { rows, leader: odds.leaderKilled, wipe: tail[modelCount - 1] ?? 0, none: odds.modelsDestroyed[0] ?? 0, low: quantile(0.1), median: quantile(0.5), high: quantile(0.9) };
  });
</script>

<section class="odds" aria-labelledby="odds-head">
  <h3 id="odds-head">Chance to kill</h3>
  {#if odds && "error" in odds}
    <p class="dim note">No exact spread for this volley: {odds.error}</p>
  {:else if shown}
    <p class="summary">
      <span><span class="label">Wipe</span> <span class="num strong">{pct(shown.wipe)}</span></span>
      {#if leaderName && shown.leader !== undefined}
        <span title={`Exact chance to destroy ${leaderName}`}><span class="label">{leaderName} killed</span> <span class="num strong">{pct(shown.leader)}</span></span>
      {/if}
      <span><span class="label">No kills</span> <span class="num">{pct(shown.none)}</span></span>
      <span><span class="label">Median</span> <span class="num">{shown.median}</span></span>
      <span title="Kills between the 10th and 90th percentile">
        <span class="label">Likely</span>
        <span class="num">{shown.low === shown.high ? shown.median : `${shown.low}–${shown.high}`}</span>
        <span class="dim">models, 80% of the time</span>
      </span>
    </p>
    <ul class="bars">
      {#each shown.rows as row (row.k)}
        <li>
          <span class="k">{row.k === modelCount ? `all ${row.k}` : `≥ ${row.k}`}</span>
          <span class="track" role="img" aria-label={`${pct(row.p)} chance to kill at least ${row.k}`}>
            <span class="fill" class:wipe={row.k === modelCount} style:width={`${Math.max(row.p * 100, row.p > 0 ? 0.5 : 0)}%`}></span>
          </span>
          <span class="num p">{pct(row.p)}</span>
        </li>
      {/each}
    </ul>
    <p class="dim note">
      Exact odds: the lines fire in the order listed, so damage lost past a model's last wound counts.{#if leaderName}{" "}{leaderName} takes attacks once the Bodyguard is destroyed, or first from a [PRECISION] weapon; each wound's save is its current model's.{/if}{#if mortalsLeftOut}
        Mortal wounds from abilities are left out.{/if}
    </p>
  {/if}
</section>

<style>
  .odds {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--panel-surface);
  }
  h3 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-heading);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--muted);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0 0 var(--space-3);
    align-items: baseline;
  }
  .label {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--muted);
  }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .strong {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--accent);
  }
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .bars li {
    display: grid;
    grid-template-columns: 4.5em 1fr 3.5em;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .k {
    color: var(--muted);
    text-align: right;
  }
  .track {
    height: 10px;
    border-radius: var(--radius-sm);
    background: var(--border-subtle);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .fill.wipe {
    background: var(--good);
  }
  .p {
    text-align: right;
  }
  .note {
    margin: var(--space-2) 0 0;
    font-size: var(--text-2xs);
  }
</style>
