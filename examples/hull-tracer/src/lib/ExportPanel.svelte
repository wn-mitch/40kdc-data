<script lang="ts">
  import { boundsSize, isValidEntityId, slugify } from "./geometry.js";
  import { buildHullShape, hullShapeFileText, EXPORT_FILENAME } from "./export.js";
  import { DEFAULT_GAME_VERSION, type Vec2 } from "./types.js";

  let {
    pixelPoints,
    closed,
    pxPerInch,
  }: {
    pixelPoints: Vec2[];
    closed: boolean;
    pxPerInch: number | null;
  } = $props();

  let name = $state("");
  let id = $state("");
  let idEdited = $state(false);
  let edition = $state(DEFAULT_GAME_VERSION.edition);
  let dataslate = $state(DEFAULT_GAME_VERSION.dataslate);
  let copied = $state(false);

  // Auto-derive the id from the name until the author overrides it by hand.
  $effect(() => {
    if (!idEdited) id = slugify(name);
  });

  const idOk = $derived(isValidEntityId(id));
  const hasPolygon = $derived(closed && pixelPoints.length >= 3);
  const scaled = $derived(pxPerInch !== null && pxPerInch > 0);
  const nameOk = $derived(name.trim().length > 0);
  const canExport = $derived(hasPolygon && scaled && idOk && nameOk);

  const shape = $derived.by(() => {
    if (!canExport || pxPerInch === null) return null;
    return buildHullShape({
      id,
      name: name.trim(),
      pixelPoints,
      pxPerInch,
      gameVersion: { edition, dataslate },
    });
  });

  const preview = $derived(shape ? hullShapeFileText(shape) : "");

  // A live size readout even before the export gate opens, so the author can
  // sanity-check the scale while tracing.
  const liveSize = $derived.by(() => {
    if (pxPerInch === null || pxPerInch <= 0 || pixelPoints.length < 1) return null;
    const inches = pixelPoints.map((p) => ({ x: p.x / pxPerInch!, y: p.y / pxPerInch! }));
    return boundsSize(inches);
  });

  function download(): void {
    if (!shape) return;
    const blob = new Blob([preview], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = EXPORT_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copy(): Promise<void> {
    if (!preview) return;
    await navigator.clipboard.writeText(preview);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="export">
  <label class="field">
    <span>Name</span>
    <input bind:value={name} placeholder="Battle Hauler Chassis" class="focus-ring" />
  </label>

  <label class="field">
    <span>Entity id</span>
    <input
      bind:value={id}
      oninput={() => (idEdited = true)}
      placeholder="battle-hauler-chassis"
      class="focus-ring"
      class:invalid={id.length > 0 && !idOk}
    />
    {#if id.length > 0 && !idOk}
      <small class="err">Must be kebab-case, 2–128 chars (a–z, 0–9, dashes).</small>
    {/if}
  </label>

  <div class="gv">
    <label class="field">
      <span>Edition</span>
      <input bind:value={edition} class="focus-ring" />
    </label>
    <label class="field">
      <span>Dataslate</span>
      <input bind:value={dataslate} class="focus-ring" />
    </label>
  </div>

  <ul class="checklist">
    <li class:ok={hasPolygon}>{hasPolygon ? "✓" : "•"} Closed polygon (≥3 points)</li>
    <li class:ok={scaled}>{scaled ? "✓" : "•"} Scale calibrated</li>
    <li class:ok={nameOk}>{nameOk ? "✓" : "•"} Name set</li>
    <li class:ok={idOk}>{idOk ? "✓" : "•"} Valid id</li>
  </ul>

  {#if liveSize}
    <div class="size">
      bounds {liveSize.width.toFixed(2)}″ × {liveSize.height.toFixed(2)}″
    </div>
  {/if}

  <div class="actions">
    <button class="primary focus-ring" disabled={!canExport} onclick={download}>
      Download JSON
    </button>
    <button class="ghost focus-ring" disabled={!canExport} onclick={copy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  </div>

  {#if preview}
    <pre class="preview" aria-label="hull-shape JSON preview">{preview}</pre>
  {/if}

  <p class="firewall">
    The export contains only the polygon, its bounds, and the ids you entered — never the image or
    any link to it.
  </p>
</div>

<style>
  .export {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-muted);
  }
  .field input {
    padding: 6px 8px;
    background: var(--color-panel);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-family: var(--font-mono);
  }
  .field input.invalid {
    border-color: var(--color-danger);
  }
  .gv {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .err {
    color: var(--color-danger);
    font-size: 11px;
  }
  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }
  .checklist li.ok {
    color: var(--color-success);
  }
  .size {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    flex: 1;
    padding: 9px 12px;
    border-radius: var(--radius-md);
    font-family: var(--font-heading);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    font-size: 13px;
  }
  .primary {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    border: 0;
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }
  .ghost {
    background: transparent;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border-strong);
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .preview {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    padding: 10px;
    background: var(--color-bg-dark);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: pre;
  }
  .firewall {
    margin: 0;
    font-size: 11px;
    color: var(--color-text-dim);
    line-height: 1.4;
  }
</style>
