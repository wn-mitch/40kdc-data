<script lang="ts">
  import { BOARD, deploymentZones, resolveEmbedded, territoryDivider } from "./model.js";

  /**
   * Mini read-only render of an embedded layout for the library grid: the
   * deployment pattern (zones + divider) under the resolved piece polygons on
   * the portrait-rotated board, no grid/handles. Piece resolution is memoized
   * in the model (`resolveEmbedded`).
   */
  interface Props {
    layoutId: string;
    /** Deployment pattern drawn under the terrain, when the layout has one. */
    patternId?: string | null;
  }
  let { layoutId, patternId = null }: Props = $props();

  const resolved = $derived(resolveEmbedded(layoutId));
  const zones = $derived(deploymentZones(patternId));
  const divider = $derived(territoryDivider(patternId));
  const pts = (vs: { x: number; y: number }[]): string => vs.map((v) => `${v.x},${v.y}`).join(" ");
</script>

<svg class="thumb" viewBox="0 0 44 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <g transform="translate(44,0) rotate(90)">
    <rect x="0" y="0" width={BOARD.width} height={BOARD.height} class="bg" />
    {#each zones as z, i (z.player + i)}
      <polygon
        points={pts(z.points)}
        class="zone"
        style:fill={z.color ?? "var(--accent)"}
        style:stroke={z.color ?? "var(--accent)"}
      />
    {/each}
    {#if divider}
      <line x1={divider.from.x} y1={divider.from.y} x2={divider.to.x} y2={divider.to.y} class="divider" />
    {/if}
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
  /* Stronger than the full-size board's 0.18/0.7 so the pattern reads at thumb size. */
  .zone {
    fill-opacity: 0.3;
    stroke-opacity: 0.85;
    stroke-width: 0.5;
  }
  .divider {
    stroke: oklch(0.28 0.02 255);
    stroke-width: 0.35;
    stroke-dasharray: 1.4 1.1;
    opacity: 0.8;
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
