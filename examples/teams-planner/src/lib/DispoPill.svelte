<script lang="ts">
  import type { ForceDispositionId } from "@alpaca-software/40kdc-data";
  import {
    DISPOSITION_ABBR,
    DISPOSITION_LABELS,
  } from "../../../_shared/matchup-grid.js";
  import { pillStyle, type PillTier } from "./dispositions";

  /**
   * One disposition rendered as a hue-colored pill. The single visual unit
   * reused by the player intent row, detachment fd tags, and the matrix headers.
   * `interactive` swaps the `<span>` for a `<button>` (the cycle-on-click intent
   * control); `tag` is the bare hue text used next to detachment names.
   */
  let {
    disposition,
    tier = "can",
    interactive = false,
    onclick,
    label,
    title,
  }: {
    disposition: ForceDispositionId;
    tier?: PillTier;
    interactive?: boolean;
    onclick?: () => void;
    label?: string;
    title?: string;
  } = $props();

  const text = $derived(label ?? DISPOSITION_ABBR[disposition]);
  const tip = $derived(title ?? DISPOSITION_LABELS[disposition]);
  const style = $derived(pillStyle(disposition, tier));

  // Hue lives in inline `style`; classes carry only layout + the neutral
  // (hue-free) tiers so Tailwind keeps them at build time.
  const cls = $derived(
    tier === "tag"
      ? "text-[10px] font-medium uppercase tracking-wide"
      : "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
          (tier === "uncovered"
            ? "bg-panel text-text-dim line-through"
            : tier === "prefer"
              ? "font-bold"
              : ""),
  );
</script>

{#if interactive}
  <button
    type="button"
    class="focus-ring {cls}"
    {style}
    title={tip}
    aria-pressed={tier === "leaning" || tier === "prefer"}
    onclick={onclick}
  >
    {text}
  </button>
{:else}
  <span class={cls} {style} title={tip}>{text}</span>
{/if}
