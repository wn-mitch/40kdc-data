<script lang="ts">
  import { ds } from "../dataset";
  import DispoPill from "../DispoPill.svelte";
  import { factionStyle } from "./factions";
  import type { SimPlayer } from "./types";

  /**
   * One army card — the on-screen stand-in for the big sleeved card a team
   * slaps onto a physical pairing mat. 63:88 (standard card) aspect, faction
   * livery body + mask-tinted faction symbol on the front, a neutral
   * patterned back for secret placements, CSS 3D flip between them.
   *
   * Click and drag are the same operation (place/arm): both call `onpick`.
   * Rendered as a button so arm-then-place is keyboard-operable.
   */
  let {
    player,
    face = "up",
    size = "md",
    selectable = false,
    selected = false,
    onpick,
    title,
  }: {
    player: SimPlayer;
    /** `down` shows the card back (secret placements). */
    face?: "up" | "down";
    /** sm = pool/table chips, md = slots, lg = setup bench. */
    size?: "sm" | "md" | "lg";
    selectable?: boolean;
    /** Armed/raised styling (the click-to-place intermediate state). */
    selected?: boolean;
    onpick?: () => void;
    title?: string;
  } = $props();

  const style = $derived(factionStyle(player.factionId));
  const factionName = $derived(ds.factions.get(player.factionId)?.name ?? player.factionId);
  const W: Record<string, string> = { sm: "4.5rem", md: "6rem", lg: "7.25rem" };

  function ondragstart(e: DragEvent) {
    if (!selectable || !e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", player.id);
    e.dataTransfer.effectAllowed = "move";
    onpick?.();
  }
</script>

<svelte:element
  this={selectable ? "button" : "div"}
  type={selectable ? "button" : undefined}
  role={selectable ? "button" : "img"}
  class="card focus-ring {selected ? 'armed' : ''} {selectable ? 'cursor-grab' : ''}"
  style:--card-w={W[size]}
  style:--accent={style.color}
  style:--body={style.colorDim}
  draggable={selectable ? "true" : undefined}
  {ondragstart}
  onclick={selectable ? onpick : undefined}
  title={title ?? `${player.name} — ${factionName}`}
  aria-label={title ?? `${player.name} (${factionName})`}
  aria-pressed={selectable ? selected : undefined}
>
  <div class="flip" class:down={face === "down"}>
    <!-- Front -->
    <div class="side front">
      <span class="glyph" style:mask-image="url({style.icon})" style:-webkit-mask-image="url({style.icon})"
      ></span>
      <span class="name" class:text-sm={size === "lg"}>{player.name}</span>
      <span class="faction">{factionName}</span>
      <span class="pill"><DispoPill disposition={player.fd} tier="could" /></span>
    </div>
    <!-- Back: neutral, with a faint repeating mark so it reads as card stock. -->
    <div class="side back" aria-hidden="true"><span class="back-mark">✕</span></div>
  </div>
</svelte:element>

<style>
  .card {
    width: var(--card-w);
    aspect-ratio: 63 / 88;
    perspective: 600px;
    border: none;
    background: none;
    padding: 0;
    display: block;
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .card.armed {
    transform: translateY(-6px);
    filter: drop-shadow(0 0 6px var(--accent));
  }
  .card:not(.armed):where(button):hover {
    transform: translateY(-3px);
  }
  .flip {
    position: relative;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    transition: transform 0.35s ease;
  }
  .flip.down {
    transform: rotateY(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .flip {
      transition: none;
    }
    .card {
      transition: none;
    }
  }
  .side {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    border-radius: 8%/5.7%; /* even corner radius at 63:88 */
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }
  .front {
    background: linear-gradient(160deg, color-mix(in srgb, var(--body) 86%, white 14%), var(--body) 55%);
    border: 1.5px solid var(--accent);
    padding: 8% 6% 6%;
    gap: 2%;
  }
  .glyph {
    width: 62%;
    flex: 1 1 auto;
    min-height: 0;
    background-color: var(--accent);
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }
  .name {
    width: 100%;
    text-align: center;
    font-size: 0.65rem;
    line-height: 1.1;
    font-weight: 600;
    color: #f0f1f4;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .name.text-sm {
    font-size: 0.78rem;
  }
  .faction {
    width: 100%;
    text-align: center;
    font-size: 0.55rem;
    color: color-mix(in srgb, var(--accent) 70%, white 30%);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill {
    margin-top: 1%;
  }
  .back {
    transform: rotateY(180deg);
    background:
      repeating-linear-gradient(45deg, transparent 0 6px, rgba(255, 255, 255, 0.04) 6px 12px),
      linear-gradient(160deg, #2c2e36, #1b1c22);
    border: 1.5px solid #4a4d59;
    justify-content: center;
  }
  .back-mark {
    color: rgba(255, 255, 255, 0.12);
    font-size: 1.6rem;
  }
</style>
