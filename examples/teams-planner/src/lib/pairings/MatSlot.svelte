<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A card-sized slot zone on the mat: dashed outline + role label, color
   * coded like the physical mats (blue = defender, red = attacker; neutral
   * otherwise). An HTML5 drop target while `active`; clicks place via the
   * pool cards themselves (which are buttons), so the slot stays a plain div.
   */
  let {
    label,
    kind = "neutral",
    active = false,
    onplace,
    children,
  }: {
    label: string;
    kind?: "defender" | "attacker" | "neutral";
    /** Accepting placements right now (highlights + clickable when empty). */
    active?: boolean;
    /** A card was dropped/placed here; id from drag data (clicks pass none). */
    onplace?: (playerId: string | null) => void;
    /** The occupant card, when filled. */
    children?: Snippet;
  } = $props();

  let dragOver = $state(false);

  const HUES: Record<string, string> = {
    defender: "#3b82f6",
    attacker: "#ef4444",
    neutral: "#6b7280",
  };
  const hue = $derived(HUES[kind]);

  function ondrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (!active) return;
    onplace?.(e.dataTransfer?.getData("text/plain") || null);
  }
</script>

<div class="slot-wrap">
  <div
    class="slot"
    class:active
    class:drag-over={dragOver}
    style:--hue={hue}
    role="group"
    aria-label="{label} slot"
    ondragover={(e: DragEvent) => {
      if (active) {
        e.preventDefault();
        dragOver = true;
      }
    }}
    ondragleave={() => (dragOver = false)}
    {ondrop}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
  <span class="label" style:color={hue}>{label}</span>
</div>

<style>
  .slot-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .slot {
    width: calc(6rem + 10px);
    aspect-ratio: 63 / 88;
    border: 2px dashed color-mix(in srgb, var(--hue) 55%, transparent);
    border-radius: 9%/6.4%;
    background: color-mix(in srgb, var(--hue) 7%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .slot.active {
    border-color: var(--hue);
    background: color-mix(in srgb, var(--hue) 14%, transparent);
    cursor: pointer;
  }
  .slot.active:hover,
  .slot.drag-over {
    box-shadow: 0 0 10px color-mix(in srgb, var(--hue) 60%, transparent);
  }
  .label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
