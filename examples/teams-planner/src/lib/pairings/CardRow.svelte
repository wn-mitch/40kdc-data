<script lang="ts">
  import { flip } from "svelte/animate";
  import FactionCard from "./FactionCard.svelte";
  import { CARD_MS, receiveCard, sendCard } from "./transitions";
  import type { SimPlayer } from "./types";

  /**
   * A labeled pool row of cards — one team's bench on the mat. Cards animate
   * in/out via the shared crossfade (so leaving the pool reads as flying to
   * the slot that received it) and reflow with FLIP.
   */
  let {
    label,
    players,
    face = "up",
    selectable = false,
    armedId = null,
    onpick,
    size = "md",
  }: {
    label: string;
    players: SimPlayer[];
    face?: "up" | "down";
    /** Cards are pickable (click arms, drag carries). */
    selectable?: boolean;
    /** The currently armed card's id, raised + glowing. */
    armedId?: string | null;
    onpick?: (player: SimPlayer) => void;
    size?: "sm" | "md" | "lg";
  } = $props();
</script>

<div class="row-wrap">
  <span class="row-label">{label}</span>
  <div class="row" role={selectable ? "listbox" : "list"} aria-label={label}>
    {#each players as p (p.id)}
      <!-- Outgoing ghosts linger for the crossfade; drop them out of hit
           testing AND the a11y tree, else a fast second click lands on the
           leaving card and reads as a dead click. An interrupted outro reuses
           the element, so the intro must undo the suppression. -->
      <div
        class="cell"
        animate:flip={{ duration: CARD_MS }}
        in:receiveCard={{ key: p.id }}
        out:sendCard={{ key: p.id }}
        onoutrostart={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.pointerEvents = "none";
          el.setAttribute("aria-hidden", "true");
        }}
        onintrostart={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.pointerEvents = "";
          el.removeAttribute("aria-hidden");
        }}
      >
        <FactionCard
          player={p}
          {face}
          {size}
          {selectable}
          selected={armedId === p.id}
          onpick={() => onpick?.(p)}
        />
      </div>
    {/each}
    {#if players.length === 0}
      <span class="empty">— empty —</span>
    {/if}
  </div>
</div>

<style>
  .row-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .row-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-dim, #8a8f9c);
  }
  .row {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding: 0.25rem 0.125rem 0.375rem;
    min-height: 3rem;
    align-items: flex-start;
  }
  .empty {
    font-size: 0.7rem;
    font-style: italic;
    color: var(--color-text-dim, #8a8f9c);
    align-self: center;
  }
</style>
