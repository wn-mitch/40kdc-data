<script lang="ts">
  // Below the two-column breakpoint the projection sits under every input pane, so a
  // change to a toggle has no visible result without scrolling. This bar pins the
  // combined answer to the bottom of the viewport and links down to the full
  // projection; it hides while the projection itself is on screen.
  import { DAMAGE_DEALT, type AttributedStage } from "@alpaca-software/40kdc-data";
  import { fmt, stageOf } from "./projection-model.js";
  import { fmtChance, type KillOdds } from "./line-results.js";

  let { aggregate, modelCount, odds }: {
    aggregate: AttributedStage[];
    modelCount: number;
    odds: KillOdds | { error: string } | null;
  } = $props();

  // The exact chance the volley destroys the whole unit; none when the allocation refused it.
  const wipe = $derived(odds && !("error" in odds) ? odds.modelsDestroyed[modelCount] ?? 0 : undefined);

  const damage = $derived(stageOf(aggregate, DAMAGE_DEALT)?.expected);
  const killed = $derived(stageOf(aggregate, "models-killed")?.expected);

  let projectionVisible = $state(false);
  $effect(() => {
    const target = document.getElementById("projection");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => (projectionVisible = entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  });

  function jump(event: MouseEvent): void {
    const target = document.getElementById("projection");
    if (!target) return;
    event.preventDefault();
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    target.focus({ preventScroll: true });
  }
</script>

<a class="dock" class:hidden={projectionVisible} href="#projection" onclick={jump} aria-hidden={projectionVisible} tabindex={projectionVisible ? -1 : 0}>
  <span class="metric">
    <span class="label">Damage</span>
    <span class="num">{damage === undefined ? "—" : fmt(damage)}</span>
  </span>
  <span class="metric">
    <span class="label">Killed</span>
    <span class="num">{killed === undefined ? "—" : fmt(killed)}</span>
    <span class="of">of {modelCount}</span>
  </span>
  {#if wipe !== undefined}
    <span class="metric" title="Exact chance to destroy the whole unit">
      <span class="label">Wipe</span>
      <span class="num">{fmtChance(wipe)}</span>
    </span>
  {/if}
  <span class="go"><span class="go-text">Full projection</span></span>
</a>

<style>
  .dock {
    display: none;
  }
  @media (max-width: 959px) {
    .dock {
      position: fixed;
      left: var(--space-4);
      right: var(--space-4);
      bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
      z-index: 40;
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-2) var(--space-4);
      min-height: 52px;
      background: var(--panel);
      border: 1px solid var(--accent-dim);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      color: var(--text);
      text-decoration: none;
      transition:
        opacity 180ms cubic-bezier(0.22, 1, 0.36, 1),
        transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .dock.hidden {
      opacity: 0;
      transform: translateY(12px);
      pointer-events: none;
    }
    .dock:focus-visible {
      outline: none;
      box-shadow: var(--shadow-focus), var(--shadow-xl);
    }
  }
  .metric {
    white-space: nowrap;
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }
  .label {
    font-family: var(--font-heading);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--muted);
  }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--accent);
  }
  .of {
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .go {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--accent);
    white-space: nowrap;
  }
  .go::after {
    content: " ↓";
  }
  /* Three metrics leave a phone no room for the label; the arrow stays, the label stays readable to screen readers. */
  @media (max-width: 429px) {
    .dock {
      gap: var(--space-3);
    }
    .go-text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
</style>
