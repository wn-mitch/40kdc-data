<script lang="ts">
  import { BOARD, resolveEmbedded } from "./model.js";

  /**
   * Mini read-only render of an embedded layout for the library grid: just the
   * resolved piece polygons on the portrait-rotated board, no grid/handles.
   * Resolution is memoized in the model (`resolveEmbedded`).
   */
  interface Props {
    layoutId: string;
  }
  let { layoutId }: Props = $props();

  const resolved = $derived(resolveEmbedded(layoutId));
  const pts = (vs: { x: number; y: number }[]): string => vs.map((v) => `${v.x},${v.y}`).join(" ");
</script>

<svg class="thumb" viewBox="0 0 44 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <g transform="translate(44,0) rotate(90)">
    <rect x="0" y="0" width={BOARD.width} height={BOARD.height} class="bg" />
    {#each resolved as p, i (p.id ?? i)}
      <polygon points={pts(p.vertices)} class="piece {p.piece_type}" />
    {/each}
  </g>
</svg>

<style>
  .thumb {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 3px;
  }
  .bg {
    fill: oklch(0.74 0.008 220);
  }
  .piece {
    stroke-width: 0.3;
  }
  .piece.area {
    fill: oklch(0.55 0.15 258 / 0.42);
    stroke: oklch(0.42 0.16 262);
  }
  .piece.feature {
    fill: oklch(0.68 0.15 62 / 0.55);
    stroke: oklch(0.5 0.16 58);
  }
</style>
