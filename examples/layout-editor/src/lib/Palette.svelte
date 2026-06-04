<script lang="ts">
  import Thumbnail from "./Thumbnail.svelte";
  import SetThumbnail from "./SetThumbnail.svelte";
  import type { TerrainTemplate } from "@alpaca-software/40kdc-data";
  import { TERRAIN_SETS, type TerrainSetDef } from "./sets.js";

  interface Props {
    areas: TerrainTemplate[];
    features: TerrainTemplate[];
    onadd: (t: TerrainTemplate) => void;
    onaddset: (s: TerrainSetDef) => void;
    /** One-click centre-objective macro; disabled when the layout already has one. */
    onaddcenter: (rotated: boolean) => void;
    centerExists?: boolean;
    /** Fired once when a press travels past the drag threshold; the host owns the drag from there. */
    ondragstart?: (t: TerrainTemplate, e: PointerEvent) => void;
    ondragstartset?: (s: TerrainSetDef, e: PointerEvent) => void;
  }
  let {
    areas,
    features,
    onadd,
    onaddset,
    onaddcenter,
    centerExists = false,
    ondragstart,
    ondragstartset,
  }: Props = $props();

  // A press is "armed" until it either travels past the threshold (drag — the
  // host takes over via window listeners) or releases in place (click-to-add,
  // unchanged behavior). Pointer capture keeps move/up coming to the card even
  // after the cursor leaves it; captured events still bubble to window.
  const DRAG_THRESHOLD_PX = 4;
  type Payload = { kind: "template"; t: TerrainTemplate } | { kind: "set"; s: TerrainSetDef };
  let armed: { payload: Payload; x: number; y: number; dragging: boolean } | null = null;

  function down(e: PointerEvent, payload: Payload): void {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    armed = { payload, x: e.clientX, y: e.clientY, dragging: false };
  }
  function move(e: PointerEvent): void {
    if (!armed || armed.dragging) return;
    if (Math.hypot(e.clientX - armed.x, e.clientY - armed.y) > DRAG_THRESHOLD_PX) {
      armed.dragging = true;
      if (armed.payload.kind === "template") ondragstart?.(armed.payload.t, e);
      else ondragstartset?.(armed.payload.s, e);
    }
  }
  function up(): void {
    if (armed && !armed.dragging) {
      if (armed.payload.kind === "template") onadd(armed.payload.t);
      else onaddset(armed.payload.s);
    }
    armed = null;
  }
  function cancel(): void {
    armed = null;
  }
</script>

<div class="palette">
  <h2>Templates</h2>

  <h4>Sets</h4>
  <div class="center-row">
    <button
      class="center-btn"
      disabled={centerExists}
      title={centerExists
        ? "This layout already has a centre objective"
        : "Stamp the interlocked centre trapezoids as a linked centre objective"}
      onclick={() => onaddcenter(false)}
    >
      ◎ Centre ruin
    </button>
    <button
      class="center-btn"
      disabled={centerExists}
      title={centerExists
        ? "This layout already has a centre objective"
        : "Same centre pair, rotated 90°"}
      onclick={() => onaddcenter(true)}
    >
      ◎ 90°
    </button>
  </div>
  <div class="grid">
    {#each TERRAIN_SETS as s (s.id)}
      <button
        class="card set"
        title={s.name}
        onpointerdown={(e) => down(e, { kind: "set", s })}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={cancel}
      >
        <SetThumbnail set={s} />
        <span class="name">{s.name}</span>
      </button>
    {/each}
  </div>

  <h4>Areas</h4>
  <div class="grid">
    {#each areas as t (t.id)}
      <button
        class="card area"
        title={t.name}
        onpointerdown={(e) => down(e, { kind: "template", t })}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={cancel}
      >
        <Thumbnail template={t} />
        <span class="name">{t.name}</span>
      </button>
    {/each}
  </div>

  <h4>Features</h4>
  <div class="grid">
    {#each features as t (t.id)}
      <button
        class="card feature"
        title={t.name}
        onpointerdown={(e) => down(e, { kind: "template", t })}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={cancel}
      >
        <Thumbnail template={t} />
        <span class="name">{t.name}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
  }
  h2 {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  h4 {
    margin: 0.8rem 0 0.4rem;
    color: var(--text-dim);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.5rem 0.35rem 0.4rem;
    background: var(--surface-2);
    border: 1px solid var(--rim);
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-dim);
    font: inherit;
    /* Vertical swipes still scroll the rail; horizontal presses become drags. */
    touch-action: pan-y;
    transition: border-color 120ms ease-out, background 120ms ease-out;
  }
  .card:hover {
    border-color: var(--accent);
    background: var(--accent-fill);
  }
  .card .name {
    font-size: 0.72rem;
    line-height: 1.1;
    text-align: center;
  }
  .card.feature .name {
    color: var(--piece-feature-stroke);
  }
  .card.area .name {
    color: var(--piece-area-stroke);
  }
  .card.set .name {
    color: var(--text-dim);
  }
  .center-row {
    display: flex;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }
  .center-btn {
    flex: 1 1 auto;
    font: inherit;
    font-size: 0.78rem;
    background: var(--surface-2);
    color: var(--text-dim);
    border: 1px solid var(--rim);
    border-radius: 6px;
    padding: 0.35rem 0.4rem;
    cursor: pointer;
  }
  .center-btn:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-fill);
    color: var(--text);
  }
  .center-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
