<script lang="ts">
  import Handles from "./Handles.svelte";
  import {
    BOARD,
    BOARD_CENTER,
    orientedFootprint,
    upperFloorBoardVerts,
    isGroundBlocked,
    bbox,
    keystoneDisplays,
    type EditLayout,
    type EditPiece,
    type Mirror,
    type Vec2,
    type SolverRef,
    type SolverViz,
    type OrientedFootprint,
    type DeployZone,
    type TerritoryDivider,
    type ObjectiveMarker,
  } from "./model.js";
  import type { ResolvedPiece } from "@alpaca-software/40kdc-data";

  interface Props {
    layout: EditLayout;
    resolved: ResolvedPiece[];
    selectedId: string | null;
    selectedPiece: EditPiece | null;
    solver: SolverViz;
    zones: DeployZone[];
    divider: TerritoryDivider | null;
    markers: ObjectiveMarker[];
    /** Draw the pinned keystone dimension lines (the pins themselves stay on the pieces). */
    showKeystones?: boolean;
    onselect: (id: string | null) => void;
    onmove: (id: string, position: Vec2) => void;
    onorient: (id: string, patch: { rotation_degrees?: number; mirror?: Mirror }) => void;
  }
  let {
    layout,
    resolved,
    selectedId,
    selectedPiece,
    solver,
    zones,
    divider,
    markers,
    showKeystones = true,
    onselect,
    onmove,
    onorient,
  }: Props = $props();

  // The board is shown rotated 90° CW for portrait terrain cards. Board coords stay
  // 60×44 y-down; the content group carries the rotation, and we map pointers back
  // through its CTM so all geometry stays in true board space.
  let gEl = $state<SVGGElement | null>(null);
  let svgEl = $state<SVGSVGElement | null>(null);
  let drag = $state<{ id: string; offset: Vec2 } | null>(null);

  /**
   * Map a client-space point into board inches, for drops that originate
   * outside this component (palette drag). Null when the point is not over
   * the board svg — the caller treats that as "cancel".
   */
  export function clientToBoard(clientX: number, clientY: number): Vec2 | null {
    const ctm = gEl?.getScreenCTM();
    if (!ctm || !svgEl) return null;
    const r = svgEl.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function toBoard(e: PointerEvent): Vec2 {
    const ctm = gEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }
  function pxPerInch(): number {
    const ctm = gEl?.getScreenCTM();
    return ctm ? Math.hypot(ctm.a, ctm.b) : 12;
  }
  /** Board (x,y) → display, matching the group's translate(BOARD.height,0) rotate(90), for upright labels. */
  function toDisplay(b: Vec2): Vec2 {
    return { x: BOARD.height - b.y, y: b.x };
  }
  const clamp = (n: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(n * 100) / 100));

  function onPointerDown(e: PointerEvent, p: ResolvedPiece): void {
    if (!p.id) return;
    e.stopPropagation();
    onselect(p.id);
    const piece = layout.pieces.find((q) => q.id === p.id);
    if (!piece) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const b = toBoard(e);
    // Drag in board space; for a parented feature the stored centroid is
    // area-local, so anchor the grab offset to its board-space centroid.
    const c = orientedFootprint(piece, layout)?.centroid ?? piece.position;
    drag = { id: p.id, offset: { x: b.x - c.x, y: b.y - c.y } };
  }
  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const b = toBoard(e);
    onmove(drag.id, { x: clamp(b.x - drag.offset.x, BOARD.width), y: clamp(b.y - drag.offset.y, BOARD.height) });
  }
  function endDrag(): void {
    drag = null;
  }

  const pts = (p: ResolvedPiece): string => p.vertices.map((v) => `${v.x},${v.y}`).join(" ");
  const polyPts = (vs: Vec2[]): string => vs.map((v) => `${v.x},${v.y}`).join(" ");

  const twinId = $derived(selectedPiece?.twin_id ?? null);
  const editById = $derived(new Map(layout.pieces.map((p) => [p.id, p])));

  // Upper-floor platforms across the layout (dashed overlays).
  const uppers = $derived(
    layout.pieces
      .map((p) => ({ id: p.id, verts: upperFloorBoardVerts(p, layout) }))
      .filter((u): u is { id: string; verts: Vec2[] } => !!u.verts),
  );

  const selOriented = $derived<OrientedFootprint | null>(
    selectedPiece ? orientedFootprint(selectedPiece, layout) : null,
  );

  function refPoint(o: OrientedFootprint, ref: SolverRef): Vec2 {
    if (ref.kind === "vertex") return o.verticesBoard[ref.index] ?? o.centroid;
    const b = bbox(o.verticesBoard);
    if (ref.side === "min-x") return { x: b.minX, y: (b.minY + b.maxY) / 2 };
    if (ref.side === "max-x") return { x: b.maxX, y: (b.minY + b.maxY) / 2 };
    if (ref.side === "min-y") return { x: (b.minX + b.maxX) / 2, y: b.minY };
    return { x: (b.minX + b.maxX) / 2, y: b.maxY };
  }
  function faceSeg(o: OrientedFootprint, side: string): [Vec2, Vec2] {
    const b = bbox(o.verticesBoard);
    if (side === "min-x") return [{ x: b.minX, y: b.minY }, { x: b.minX, y: b.maxY }];
    if (side === "max-x") return [{ x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }];
    if (side === "min-y") return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }];
    return [{ x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY }];
  }
  function guide(o: OrientedFootprint, line: SolverViz["lines"][number]) {
    const t = refPoint(o, line.ref);
    const from: Vec2 =
      line.edge === "left"
        ? { x: 0, y: t.y }
        : line.edge === "right"
          ? { x: BOARD.width, y: t.y }
          : line.edge === "top"
            ? { x: t.x, y: 0 }
            : { x: t.x, y: BOARD.height };
    return { from, to: t, mid: { x: (from.x + t.x) / 2, y: (from.y + t.y) / 2 }, text: `${line.distance}″` };
  }

  // Persisted keystones — the card's printed dimension lines — render for
  // EVERY piece, always, with live derived distances. Solid amber, unlike the
  // dashed teal solver guides (which are ephemeral and selection-scoped). An
  // unmeasurable keystone (stale vertex index after a footprint change) draws
  // its anchor with a "?" label instead of crashing.
  const keystoneGuides = $derived.by(() => {
    const out: { from: Vec2; to: Vec2; mid: Vec2; text: string; invalid: boolean }[] = [];
    if (!showKeystones) return out;
    const byPiece = new Map(layout.pieces.map((p) => [p.id, p]));
    for (const d of keystoneDisplays(layout)) {
      const p = byPiece.get(d.pieceId);
      if (!p) continue;
      const o = orientedFootprint(p, layout);
      if (!o) continue;
      const t = refPoint(o, d.keystone.ref);
      const from: Vec2 =
        d.keystone.edge === "left"
          ? { x: 0, y: t.y }
          : d.keystone.edge === "right"
            ? { x: BOARD.width, y: t.y }
            : d.keystone.edge === "top"
              ? { x: t.x, y: 0 }
              : { x: t.x, y: BOARD.height };
      out.push({
        from,
        to: t,
        mid: { x: (from.x + t.x) / 2, y: (from.y + t.y) / 2 },
        text: d.distance != null ? `${Math.round(d.distance * 100) / 100}″` : "?",
        invalid: d.distance == null,
      });
    }
    return out;
  });

  // Edge labels named for where they sit ON SCREEN after the portrait rotation,
  // with the board coordinate they pin as a suffix (board x0 runs along the top of
  // the card, x60 along the bottom; y44/y0 are the left/right ends).
  const edgeLabels = $derived([
    { at: toDisplay({ x: 1.4, y: BOARD.height / 2 }), text: "top · x0" },
    { at: toDisplay({ x: BOARD.width - 1.4, y: BOARD.height / 2 }), text: "bottom · x60" },
    { at: toDisplay({ x: BOARD.width / 2, y: BOARD.height - 0.8 }), text: "left · y44" },
    { at: toDisplay({ x: BOARD.width / 2, y: 0.8 }), text: "right · y0" },
  ]);
</script>

<svg
  bind:this={svgEl}
  class="board"
  viewBox="0 0 44 60"
  preserveAspectRatio="xMidYMid meet"
  role="application"
  aria-label="Terrain board, 60 by 44 inches, shown portrait"
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointerleave={endDrag}
  onpointerdown={() => onselect(null)}
>
  <g class="board-layer" bind:this={gEl} transform="translate(44,0) rotate(90)">
    <rect x="0" y="0" width={BOARD.width} height={BOARD.height} class="board-bg" />

    <!-- deployment zones (under the grid, like the printed card) -->
    {#each zones as z, i (z.player + i)}
      <polygon
        points={z.points.map((p) => `${p.x},${p.y}`).join(" ")}
        class="zone"
        style:fill={z.color ?? "var(--accent)"}
        style:stroke={z.color ?? "var(--accent)"}
      />
    {/each}

    <!-- 1" grid with honor lines every 5" -->
    {#each Array(BOARD.width + 1) as _, i (i)}
      <line x1={i} y1="0" x2={i} y2={BOARD.height} class="grid {i % 5 === 0 ? 'major' : 'minor'}" />
    {/each}
    {#each Array(BOARD.height + 1) as _, i (i)}
      <line x1="0" y1={i} x2={BOARD.width} y2={i} class="grid {i % 5 === 0 ? 'major' : 'minor'}" />
    {/each}

    <!-- centre of symmetry -->
    <line x1={BOARD_CENTER.x - 1} y1={BOARD_CENTER.y} x2={BOARD_CENTER.x + 1} y2={BOARD_CENTER.y} class="centre" />
    <line x1={BOARD_CENTER.x} y1={BOARD_CENTER.y - 1} x2={BOARD_CENTER.x} y2={BOARD_CENTER.y + 1} class="centre" />

    <!-- territory divider: the dashed line splitting the two players' halves -->
    {#if divider}
      <line x1={divider.from.x} y1={divider.from.y} x2={divider.to.x} y2={divider.to.y} class="divider" />
    {/if}

    {#each resolved as p (p.id ?? p.name)}
      {@const ep = p.id ? editById.get(p.id) : undefined}
      <polygon
        points={pts(p)}
        class="piece {p.piece_type} {p.id === selectedId ? 'selected' : ''} {p.id === twinId
          ? 'twin'
          : ''} {ep && isGroundBlocked(ep) ? 'blocked' : ''}"
        role="button"
        tabindex="0"
        aria-label={p.name ?? p.id ?? "piece"}
        onpointerdown={(e) => onPointerDown(e, p)}
      />
    {/each}

    {#each uppers as u (u.id)}
      <polygon points={polyPts(u.verts)} class="upper" />
    {/each}

    <!-- objective markers: one ring per objective (a link_group union is one) -->
    {#each markers as m, i (i)}
      <circle cx={m.at.x} cy={m.at.y} r="1.5" class="objective-ring" />
      <circle cx={m.at.x} cy={m.at.y} r="0.25" class="objective-dot" />
    {/each}

    <!-- persisted keystones: the card's printed dimension lines, every piece -->
    {#each keystoneGuides as g, gi (gi)}
      <line x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} class="keystone {g.invalid ? 'invalid' : ''}" />
      <circle cx={g.to.x} cy={g.to.y} r="0.35" class="keystone-dot {g.invalid ? 'invalid' : ''}" />
    {/each}

    <!-- solver indicators on the selected piece -->
    {#if selOriented}
      {#if solver.hover}
        {#if solver.hover.kind === "vertex"}
          {@const v = selOriented.verticesBoard[solver.hover.index]}
          {#if v}<circle cx={v.x} cy={v.y} r="0.7" class="ind hover" />{/if}
        {:else}
          {@const seg = faceSeg(selOriented, solver.hover.side)}
          <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} class="ind-edge hover" />
        {/if}
      {/if}
      <!-- keyed by index: triangulation lines can share a board edge -->
      {#each solver.lines as line, li (li)}
        <!-- always mark the selected feature so it's clear which corner/face the
             dimension draws to, even before a distance is typed -->
        {#if line.ref.kind === "vertex"}
          {@const v = selOriented.verticesBoard[line.ref.index]}
          {#if v}<circle cx={v.x} cy={v.y} r="0.5" class="ind active" />{/if}
        {:else}
          {@const seg = faceSeg(selOriented, line.ref.side)}
          <line x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} class="ind-edge active" />
        {/if}
        {#if line.distance}
          {@const g = guide(selOriented, line)}
          <line x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} class="measure" />
        {/if}
      {/each}

      <circle cx={selOriented.centroid.x} cy={selOriented.centroid.y} r="0.3" class="anchor" />
    {/if}

    {#if selectedPiece}
      <Handles piece={selectedPiece} {layout} {toBoard} {pxPerInch} onorient={(patch) => onorient(selectedPiece.id, patch)} />
    {/if}
  </g>

  <!-- upright label layer (not rotated) -->
  <g class="labels">
    {#each edgeLabels as l (l.text)}
      <text x={l.at.x} y={l.at.y} class="edge-label">{l.text}</text>
    {/each}
    {#if divider}
      {#each divider.badges as b, i (i)}
        {@const d = toDisplay(b.at)}
        <circle cx={d.x} cy={d.y} r="1.4" class="terr-badge" style:fill={b.color} />
        <text x={d.x} y={d.y} class="terr-badge-text">{b.player}</text>
      {/each}
    {/if}
    {#each markers as m, i (i)}
      {#if m.role}
        {@const d = toDisplay(m.at)}
        <text x={d.x} y={d.y - 2.1} class="objective-label">{m.role}</text>
      {/if}
    {/each}
    {#if selOriented}
      {#each solver.lines as line, li (li)}
        {#if line.distance}
          {@const g = guide(selOriented, line)}
          {@const d = toDisplay(g.mid)}
          <text x={d.x} y={d.y} class="measure-label">{g.text}</text>
        {/if}
      {/each}
    {/if}
    {#each keystoneGuides as g, gi (gi)}
      {@const d = toDisplay(g.mid)}
      <text x={d.x} y={d.y} class="keystone-label {g.invalid ? 'invalid' : ''}">{g.text}</text>
    {/each}
  </g>
</svg>

<style>
  .board {
    width: 100%;
    height: 100%;
    background: var(--bg);
    border: 1px solid var(--rim);
    border-radius: 6px;
    touch-action: none;
    display: block;
  }
  /* A light tabletop surface so terrain, zones and grid read against the dark chrome. */
  .board-bg {
    fill: oklch(0.74 0.008 220);
  }
  .grid.minor {
    stroke: oklch(0.62 0.01 220);
    stroke-width: 0.035;
  }
  .grid.major {
    stroke: oklch(0.42 0.02 235);
    stroke-width: 0.09;
  }
  .zone {
    fill-opacity: 0.18;
    stroke-opacity: 0.7;
    stroke-width: 0.25;
    pointer-events: none;
  }
  .centre {
    stroke: oklch(0.34 0.03 25);
    stroke-width: 0.12;
    opacity: 0.8;
  }
  .divider {
    stroke: oklch(0.28 0.02 255);
    stroke-width: 0.18;
    stroke-dasharray: 0.9 0.7;
    opacity: 0.85;
    pointer-events: none;
  }
  .objective-ring {
    fill: oklch(0.75 0.14 85 / 0.12);
    stroke: oklch(0.55 0.13 85);
    stroke-width: 0.18;
    pointer-events: none;
  }
  .objective-dot {
    fill: oklch(0.45 0.13 85);
    pointer-events: none;
  }
  .objective-label {
    fill: oklch(0.42 0.12 85);
    font-size: 1.3px;
    font-weight: 600;
    text-anchor: middle;
    font-family: "JetBrains Mono", monospace;
    paint-order: stroke;
    stroke: oklch(0.85 0.008 220);
    stroke-width: 0.4px;
    pointer-events: none;
  }
  .terr-badge {
    stroke: oklch(0.97 0.01 220);
    stroke-width: 0.18;
    pointer-events: none;
  }
  .terr-badge-text {
    fill: oklch(0.98 0.01 220);
    font-size: 1.6px;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    font-family: "Barlow Condensed", sans-serif;
    pointer-events: none;
  }
  .piece {
    stroke-width: 0.18;
    cursor: grab;
  }
  .piece:focus {
    outline: none;
  }
  .piece:focus-visible {
    outline: none;
    stroke: var(--accent-strong);
    stroke-width: 0.32;
  }
  /* Piece colours are tuned for the light tabletop surface (distinct from the
     dark-card thumbnails, which keep the token palette). */
  .piece.area {
    fill: oklch(0.55 0.15 258 / 0.42);
    stroke: oklch(0.42 0.16 262);
  }
  .piece.feature {
    fill: oklch(0.68 0.15 62 / 0.55);
    stroke: oklch(0.5 0.16 58);
  }
  .piece.blocked {
    stroke-dasharray: 0.5 0.4;
  }
  .piece.twin {
    stroke: oklch(0.52 0.13 195);
    stroke-width: 0.26;
    stroke-dasharray: 0.6 0.4;
  }
  .piece.selected {
    stroke: oklch(0.48 0.15 195);
    stroke-width: 0.36;
  }
  .upper {
    fill: none;
    stroke: oklch(0.4 0.02 255);
    stroke-width: 0.1;
    stroke-dasharray: 0.5 0.35;
    pointer-events: none;
  }
  .anchor {
    fill: oklch(0.25 0.02 220);
    stroke: oklch(0.96 0.01 220);
    stroke-width: 0.08;
    pointer-events: none;
  }
  .ind {
    pointer-events: none;
  }
  .ind.hover {
    fill: oklch(0.52 0.14 195);
    opacity: 0.7;
  }
  .ind.active {
    fill: oklch(0.42 0.15 195);
  }
  .ind-edge {
    pointer-events: none;
    fill: none;
  }
  .ind-edge.hover {
    stroke: oklch(0.52 0.14 195);
    stroke-width: 0.4;
    opacity: 0.7;
  }
  .ind-edge.active {
    stroke: oklch(0.42 0.15 195);
    stroke-width: 0.4;
  }
  .measure {
    stroke: oklch(0.4 0.15 195);
    stroke-width: 0.14;
    stroke-dasharray: 0.4 0.3;
    pointer-events: none;
  }
  /* Persisted keystones — solid amber, distinct from the dashed teal solver
     guides. `.invalid` marks a keystone whose ref no longer measures. */
  .keystone {
    stroke: oklch(0.55 0.13 70);
    stroke-width: 0.16;
    pointer-events: none;
  }
  .keystone-dot {
    fill: oklch(0.55 0.13 70);
    pointer-events: none;
  }
  .keystone.invalid,
  .keystone-dot.invalid {
    stroke: oklch(0.55 0.18 25);
    fill: oklch(0.55 0.18 25);
  }
  .keystone-label {
    fill: oklch(0.45 0.13 70);
    font-size: 1.5px;
    font-weight: 600;
    text-anchor: middle;
    font-family: "JetBrains Mono", monospace;
    paint-order: stroke;
    stroke: oklch(0.82 0.008 220);
    stroke-width: 0.3px;
    pointer-events: none;
  }
  .keystone-label.invalid {
    fill: oklch(0.5 0.18 25);
  }
  .edge-label {
    fill: oklch(0.32 0.02 235);
    font-size: 1.1px;
    text-anchor: middle;
    font-family: "JetBrains Mono", monospace;
    paint-order: stroke;
    stroke: oklch(0.82 0.008 220);
    stroke-width: 0.35px;
    pointer-events: none;
  }
  .measure-label {
    fill: oklch(0.34 0.15 195);
    font-size: 1.7px;
    font-weight: 600;
    text-anchor: middle;
    font-family: "JetBrains Mono", monospace;
    paint-order: stroke;
    stroke: oklch(0.85 0.008 220);
    stroke-width: 0.55px;
    pointer-events: none;
  }
</style>
