<script lang="ts">
  import { orientedFootprint, bbox, type EditPiece, type Mirror, type Vec2 } from "./model.js";

  interface Props {
    piece: EditPiece;
    /** Map a pointer event to board coordinates (accounts for the display rotation). */
    toBoard: (e: PointerEvent) => Vec2;
    /** Pixels per board inch, for constant-screen-size handles. */
    pxPerInch: () => number;
    onorient: (patch: { rotation_degrees?: number; mirror?: Mirror }) => void;
  }
  let { piece, toBoard, pxPerInch, onorient }: Props = $props();

  const oriented = $derived(orientedFootprint(piece));
  const box = $derived(oriented ? bbox(oriented.verticesBoard) : null);
  const ppi = $derived(pxPerInch());

  // Sizes in board inches that render to a constant pixel size.
  const px = (n: number): number => n / ppi;

  // Rotate handle sits above the oriented bounding box (board "up" = −y).
  const arm = $derived(px(24));
  const handle = $derived(
    box ? { x: (box.minX + box.maxX) / 2, y: box.minY - arm } : null,
  );
  const armBase = $derived(box ? { x: (box.minX + box.maxX) / 2, y: box.minY } : null);

  let rotating = false;

  function startRotate(e: PointerEvent): void {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    rotating = true;
  }
  function moveRotate(e: PointerEvent): void {
    if (!rotating || !oriented) return;
    const b = toBoard(e);
    const c = oriented.centroid;
    const deg = (Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI;
    // Handle rests straight up (−y → atan2 = −90°), so +90 makes "up" = 0°. The
    // result is the screen-clockwise degree the resolver's rotateCw consumes.
    let rot = deg + 90;
    if (e.shiftKey) rot = Math.round(rot / 15) * 15;
    onorient({ rotation_degrees: ((Math.round(rot) % 360) + 360) % 360 });
  }
  function endRotate(): void {
    rotating = false;
  }

  function toggleMirror(axis: "horizontal" | "vertical", e: Event): void {
    e.stopPropagation();
    onorient({ mirror: piece.mirror === axis ? "none" : axis });
  }
  function keyToggle(axis: "horizontal" | "vertical", e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") toggleMirror(axis, e);
  }
</script>

{#if box && handle && armBase && oriented}
  <g class="handles">
    <!-- rotation arm + grip -->
    <line x1={armBase.x} y1={armBase.y} x2={handle.x} y2={handle.y} class="arm" />
    <circle
      cx={handle.x}
      cy={handle.y}
      r={px(7)}
      class="grip rotate"
      role="slider"
      aria-label="Rotate piece"
      aria-valuenow={Math.round(piece.rotation_degrees)}
      tabindex="0"
      onpointerdown={startRotate}
      onpointermove={moveRotate}
      onpointerup={endRotate}
      onpointercancel={endRotate}
    />

    <!-- flip toggles at the bottom corners of the oriented box -->
    <g
      class="grip flip {piece.mirror === 'horizontal' ? 'on' : ''}"
      role="button"
      aria-label="Flip horizontal"
      tabindex="0"
      onclick={(e) => toggleMirror("horizontal", e)}
      onkeydown={(e) => keyToggle("horizontal", e)}
      onpointerdown={(e) => e.stopPropagation()}
    >
      <rect x={box.minX - px(9)} y={box.maxY + px(2)} width={px(14)} height={px(14)} rx={px(2)} />
      <text x={box.minX - px(2)} y={box.maxY + px(11)} font-size={px(10)}>↔</text>
    </g>
    <g
      class="grip flip {piece.mirror === 'vertical' ? 'on' : ''}"
      role="button"
      aria-label="Flip vertical"
      tabindex="0"
      onclick={(e) => toggleMirror("vertical", e)}
      onkeydown={(e) => keyToggle("vertical", e)}
      onpointerdown={(e) => e.stopPropagation()}
    >
      <rect x={box.maxX - px(5)} y={box.maxY + px(2)} width={px(14)} height={px(14)} rx={px(2)} />
      <text x={box.maxX + px(2)} y={box.maxY + px(11)} font-size={px(10)}>↕</text>
    </g>
  </g>
{/if}

<style>
  .arm {
    stroke: var(--accent);
    stroke-width: 0.07;
  }
  .grip {
    cursor: pointer;
  }
  .grip.rotate {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 0.06;
    cursor: grab;
  }
  .grip.flip rect {
    fill: var(--surface-2);
    stroke: var(--accent);
    stroke-width: 0.06;
  }
  .grip.flip.on rect {
    fill: var(--accent);
  }
  .grip.flip text {
    fill: var(--text);
    text-anchor: middle;
    dominant-baseline: middle;
    pointer-events: none;
    font-family: sans-serif;
  }
</style>
