<script lang="ts">
  /**
   * A scannable QR code rendered as a crisp inline SVG (dark modules on a light
   * quiet zone). Built from the module grid directly — no `{@html}` — so it
   * scales sharply and styles cleanly. `qrcode-generator` is dependency-free
   * and only pulled in here.
   */
  import qrcode from "qrcode-generator";

  let { value, size = 220 }: { value: string; size?: number } = $props();

  // Quiet zone (light border) in modules; the spec recommends ~4 for reliable
  // scanning.
  const MARGIN = 4;

  const model = $derived.by(() => {
    const qr = qrcode(0, "M"); // auto type number, medium error correction
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const cells: { x: number; y: number }[] = [];
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) cells.push({ x: c, y: r });
      }
    }
    return { count, cells };
  });

  const span = $derived(model.count + MARGIN * 2);
</script>

<svg
  width={size}
  height={size}
  viewBox="{-MARGIN} {-MARGIN} {span} {span}"
  shape-rendering="crispEdges"
  role="img"
  aria-label="QR code for the share link"
>
  <rect x={-MARGIN} y={-MARGIN} width={span} height={span} fill="#ffffff" />
  {#each model.cells as cell (cell.y * model.count + cell.x)}
    <rect x={cell.x} y={cell.y} width="1" height="1" fill="#000000" />
  {/each}
</svg>
