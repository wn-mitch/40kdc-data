<script lang="ts">
  import { footprintVertices, upperFloorOf } from "./model.js";
  import type { TerrainTemplate } from "@alpaca-software/40kdc-data";

  interface Props {
    template: TerrainTemplate;
    size?: number;
  }
  let { template, size = 56 }: Props = $props();

  // The canonical (unrotated) footprint. Ground and upper floor are authored in
  // the same local frame, so we draw both raw and let an auto-fit viewBox scale
  // them to the thumbnail box — no manual scale math.
  const verts = $derived(footprintVertices(template.footprint as never) as { x: number; y: number }[]);
  const upperFp = $derived(upperFloorOf(template));
  const upper = $derived(upperFp ? (footprintVertices(upperFp as never) as { x: number; y: number }[]) : []);

  const pts = $derived(verts.map((v) => `${v.x},${v.y}`).join(" "));
  const upperPts = $derived(upper.map((v) => `${v.x},${v.y}`).join(" "));

  const view = $derived.by(() => {
    const all = [...verts, ...upper];
    const xs = all.map((v) => v.x);
    const ys = all.map((v) => v.y);
    const pad = 0.4;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    return `${minX} ${minY} ${w} ${h}`;
  });
</script>

<svg class="thumb" width={size} height={size} viewBox={view} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <polygon points={pts} class="fp {template.kind}" />
  {#if upperPts}
    <polygon points={upperPts} class="upper" />
  {/if}
</svg>

<style>
  .thumb {
    display: block;
  }
  .fp {
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .fp.area {
    fill: var(--piece-area-fill);
    stroke: var(--piece-area-stroke);
  }
  .fp.feature {
    fill: var(--piece-feature-fill);
    stroke: var(--piece-feature-stroke);
  }
  .upper {
    fill: none;
    stroke: var(--text-dim);
    stroke-width: 1;
    stroke-dasharray: 2 1.5;
    vector-effect: non-scaling-stroke;
  }
</style>
