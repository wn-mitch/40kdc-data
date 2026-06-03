<script lang="ts">
  import {
    BOARD,
    footprintOf,
    footprintVertices,
    solveCentroid,
    solveCentroidTriangulated,
    templateById,
    type EditPiece,
    type Mirror,
    type SolverRef,
    type SolverLine,
    type ObjectiveRole,
  } from "./model.js";

  interface Props {
    piece: EditPiece | null;
    /** The selected piece's board-space centroid (so the fields read board inches even when parented). */
    boardPos: { x: number; y: number };
    /** Area pieces the selected feature may be anchored to. */
    areaOptions: { id: string; name: string }[];
    ondelete: (id: string) => void;
    onmove: (id: string, position: { x: number; y: number }) => void;
    onorient: (id: string, patch: { rotation_degrees?: number; mirror?: Mirror }) => void;
    onlinkgroup: (id: string, group: string | undefined) => void;
    onparent: (id: string, parentId: string | undefined) => void;
    onobjectiverole: (id: string, role: ObjectiveRole | undefined) => void;
    onsnapcenter: (id: string) => void;
    onsnapcorner: (id: string) => void;
    onsolverhover: (ref: SolverRef | null) => void;
    onsolverlines: (lines: SolverLine[]) => void;
  }
  let {
    piece,
    boardPos,
    areaOptions,
    ondelete,
    onmove,
    onorient,
    onlinkgroup,
    onparent,
    onobjectiverole,
    onsnapcenter,
    onsnapcorner,
    onsolverhover,
    onsolverlines,
  }: Props = $props();

  // The card is shown portrait (board rotated 90° CW), so the card's own
  // left/right run along the board Y axis and its top/bottom along board X — the
  // same orientation the edge labels now use. The solver below speaks in CARD
  // directions and maps them to the board edges `solveCentroid` expects:
  //   card left  → board y=44 (solver "bottom")   card right → board y=0  (solver "top")
  //   card top   → board x=0  (solver "left")      card bottom→ board x=60 (solver "right")
  type CardEdge = "left" | "right" | "top" | "bottom";
  const toBoardEdge = (e: CardEdge): SolverLine["edge"] =>
    e === "left" ? "bottom" : e === "right" ? "top" : e === "top" ? "left" : "right";

  type FeatureChoice = { label: string; ref: SolverRef };
  // `line: "h"` is a horizontal card dimension (from a left/right edge, pins
  // board Y); `line: "v"` is vertical (top/bottom edge, pins board X). Faces are
  // named for the card and map to the matching board face.
  function featureChoices(line: "h" | "v"): FeatureChoice[] {
    if (!piece) return [];
    const fp = footprintOf(piece);
    if (!fp) return [];
    const n = footprintVertices(fp as never).length;
    const faces: FeatureChoice[] =
      line === "h"
        ? [
            { label: "left face", ref: { kind: "face", side: "max-y" } },
            { label: "right face", ref: { kind: "face", side: "min-y" } },
          ]
        : [
            { label: "top face", ref: { kind: "face", side: "min-x" } },
            { label: "bottom face", ref: { kind: "face", side: "max-x" } },
          ];
    const verts: FeatureChoice[] = Array.from({ length: n }, (_, i) => ({
      label: `v${i}`,
      ref: { kind: "vertex", index: i },
    }));
    return [...faces, ...verts];
  }
  const hFeatures = $derived(featureChoices("h"));
  const vFeatures = $derived(featureChoices("v"));

  // Solver form state, in card directions.
  let solverMode = $state<"two" | "three">("two");
  let hEdge = $state<"left" | "right">("left");
  let hDist = $state<number>(0);
  let hRef = $state<SolverRef>({ kind: "face", side: "max-y" });
  let vEdge = $state<"top" | "bottom">("top");
  let vDist = $state<number>(0);
  let vRef = $state<SolverRef>({ kind: "face", side: "min-x" });
  let solveError = $state<string | null>(null);

  // Triangulation (3-corner) state — each row measures from a card edge to a
  // specific vertex; together they solve position AND angle for a rotated piece.
  let tri = $state<{ edge: CardEdge; dist: number; vertex: number }[]>([
    { edge: "left", dist: 0, vertex: 0 },
    { edge: "left", dist: 0, vertex: 1 },
    { edge: "top", dist: 0, vertex: 0 },
  ]);
  const vertexCount = $derived.by(() => {
    if (!piece) return 0;
    const fp = footprintOf(piece);
    return fp ? footprintVertices(fp as never).length : 0;
  });

  const sameRef = (a: SolverRef, b: SolverRef): boolean =>
    a.kind === "vertex" && b.kind === "vertex"
      ? a.index === b.index
      : a.kind === "face" && b.kind === "face"
        ? a.side === b.side
        : false;

  // Push the current dimension lines (in board-edge terms) to the board so the
  // guides track live — two lines in known-angle mode, three in triangulation.
  $effect(() => {
    if (solverMode === "three") {
      onsolverlines(
        tri.map((t) => ({
          edge: toBoardEdge(t.edge),
          distance: t.dist,
          ref: { kind: "vertex", index: t.vertex },
        })),
      );
    } else {
      onsolverlines([
        { edge: toBoardEdge(hEdge), distance: hDist, ref: hRef },
        { edge: toBoardEdge(vEdge), distance: vDist, ref: vRef },
      ]);
    }
  });

  function solve(): void {
    solveError = null;
    if (!piece) return;
    const fp = footprintOf(piece);
    if (!fp) {
      solveError = "piece has no footprint to solve against";
      return;
    }
    try {
      const pos = solveCentroid({
        footprint: fp as never,
        rotation: piece.rotation_degrees,
        mirror: piece.mirror,
        board: { width: BOARD.width, height: BOARD.height },
        lines: [
          { edge: toBoardEdge(hEdge), distance: hDist, feature: hRef },
          { edge: toBoardEdge(vEdge), distance: vDist, feature: vRef },
        ],
      });
      onmove(piece.id, { x: Math.round(pos.x * 1e4) / 1e4, y: Math.round(pos.y * 1e4) / 1e4 });
    } catch (e) {
      solveError = (e as Error).message;
    }
  }

  // Triangulate position + angle from three corner measurements. The solved
  // rotation is the piece's board orientation — intended for top-level (area)
  // pieces; the current rotation seeds which of the two angle roots is taken.
  function solveTriangulatedPlace(): void {
    solveError = null;
    if (!piece) return;
    const fp = footprintOf(piece);
    if (!fp) {
      solveError = "piece has no footprint to solve against";
      return;
    }
    try {
      const res = solveCentroidTriangulated({
        footprint: fp as never,
        mirror: piece.mirror,
        board: { width: BOARD.width, height: BOARD.height },
        lines: tri.map((t) => ({
          edge: toBoardEdge(t.edge),
          distance: t.dist,
          vertex: t.vertex,
        })) as never,
        rotationHint: piece.rotation_degrees,
      });
      onorient(piece.id, { rotation_degrees: Math.round(res.rotation * 100) / 100 });
      onmove(piece.id, { x: Math.round(res.x * 1e4) / 1e4, y: Math.round(res.y * 1e4) / 1e4 });
    } catch (e) {
      solveError = (e as Error).message;
    }
  }

  const templateName = $derived(
    piece?.template ? templateById(piece.template)?.name ?? piece.template : "(inline footprint)",
  );
  const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);
</script>

{#if !piece}
  <p class="empty">Select a piece on the board, or add one from the palette.</p>
{:else}
  <div class="inspector">
    <header>
      <h3>{piece.name ?? piece.id}</h3>
      <button class="danger" onclick={() => ondelete(piece.id)}>Delete pair</button>
    </header>
    <dl class="meta">
      <dt>id</dt>
      <dd>{piece.id}</dd>
      <dt>type</dt>
      <dd>{piece.piece_type}</dd>
      <dt>template</dt>
      <dd>{templateName}</dd>
      <dt>twin</dt>
      <dd>{piece.twin_id ?? "— (independent)"}</dd>
      {#if piece.piece_type === "feature"}
        <dt>parent</dt>
        <dd>{piece.parent_area_id ?? "— (board)"}</dd>
      {/if}
      {#if piece.piece_type === "area"}
        <dt>objective</dt>
        <dd>{piece.objective_role ?? (piece.is_objective ? "yes" : "—")}</dd>
      {/if}
    </dl>

    <fieldset>
      <legend>Placement</legend>
      <label
        >centroid x
        <input type="number" step="0.05" value={boardPos.x} oninput={(e) => onmove(piece.id, { x: num(e), y: boardPos.y })} /></label
      >
      <label
        >centroid y
        <input type="number" step="0.05" value={boardPos.y} oninput={(e) => onmove(piece.id, { x: boardPos.x, y: num(e) })} /></label
      >
      <label
        >rotation°
        <input type="number" step="1" min="0" max="359" value={piece.rotation_degrees} oninput={(e) => onorient(piece.id, { rotation_degrees: num(e) })} /></label
      >
      <div class="snaps">
        {#each [0, 90, 180, 270] as deg (deg)}
          <button
            class="feat {piece.rotation_degrees === deg ? 'on' : ''}"
            onclick={() => onorient(piece.id, { rotation_degrees: deg })}>{deg}°</button
          >
        {/each}
      </div>
      <label
        >mirror
        <select value={piece.mirror} onchange={(e) => onorient(piece.id, { mirror: (e.currentTarget as HTMLSelectElement).value as Mirror })}>
          <option value="none">none</option>
          <option value="horizontal">horizontal</option>
          <option value="vertical">vertical</option>
        </select>
      </label>
      {#if piece.piece_type === "feature"}
        <label
          >parent area
          <select
            value={piece.parent_area_id ?? ""}
            onchange={(e) => onparent(piece.id, (e.currentTarget as HTMLSelectElement).value || undefined)}
          >
            <option value="">(none — board space)</option>
            {#each areaOptions as a (a.id)}
              <option value={a.id}>{a.name}</option>
            {/each}
          </select>
        </label>
        {#if piece.parent_area_id}
          <div class="snaps">
            <button class="feat" onclick={() => onsnapcenter(piece.id)}>⊙ center</button>
            <button class="feat" onclick={() => onsnapcorner(piece.id)}>◻ corner</button>
          </div>
        {/if}
      {/if}
      <label
        >link group
        <input type="text" placeholder="(none)" value={piece.link_group ?? ""} oninput={(e) => onlinkgroup(piece.id, (e.currentTarget as HTMLInputElement).value)} /></label
      >
      {#if piece.piece_type === "area"}
        <label
          >objective role
          <select
            value={piece.objective_role ?? ""}
            onchange={(e) =>
              onobjectiverole(piece.id, ((e.currentTarget as HTMLSelectElement).value || undefined) as
                | ObjectiveRole
                | undefined)}
          >
            <option value="">(none)</option>
            <option value="home">home</option>
            <option value="expansion">expansion</option>
            <option value="center">center</option>
          </select>
        </label>
      {/if}
      <p class="hint">
        The centroid is rotation/mirror-invariant. Edits carry the 180° twin along.
        {#if piece.piece_type === "feature"}
          Anchor a feature to an area so moving or rotating the area carries it; its
          centroid is then in the area's local frame.
        {:else}
          An objective role marks this area — and its whole link group, which is one
          area slotted like puzzle pieces — as a single objective.
        {/if}
      </p>
    </fieldset>

    <fieldset class="solver">
      <legend>Solve centroid from a reference card</legend>
      <div class="mode">
        <button class="feat {solverMode === 'two' ? 'on' : ''}" onclick={() => (solverMode = "two")}
          >2 lines · known angle</button
        >
        <button class="feat {solverMode === 'three' ? 'on' : ''}" onclick={() => (solverMode = "three")}
          >3 corners · solve angle</button
        >
      </div>

      {#if solverMode === "two"}
        <p class="hint">
          Set rotation &amp; mirror to match the card, then enter the two dimension lines.
          Hover a face/corner to see it on the board; the guide shows which edge it measures from.
        </p>

        <div class="line">
          <select value={hEdge} onchange={(e) => (hEdge = (e.currentTarget as HTMLSelectElement).value as "left" | "right")}>
            <option value="left">from left edge</option>
            <option value="right">from right edge</option>
          </select>
          <input type="number" step="0.05" value={hDist} oninput={(e) => (hDist = num(e))} aria-label="distance from left/right edge" />″ to
        </div>
        <div class="features">
          {#each hFeatures as f (f.label)}
            <button
              class="feat {sameRef(hRef, f.ref) ? 'on' : ''}"
              onpointerenter={() => onsolverhover(f.ref)}
              onpointerleave={() => onsolverhover(null)}
              onclick={() => (hRef = f.ref)}>{f.label}</button
            >
          {/each}
        </div>

        <div class="line">
          <select value={vEdge} onchange={(e) => (vEdge = (e.currentTarget as HTMLSelectElement).value as "top" | "bottom")}>
            <option value="top">from top edge</option>
            <option value="bottom">from bottom edge</option>
          </select>
          <input type="number" step="0.05" value={vDist} oninput={(e) => (vDist = num(e))} aria-label="distance from top/bottom edge" />″ to
        </div>
        <div class="features">
          {#each vFeatures as f (f.label)}
            <button
              class="feat {sameRef(vRef, f.ref) ? 'on' : ''}"
              onpointerenter={() => onsolverhover(f.ref)}
              onpointerleave={() => onsolverhover(null)}
              onclick={() => (vRef = f.ref)}>{f.label}</button
            >
          {/each}
        </div>

        <button class="primary" onclick={solve}>Solve &amp; place</button>
      {:else}
        <p class="hint">
          For pieces at non-90° angles: set mirror to match the card, then enter the
          card's three corner measurements — two from the same pair of edges
          (left/right or top/bottom), one from the other. Solves position <em>and</em>
          rotation; the current rotation picks between the two mirror-image fits, so
          rough it in first.
        </p>

        {#each tri as t, i (i)}
          <div class="line">
            <select
              value={t.edge}
              onchange={(e) => (tri[i].edge = (e.currentTarget as HTMLSelectElement).value as CardEdge)}
            >
              <option value="left">from left edge</option>
              <option value="right">from right edge</option>
              <option value="top">from top edge</option>
              <option value="bottom">from bottom edge</option>
            </select>
            <input
              type="number"
              step="0.05"
              value={t.dist}
              oninput={(e) => (tri[i].dist = num(e))}
              aria-label={`triangulation distance ${i + 1}`}
            />″ to
            <span class="features inline">
              {#each Array.from({ length: vertexCount }, (_, vi) => vi) as vi (vi)}
                <button
                  class="feat {t.vertex === vi ? 'on' : ''}"
                  onpointerenter={() => onsolverhover({ kind: "vertex", index: vi })}
                  onpointerleave={() => onsolverhover(null)}
                  onclick={() => (tri[i].vertex = vi)}>v{vi}</button
                >
              {/each}
            </span>
          </div>
        {/each}

        <button class="primary" onclick={solveTriangulatedPlace}>Triangulate &amp; place</button>
      {/if}
      {#if solveError}<p class="error">{solveError}</p>{/if}
    </fieldset>
  </div>
{/if}

<style>
  .empty {
    color: var(--text-mute);
    font-size: 0.9rem;
  }
  .inspector header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  h3 {
    margin: 0;
    font-family: "Barlow Condensed", sans-serif;
    font-size: 1.3rem;
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.1rem 0.75rem;
    font-size: 0.82rem;
    color: var(--text-dim);
    margin: 0.4rem 0 0.8rem;
  }
  .meta dt {
    color: var(--text-mute);
    font-family: "JetBrains Mono", monospace;
  }
  .meta dd {
    margin: 0;
  }
  fieldset {
    border: 1px solid var(--rim);
    border-radius: 6px;
    margin: 0 0 0.8rem;
    padding: 0.6rem 0.75rem 0.75rem;
  }
  legend {
    font-family: "Barlow Condensed", sans-serif;
    font-size: 0.95rem;
    color: var(--text);
    padding: 0 0.4rem;
  }
  label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    margin-bottom: 0.35rem;
  }
  input,
  select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--rim);
    border-radius: 4px;
    padding: 0.2rem 0.35rem;
    font: inherit;
    font-size: 0.82rem;
  }
  input[type="number"] {
    width: 5rem;
  }
  input[type="text"] {
    width: 8rem;
  }
  .hint {
    font-size: 0.74rem;
    color: var(--text-mute);
    margin: 0.3rem 0 0;
  }
  .solver .line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.3rem;
    font-size: 0.8rem;
    flex-wrap: wrap;
  }
  .features {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .features.inline {
    display: inline-flex;
    margin-bottom: 0;
  }
  .snaps {
    display: flex;
    gap: 0.25rem;
    justify-content: flex-end;
    margin: -0.15rem 0 0.35rem;
  }
  .mode {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.4rem;
  }
  .feat {
    font: inherit;
    font-size: 0.72rem;
    background: var(--surface-2);
    color: var(--text-dim);
    border: 1px solid var(--rim);
    border-radius: 4px;
    padding: 0.12rem 0.4rem;
    cursor: pointer;
  }
  .feat.on {
    border-color: var(--accent);
    background: var(--accent-fill);
    color: var(--accent-strong);
  }
  button {
    font: inherit;
    border-radius: 4px;
    border: 1px solid var(--rim);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    background: var(--surface-2);
    color: var(--text);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  button.danger {
    background: transparent;
    border-color: var(--danger-rim);
    color: var(--danger);
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
  }
  .error {
    color: var(--danger);
    font-size: 0.78rem;
    margin: 0.4rem 0 0;
  }
</style>
