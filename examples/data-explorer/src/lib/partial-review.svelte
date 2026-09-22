<script lang="ts">
  import { download } from "./export.js";
  import {
    FOLLOW_UP_CATEGORIES,
    FOLLOW_UP_GUIDANCE,
    aiReviewState,
    authorityState,
    compareReviews,
    decisionIdentity,
    exportReviewSession,
    humanReviewState,
    parsePartialReviewBundle,
    shouldRevealAI,
    type AIReviewComplete,
    type FollowUpCategory,
    type HumanReviewStamp,
    type ReviewMode,
    type ReviewQueue,
  } from "./partial-review.js";
  import { partialReview, type DraftDecision } from "./partial-review-store.svelte.js";

  const QUEUES: Array<{ value: ReviewQueue; label: string }> = [
    { value: "all", label: "All candidates" },
    { value: "human-pending", label: "Human pending" },
    { value: "ai-correct", label: "AI clean / human pending" },
    { value: "ai-uncertain", label: "AI uncertain, human pending" },
    { value: "human-stamped", label: "Human stamped" },
    { value: "disagreement", label: "AI/Human disagreement" },
    { value: "ai-false-approvals", label: "AI false approvals" },
    { value: "describer-defects", label: "Describer defects" },
    { value: "semantic-repair", label: "Semantic repair" },
    { value: "stale", label: "Stale reviews" },
  ];

  let fileInput = $state<HTMLInputElement | null>(null);
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let draft = $state<DraftDecision>(partialReview.draft());
  const visible = $derived(partialReview.visibleCandidates());
  const candidate = $derived(partialReview.current());
  const human = $derived(candidate ? partialReview.currentHumanReview(candidate) : undefined);
  const staleHuman = $derived(candidate ? partialReview.staleHumanReview(candidate) : undefined);
  const aiState = $derived(candidate ? aiReviewState(candidate) : "absent");
  const humanState = $derived(candidate ? humanReviewState(candidate, partialReview.humanReview(candidate)) : "absent");
  const authority = $derived(candidate ? authorityState(candidate, partialReview.humanReview(candidate)) : "unreviewed");
  const revealAI = $derived(candidate ? shouldRevealAI(partialReview.reviewMode, candidate, human) : false);
  const currentAI = $derived(candidate?.ai_review?.status === "complete" && aiState === "current" ? candidate.ai_review : undefined);
  const comparison = $derived(currentAI && human ? compareReviews(currentAI, human) : undefined);
  const summary = $derived(partialReview.summary());
  const staleCounts = $derived(partialReview.staleCounts());
  const overrides = $derived(currentAI ? overrideDimensions(currentAI, draft) : []);

  function resetDraft(): void {
    const saved = candidate ? partialReview.currentHumanReview(candidate) : undefined;
    const suggested = partialReview.reviewMode === "assisted" && !saved ? partialReview.suggestedDraft(candidate) : undefined;
    draft = saved ? partialReview.draft(candidate) : suggested ?? partialReview.draft(candidate);
    saveError = null;
  }

  async function loadBundle(event: Event): Promise<void> {
    const target = event.target;
    const file = target instanceof HTMLInputElement ? target.files?.[0] : undefined;
    if (!file) return;
    loadError = null;
    try {
      partialReview.load(parsePartialReviewBundle(JSON.parse(await file.text())));
      resetDraft();
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
      partialReview.clear();
    } finally {
      if (fileInput) fileInput.value = "";
    }
  }

  function setMode(mode: ReviewMode): void {
    partialReview.setReviewMode(mode);
    resetDraft();
  }

  function setReviewer(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) partialReview.setReviewerId(target.value);
  }

  function setQueue(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    partialReview.setQueue(target.value as ReviewQueue);
    resetDraft();
  }

  function toggleReason(reason: FollowUpCategory): void {
    draft.follow_up_categories = draft.follow_up_categories.includes(reason)
      ? draft.follow_up_categories.filter((item) => item !== reason)
      : [...draft.follow_up_categories, reason];
  }

  function move(direction: "next" | "previous"): void {
    direction === "next" ? partialReview.next() : partialReview.previous();
    resetDraft();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function continueAfterStamp(stampedIdentity: string): void {
    const after = partialReview.visibleCandidates();
    const stampedIndex = after.findIndex((item) => decisionIdentity(item) === stampedIdentity);
    if (stampedIndex >= 0 && stampedIndex < after.length - 1) partialReview.index = stampedIndex + 1;
    else if (stampedIndex < 0) partialReview.index = Math.min(partialReview.index, Math.max(0, after.length - 1));
    partialReview.markOpened();
    resetDraft();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function stampReview(): void {
    if (!candidate) return;
    const identity = decisionIdentity(candidate);
    try {
      partialReview.save(candidate, draft);
      continueAfterStamp(identity);
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
  }

  function stampSuggested(): void {
    if (!candidate) return;
    const identity = decisionIdentity(candidate);
    try {
      partialReview.stampAsSuggested(candidate);
      continueAfterStamp(identity);
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
  }

  function exportDecisions(): void {
    const output = exportReviewSession(partialReview.candidates, partialReview.humanReviews, partialReview.sessionStartedAt, new Date(), partialReview.humanReviewHistory);
    download("partial-component-review-v3.json", JSON.stringify(output, null, 2), "application/json");
  }

  function keyboard(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.matches("textarea,input,select")) return;
    const key = event.key.toLowerCase();
    if (key === "1") draft.semantics = "correct";
    else if (key === "2") draft.semantics = "incorrect";
    else if (key === "3") draft.semantics = "uncertain";
    else if (key === "enter" && (event.metaKey || event.ctrlKey)) stampReview();
    else if (key === "arrowleft") move("previous");
    else if (key === "arrowright") move("next");
  }

  function pretty(value: string | null | undefined): string {
    if (!value) return "Not applicable";
    return value.replaceAll("-", " ");
  }

  function categorySet(values: readonly string[]): string {
    return [...values].sort().join("|");
  }

  function overrideDimensions(ai: AIReviewComplete, humanDraft: DraftDecision): string[] {
    const changed: string[] = [];
    if (humanDraft.semantics && humanDraft.semantics !== ai.semantics) changed.push("semantics");
    if (humanDraft.partial_value && humanDraft.partial_value !== ai.partial_value) changed.push("usefulness");
    if (humanDraft.residual_relationship && humanDraft.residual_relationship !== ai.residual_relationship) changed.push("residuals");
    if (humanDraft.render_quality && humanDraft.render_quality !== ai.render_quality) changed.push("render");
    if (categorySet(humanDraft.follow_up_categories) !== categorySet(ai.follow_up_categories)) changed.push("categories");
    return changed;
  }

  function authorityLabel(): string {
    if (authority === "human-stamped") return "Human stamped";
    if (authority === "ai-suggested") return "AI suggested";
    if (authority === "stale") return "Stale";
    return "Unreviewed";
  }
</script>

<svelte:window onkeydown={keyboard} />

<div class="partial-toolbar">
  <div>
    <strong>Partial component review</strong>
    <span class="dim">AI suggests. Humans stamp. Whole-ability certification remains separate.</span>
  </div>
  <div class="partial-actions">
    <input type="file" accept=".json,application/json" bind:this={fileInput} onchange={loadBundle} hidden />
    <button onclick={() => fileInput?.click()}>{partialReview.candidates.length ? "Replace bundle" : "Load private review bundle"}</button>
    {#if partialReview.candidates.length}<button onclick={exportDecisions}>Export both review layers</button>{/if}
  </div>
</div>

{#if loadError}<div class="source-status error">{loadError}</div>{/if}

{#if partialReview.candidates.length}
  <section class="review-dashboard" aria-label="Review status">
    <div><strong>{summary.candidates}</strong><span>Candidates</span></div>
    <div><strong>{summary.ai_reviewed}</strong><span>AI reviewed</span></div>
    <div><strong>{summary.human_stamped}</strong><span>Human stamped</span></div>
    <div><strong>{summary.human_pending}</strong><span>Human pending</span></div>
    <div><strong>{summary.semantic_agreement}</strong><span>Semantic agreement</span></div>
    <div class:danger={summary.ai_false_approvals > 0}><strong>{summary.ai_false_approvals}</strong><span>AI false approvals</span></div>
    <div><strong>{summary.ai_conservative_misses}</strong><span>Conservative misses</span></div>
    <div><strong>{summary.describer_queue}</strong><span>Describer queue</span></div>
    <div><strong>{summary.queues["ai-clean-human-pending"] ?? 0}</strong><span>AI clean / human pending</span></div>
    <div><strong>{summary.stale}</strong><span>Stale reviews</span></div>
  </section>

  <div class="review-controls">
    <div class="mode-control" aria-label="Review mode">
      <span>Review mode</span>
      <button class:active={partialReview.reviewMode === "blind"} onclick={() => setMode("blind")}>Blind</button>
      <button class:active={partialReview.reviewMode === "assisted"} onclick={() => setMode("assisted")}>Assisted</button>
    </div>
    <p>{partialReview.reviewMode === "blind" ? "AI verdict stays hidden until your human stamp." : "AI suggestion is visible and may prefill controls. Nothing is stamped until you act."}</p>
    <label>Human reviewer
      <input type="text" value={partialReview.reviewerId} onchange={setReviewer} aria-label="Human reviewer identity" />
    </label>
    <label>Queue
      <select value={partialReview.queue} onchange={setQueue}>
        {#each QUEUES as queue}<option value={queue.value}>{queue.label}</option>{/each}
      </select>
    </label>
  </div>
{/if}

{#if candidate}
  <div class="review-progress">
    <button onclick={() => move("previous")} disabled={partialReview.index === 0}>Previous</button>
    <span><strong>{partialReview.index + 1}</strong> / {visible.length}</span>
    <span>{summary.human_stamped} human stamped</span>
    {#if staleCounts.ai}<span class="stale">{staleCounts.ai} AI stale</span>{/if}
    {#if staleCounts.human}<span class="stale">{staleCounts.human} human stale</span>{/if}
    <span class="grow"></span>
    <span class="authority-badge {authority}">{authorityLabel()}</span>
    <code>{candidate.key} · {candidate.component_id}</code>
  </div>

  <div class="review-layout">
  <article class="review-sheet">
    <header>
      <div>
        <div class="section-label">{candidate.faction_id}</div>
        <h1>{candidate.name}</h1>
      </div>
      <div class="candidate-gates">
        {#if candidate.schema_valid !== undefined}<span class:bad={!candidate.schema_valid}>schema {candidate.schema_valid ? "valid" : "invalid"}</span>{/if}
        {#if candidate.canonical !== undefined}<span class:bad={!candidate.canonical}>canonical {candidate.canonical ? "yes" : "no"}</span>{/if}
      </div>
    </header>

    <section class="comparison source-block">
      <h2>Source</h2>
      <div class="prose">{candidate.source_text}</div>
    </section>
    <section class="comparison candidate-block">
      <h2>Candidate interpretation</h2>
      <div class="prose">{candidate.candidate_render}</div>
    </section>
    <section class="comparison residual-block">
      <h2>Unresolved / residuals</h2>
      {#if candidate.residuals.length}
        <ul>
          {#each candidate.residuals as residual}
            <li>
              <span>{residual.summary}</span>
              {#if residual.unresolved_slots?.length}<code>{residual.unresolved_slots.join(", ")}</code>{/if}
              {#if residual.reason}<small>{residual.reason}</small>{/if}
            </li>
          {/each}
        </ul>
      {:else}<div class="dim">No residuals recorded.</div>{/if}
    </section>

    <details class="secondary-context">
      <summary>Raw DSL and current production context</summary>
      <div class="secondary-grid">
        <div><h3>Candidate DSL</h3><pre>{JSON.stringify(candidate.candidate_entry, null, 2)}</pre></div>
        <div><h3>Current render</h3><div class="prose">{candidate.current_render ?? "Not supplied"}</div></div>
        {#if candidate.current_entry}<div><h3>Current DSL</h3><pre>{JSON.stringify(candidate.current_entry, null, 2)}</pre></div>{/if}
      </div>
    </details>

    <section class="review-layer ai-layer">
      <header>
        <div><span class="layer-mark ai">AI</span><h2>AI suggestion</h2></div>
        <span class="layer-state {aiState}">{aiState === "current" ? "Suggestion only" : pretty(aiState)}</span>
      </header>
      {#if partialReview.reviewMode === "blind" && !revealAI}
        <div class="blind-cover"><strong>Hidden for blind review</strong><span>Stamp your independent judgment to reveal the AI suggestion.</span></div>
      {:else if candidate.ai_review?.status === "failed" && aiState === "failed"}
        <div class="layer-message warning">AI review failed: {candidate.ai_review.error_category}. Resume the private batch to retry it.</div>
      {:else if aiState === "stale"}
        <div class="layer-message warning">This AI suggestion is stale. Its reviewed digests do not match the current component.</div>
      {:else if currentAI}
        <dl class="verdict-grid">
          <div><dt>Semantics</dt><dd>{pretty(currentAI.semantics)}</dd></div>
          <div><dt>Useful partial</dt><dd>{pretty(currentAI.partial_value)}</dd></div>
          <div><dt>Residuals</dt><dd>{pretty(currentAI.residual_relationship)}</dd></div>
          <div><dt>Render</dt><dd>{pretty(currentAI.render_quality)}</dd></div>
        </dl>
        {#if currentAI.follow_up_categories.length}<p class="ai-categories">Suggested defects: {currentAI.follow_up_categories.map(pretty).join(", ")}</p>{/if}
        <p class="ai-rationale">{currentAI.rationale}</p>
        <p class="counterexample"><strong>Counterexample attempt:</strong> {currentAI.counterexample.summary}</p>
        <div class="reviewer-meta">{currentAI.reviewer.model_version_or_id} · contract {currentAI.reviewer.prompt_contract_version}</div>
        {#if !human}
          <div class="suggestion-actions">
            <button onclick={resetDraft}>Prefill suggestion</button>
            <button class="primary" onclick={stampSuggested}>Stamp as suggested</button>
          </div>
        {/if}
      {:else}
        <div class="layer-message">No AI suggestion is attached. Human review can proceed independently.</div>
      {/if}
    </section>

    <section class="review-layer human-layer">
      <header>
        <div><span class="layer-mark human">H</span><h2>Human stamp</h2></div>
        <span class="layer-state {humanState}">{humanState === "current" ? "Authoritative component stamp" : pretty(humanState)}</span>
      </header>
      {#if staleHuman}<div class="layer-message warning">The previous human stamp is stale and retained for audit. Restamp the current inputs.</div>{/if}
      {#if partialReview.reviewMode === "assisted" && currentAI && overrides.length}
        <div class="override-note"><strong>Human override</strong><span>{overrides.join(", ")}</span></div>
      {/if}

      <div class="decision-form">
        <fieldset>
          <legend>Semantics <span>1–3</span></legend>
          <div class="segmented three">
            <button class:active={draft.semantics === "correct"} onclick={() => (draft.semantics = "correct")}>Correct</button>
            <button class:active={draft.semantics === "incorrect"} onclick={() => (draft.semantics = "incorrect")}>Wrong</button>
            <button class:active={draft.semantics === "uncertain"} onclick={() => (draft.semantics = "uncertain")}>Uncertain</button>
          </div>
        </fieldset>

        {#if draft.semantics === "correct"}
          <fieldset>
            <legend>Useful partial?</legend>
            <div class="segmented two">
              <button class:active={draft.partial_value === "useful-partial"} onclick={() => (draft.partial_value = "useful-partial")}>Yes, carry forward</button>
              <button class:active={draft.partial_value === "correct-but-low-value"} onclick={() => (draft.partial_value = "correct-but-low-value")}>Correct, low value</button>
            </div>
            <p class="partial-reminder">This stamp applies only to the component. Remaining source mechanics stay unresolved.</p>
          </fieldset>
        {/if}

        <fieldset>
          <legend>Residuals acceptable?</legend>
          <div class="segmented two">
            <button class:active={draft.residual_relationship === "residuals-compatible"} onclick={() => (draft.residual_relationship = "residuals-compatible")}>Yes, compatible</button>
            <button class:active={draft.residual_relationship === "residual-blocks-component"} onclick={() => (draft.residual_relationship = "residual-blocks-component")}>No, blocks component</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Render</legend>
          <div class="segmented three">
            <button class:active={draft.render_quality === "render-good"} onclick={() => (draft.render_quality = "render-good")}>Good</button>
            <button class:active={draft.render_quality === "render-awkward-but-faithful"} onclick={() => (draft.render_quality = "render-awkward-but-faithful")}>Awkward, faithful</button>
            <button class:active={draft.render_quality === "render-semantically-lossy"} onclick={() => (draft.render_quality = "render-semantically-lossy")}>Semantically lossy</button>
          </div>
        </fieldset>

        {#if draft.semantics === "incorrect" || draft.residual_relationship === "residual-blocks-component" || draft.render_quality !== "render-good"}
          <fieldset>
            <legend>Follow-up category</legend>
            <div class="reason-grid">
              {#each FOLLOW_UP_CATEGORIES as reason}
                <button
                  class:active={draft.follow_up_categories.includes(reason)}
                  title={`${FOLLOW_UP_GUIDANCE[reason].use_when} Example: ${FOLLOW_UP_GUIDANCE[reason].example}`}
                  onclick={() => toggleReason(reason)}
                >{pretty(reason)}</button>
              {/each}
            </div>
          </fieldset>
        {/if}

        <label class="notes-field">Notes<textarea bind:value={draft.note} placeholder="Optional context for the follow-up queue"></textarea></label>
        {#if saveError}<div class="error">{saveError}</div>{/if}
        {#if human}<div class="saved-state">Human stamped by {human.reviewer.id} at {new Date(human.stamped_at).toLocaleTimeString()} in {human.review_mode} mode</div>{/if}
      </div>
    </section>

    {#if comparison}
      <section class="review-layer agreement-layer">
        <header><div><span class="layer-mark compare">↔</span><h2>AI / Human comparison</h2></div></header>
        <div class="agreement-row"><span>Semantics</span><strong class:mismatch={!comparison.semantic_agreement}>{comparison.semantic_agreement ? "Agree" : "Disagree"}</strong></div>
        <div class="agreement-row"><span>Render</span><strong class:mismatch={!comparison.render_agreement}>{comparison.render_agreement ? "Agree" : "Disagree"}</strong></div>
        <div class="agreement-row"><span>Categories</span><strong class:mismatch={!comparison.category_agreement}>{comparison.category_agreement ? "Agree" : "Disagree"}</strong></div>
        {#if comparison.dangerous_disagreement}<div class="danger-callout">AI false approval: AI suggested correct, human stamped wrong.</div>{/if}
        {#if comparison.conservative_disagreement}<div class="conservative-callout">Conservative disagreement: AI withheld approval, human stamped correct.</div>{/if}
      </section>
    {/if}

    {#if candidate.legacy_review?.note}
      <details class="legacy-note"><summary>Old ambiguous review note, suggestion only</summary><p>{candidate.legacy_review.note}</p></details>
    {/if}
  </article>

    <aside class="followup-guide">
      <h2>Follow-up category guide</h2>
      <p>Use these only when the component is wrong or a residual blocks it.</p>
      <table>
        <thead><tr><th>Category</th><th>Use when / example</th></tr></thead>
        <tbody>
          {#each FOLLOW_UP_CATEGORIES as reason}
            <tr>
              <th>{pretty(reason)}</th>
              <td><span>{FOLLOW_UP_GUIDANCE[reason].use_when}</span><small>{FOLLOW_UP_GUIDANCE[reason].example}</small></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </aside>
  </div>

  <div class="sticky-next">
    <span>⌘/Ctrl + Enter</span>
    <button class="primary" onclick={stampReview}>{partialReview.index === visible.length - 1 ? "Stamp review" : "Stamp and next"}</button>
  </div>
{:else if partialReview.candidates.length}
  <div class="partial-empty">
    <strong>No candidates match this queue.</strong>
    <span>Choose another queue without changing any stamps.</span>
    <button class="primary" onclick={() => partialReview.setQueue("all")}>Show all candidates</button>
  </div>
{:else}
  <div class="partial-empty">
    <strong>Load the private review bundle.</strong>
    <span>It stays in memory. Source prose is never bundled, uploaded, or written to local storage.</span>
    <button class="primary" onclick={() => fileInput?.click()}>Choose bundle</button>
  </div>
{/if}
