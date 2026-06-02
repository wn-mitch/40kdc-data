<script lang="ts">
  import { BOARD, type EditLayout, type Vec2 } from "./model.js";
  import type { ResolvedPiece } from "@alpaca-software/40kdc-data";

  interface Props {
    layout: EditLayout;
    resolved: ResolvedPiece[];
    selectedId: string | null;
    onselect: (id: string | null) => void;
    onmove: (id: string, position: Vec2) => void;
  }
  let { layout, resolved, selectedId, onselect, onmove }: Props = $props();

  // viewBox is in board inches (y-down), so resolved vertices map 1:1. We only
  // need pixels-per-inch to translate a pointer drag back into inches.
  let svgEl = $state<SVGSVGElement | null>(null);
  let drag = $state<{ id: string; startX: number; startY: number; origin: Vec2 } | null>(null);

  function pxPerInch(): number {
    const w = svgEl?.getBoundingClientRect().width ?? BOARD.width;
    return w / BOARD.width;
  }

  function points(p: ResolvedPiece): string {
    return p.vertices.map((v) => `${v.x},${v.y}`).join(" ");
  }

  function onPointerDown(e: PointerEvent, p: ResolvedPiece): void {
    if (!p.id) return;
    e.stopPropagation();
    onselect(p.id);
    const piece = layout.pieces.find((q) => q.id === p.id);
    if (!piece) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag = { id: p.id, startX: e.clientX, startY: e.clientY, origin: { ...piece.position } };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const scale = pxPerInch();
    const nx = drag.origin.x + (e.clientX - drag.startX) / scale;
    const ny = drag.origin.y + (e.clientY - drag.startY) / scale;
    onmove(drag.id, {
      x: Math.max(0, Math.min(BOARD.width, Math.round(nx * 100) / 100)),
      y: Math.max(0, Math.min(BOARD.height, Math.round(ny * 100) / 100)),
    });
  }

  function endDrag(): void {
    drag = null;
  }

  // Centroid markers (the stored anchor) for the selected piece.
  const selectedAnchor = $derived(
    selectedId ? layout.pieces.find((p) => p.id === selectedId)?.position ?? null : null,
  );
</script>

<svg
  bind:this={svgEl}
  class="board"
  viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
  preserveAspectRatio="xMidYMid meet"
  role="application"
  aria-label="Terrain board, 60 by 44 inches"
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointerleave={endDrag}
  onpointerdown={() => onselect(null)}
>
  <!-- board + grid -->
  <rect x="0" y="0" width={BOARD.width} height={BOARD.height} class="board-bg" />
  {#each Array(BOARD.width / 6 + 1) as _, i (i)}
    <line x1={i * 6} y1="0" x2={i * 6} y2={BOARD.height} class="grid" />
  {/each}
  {#each Array(BOARD.height / 4 + 1) as _, i (i)}
    <line x1="0" y1={i * 4} x2={BOARD.width} y2={i * 4} class="grid" />
  {/each}

  {#each resolved as p (p.id ?? p.name)}
    <polygon
      points={points(p)}
      class="piece {p.piece_type} {p.id === selectedId ? 'selected' : ''}"
      role="button"
      tabindex="0"
      aria-label={p.name ?? p.id ?? "piece"}
      onpointerdown={(e) => onPointerDown(e, p)}
    />
  {/each}

  {#if selectedAnchor}
    <circle cx={selectedAnchor.x} cy={selectedAnchor.y} r="0.6" class="anchor" />
  {/if}
</svg>

<style>
  .board {
    width: 100%;
    height: auto;
    background: #0b0f14;
    border: 1px solid #243140;
    border-radius: 6px;
    touch-action: none;
  }
  .board-bg {
    fill: #11161d;
  }
  .grid {
    stroke: #1b2530;
    stroke-width: 0.06;
  }
  .piece {
    stroke-width: 0.18;
    cursor: grab;
  }
  .piece.area {
    fill: rgba(56, 132, 222, 0.28);
    stroke: #3884de;
  }
  .piece.feature {
    fill: rgba(222, 160, 56, 0.5);
    stroke: #dea038;
  }
  .piece.selected {
    stroke: #f4f6f8;
    stroke-width: 0.32;
  }
  .anchor {
    fill: #f4f6f8;
    stroke: #0b0f14;
    stroke-width: 0.12;
    pointer-events: none;
  }
</style>
