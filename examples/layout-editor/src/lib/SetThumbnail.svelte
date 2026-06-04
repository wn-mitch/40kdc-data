<script lang="ts">
  import { templateById, orientedOffsets } from "./model.js";
  import type { TerrainSetDef } from "./sets.js";

  /**
   * Composite thumbnail for a terrain set: the area footprint centred at the
   * origin with each feature's oriented footprint at its area-local placement —
   * the same frame the stamp uses, so the preview is exactly what lands.
   */
  interface Props {
    set: TerrainSetDef;
    size?: number;
  }
  let { set, size = 56 }: Props = $props();

  interface Poly {
    kind: "area" | "feature";
    points: { x: number; y: number }[];
  }

  const polys = $derived.by((): Poly[] => {
    const out: Poly[] = [];
    const areaTmpl = templateById(set.area.template);
    if (areaTmpl) {
      out.push({
        kind: "area",
        points: orientedOffsets(areaTmpl.footprint, set.area.rotation ?? 0, "none"),
      });
    }
    for (const f of set.features) {
      const ft = templateById(f.template);
      if (!ft) continue;
      out.push({
        kind: "feature",
        points: orientedOffsets(ft.footprint, f.rotation, f.mirror ?? "none").map((o) => ({
          x: o.x + f.position.x,
          y: o.y + f.position.y,
        })),
      });
    }
    return out;
  });

  const view = $derived.by(() => {
    const all = polys.flatMap((p) => p.points);
    if (all.length === 0) return "0 0 1 1";
    const xs = all.map((v) => v.x);
    const ys = all.map((v) => v.y);
    const pad = 0.4;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    return `${minX} ${minY} ${w} ${h}`;
  });

  const pts = (vs: { x: number; y: number }[]): string => vs.map((v) => `${v.x},${v.y}`).join(" ");
</script>

<svg class="thumb" width={size} height={size} viewBox={view} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  {#each polys as p, i (i)}
    <polygon points={pts(p.points)} class="fp {p.kind}" />
  {/each}
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
</style>
