import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addRecallOccurrence,
  clearCandidateJudgment,
  clearCandidateGroup,
  completeRecall,
  completion,
  documentIdentity,
  hitHintSegments,
  hitCueRanges,
  isRowComplete,
  judgeCandidateSideways,
  judgeCandidate,
  moveVimCursor,
  nextUnresolved,
  proposeSidewaysMechanic,
  parseReviewDocument,
  removeRecallOccurrence,
  rowsOf,
  utf8Selection,
  type VimMotion,
} from "./model";
import {
  CANDIDATE_VERDICTS,
  SIDEWAYS_CHOICES,
  type CandidateRow,
  type CandidateVerdict,
  type DirectFile,
  type RecallRow,
  type SidewaysChoice,
  type ReviewDocument,
} from "./types";

const DIRECT_FILES = [
  "recall-audit.json",
  "train-labels.json",
  "validation-labels.json",
  "held-out-labels.json",
] as const;
const VERDICT_LABELS: Record<CandidateVerdict, string> = {
  "exact-match": "Exact match",
  "related-variant": "Related variant",
  "different-family": "Different family",
  irrelevant: "Irrelevant",
  ambiguous: "Ambiguous",
};
const FINGERPRINT_GUIDANCE: Record<string, { meaning: string; example: string }> = {
  reroll: {
    meaning: "Lets the player roll a Hit result again. The subset parameter distinguishes ones from all failed Hit rolls.",
    example: "Example: “Re-roll a Hit roll of 1.”",
  },
  "roll-modifier": {
    meaning: "Adds to or subtracts from the numerical Hit-roll result.",
    example: "Example: “Add 1 to that attack’s Hit roll.”",
  },
  "critical-hit-threshold": {
    meaning: "Changes which unmodified Hit-roll results count as Critical Hits.",
    example: "Example: “A Hit roll of 5+ is a Critical Hit.”",
  },
};

const VERDICT_GUIDANCE: Array<{ verdict: CandidateVerdict; rule: string; example: string }> = [
  {
    verdict: "exact-match",
    rule: "The highlighted span expresses the queried family with the queried parameters.",
    example: "Queried reroll ones; highlighted span says to re-roll a Hit roll of 1.",
  },
  {
    verdict: "related-variant",
    rule: "The highlighted span has the same family but materially different parameters.",
    example: "Queried reroll ones; highlighted span permits re-rolling every failed Hit roll.",
  },
  {
    verdict: "different-family",
    rule: "The highlighted span contains Hit semantics, but it is a different mechanic family.",
    example: "Queried Critical Hit threshold; highlighted span modifies or re-rolls a Hit roll.",
  },
  {
    verdict: "irrelevant",
    rule: "The highlighted span itself contains no Hit mechanic. Nearby context cannot substitute for it.",
    example: "The highlight is a unit keyword or target restriction, while Hit wording appears only outside it.",
  },
  {
    verdict: "ambiguous",
    rule: "The highlighted source is genuinely insufficient to choose one of the other verdicts.",
    example: "Use this for unresolved meaning, not merely unfamiliar wording.",
  },
];

const SIDEWAYS_GUIDANCE: Record<SidewaysChoice, { label: string; description: string }> = {
  "reroll-ones": { label: "Re-roll Hit rolls of 1", description: "Exact queried reroll-ones mechanic." },
  "reroll-all": { label: "Re-roll Hit rolls", description: "Sibling reroll variant without the ones-only restriction." },
  "modifier-add-one": { label: "+1 to Hit rolls", description: "Positive numerical Hit-roll modifier." },
  "modifier-subtract-one": { label: "−1 to Hit rolls", description: "Sibling negative numerical Hit-roll modifier." },
  "critical-hit-threshold": { label: "Critical Hit threshold", description: "A result is explicitly made a Critical Hit." },
  "automatic-hit": { label: "Automatic hit", description: "The attack hits without making a Hit roll." },
  "hit-threshold": { label: "Ordinary hit threshold", description: "Changes which result scores or fails an ordinary hit." },
  "modifier-immunity": { label: "Ignore Hit modifier", description: "Removes a penalty or modifier from the Hit roll." },
  "roll-substitution": { label: "Change Hit result", description: "Replaces or changes an already rolled Hit result." },
  "other-hit": { label: "Other Hit mechanic", description: "Hit semantics outside the named sibling families." },
  irrelevant: { label: "Irrelevant", description: "The highlighted span itself has no Hit mechanic." },
  ambiguous: { label: "Ambiguous", description: "The source span does not determine a mechanic." },
};

function nowIso(): string {
  return new Date().toISOString();
}

function newBatchId(): string {
  return `batch-ui-${crypto.randomUUID()}`;
}

function fingerprintLabel(document: ReviewDocument, id: string): string {
  if (document.kind !== "candidate") return id;
  const fingerprint = document.sheet.fingerprints.find((item) => item.id === id);
  if (!fingerprint) return id;
  const parameters = Object.entries(fingerprint.parameters)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  return parameters ? `${fingerprint.family} (${parameters})` : fingerprint.family;
}

function candidateContext(row: CandidateRow) {
  return (
    <p className="source-copy" aria-label="Candidate source context">
      <span className="context-muted">{row.left_context}</span>
      <mark>{row.target_span}</mark>
      <span className="context-muted">{row.right_context}</span>
    </p>
  );
}

function textPoint(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let remaining = Math.max(0, offset);
  let last: Node = root;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    last = node;
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return { node: last, offset: last.textContent?.length ?? 0 };
}

function setDomSelection(root: HTMLElement, anchor: number, focus: number) {
  const start = textPoint(root, Math.min(anchor, focus));
  const end = textPoint(root, Math.max(anchor, focus));
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = root.ownerDocument.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export default function App() {
  const [document, setDocument] = useState<ReviewDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [directFile, setDirectFile] = useState<string | null>(null);
  const [directFiles, setDirectFiles] = useState<DirectFile[]>([]);
  const [sourceEtag, setSourceEtag] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem("round5-reviewer") ?? "");
  const [batchId, setBatchId] = useState(newBatchId);
  const [status, setStatus] = useState("Choose a review sheet to begin.");
  const [error, setError] = useState<string | null>(null);
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [sourceSelection, setSourceSelection] = useState({ start: 0, end: 0, text: "" });
  const [occurrenceFamily, setOccurrenceFamily] = useState("");
  const [occurrenceParameters, setOccurrenceParameters] = useState("{}");
  const [vimMode, setVimMode] = useState<"NORMAL" | "VISUAL">("NORMAL");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const candidateGroupProgress = useMemo(() => {
    if (!document || document.kind !== "candidate") return null;
    const groups = new Map<string, CandidateRow[]>();
    for (const row of document.sheet.rows) {
      const existing = groups.get(row.candidate_id) ?? [];
      existing.push(row);
      groups.set(row.candidate_id, existing);
    }
    return {
      completed: [...groups.values()].filter((rows) =>
        rows.every((row) => row.verdict !== null && row.confirmer && row.confirmed_at)
      ).length,
      total: groups.size,
    };
  }, [document]);
  const sourceText = useRef<HTMLDivElement>(null);
  const occurrenceFamilyInput = useRef<HTMLInputElement>(null);
  const occurrenceParametersInput = useRef<HTMLTextAreaElement>(null);
  const selectionAnchor = useRef(0);
  const selectionFocus = useRef(0);
  const cueIndex = useRef(-1);

  const progress = useMemo(
    () => (document ? completion(document) : { completed: 0, total: 0 }),
    [document],
  );
  const currentRow = document ? rowsOf(document)[index] : null;
  const progressPercent = progress.total ? (progress.completed / progress.total) * 100 : 0;

  useEffect(() => {
    fetch("/__round5-review/files")
      .then(async (response) => {
        if (!response.ok) throw new Error("Local source bridge is unavailable.");
        return (await response.json()) as { files: DirectFile[] };
      })
      .then(({ files }) => setDirectFiles(files))
      .catch(() => setDirectFiles(DIRECT_FILES.map((name) => ({ name, exists: false, size: null, modifiedAt: null }))));
  }, []);

  useEffect(() => {
    localStorage.setItem("round5-reviewer", reviewer);
  }, [reviewer]);

  useEffect(() => {
    if (!document || !isDirty) return;
    const key = `round5-review-draft:${documentIdentity(document)}`;
    localStorage.setItem(key, JSON.stringify(document.sheet));
  }, [document, isDirty]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  useEffect(() => {
    setSourceSelection({ start: 0, end: 0, text: "" });
    selectionAnchor.current = 0;
    selectionFocus.current = 0;
    cueIndex.current = -1;
    setVimMode("NORMAL");
    window.getSelection()?.removeAllRanges();
  }, [index]);


  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => {
      if (!document) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (directFile) {
          event.preventDefault();
          void saveDirect();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key;
      const lower = key.toLowerCase();
      if (key === "?" ) {
        event.preventDefault();
        setShowShortcuts((visible) => !visible);
      } else if (key === "D") {
        event.preventDefault();
        download();
      } else if (key === "ArrowRight" || lower === "j") {
        event.preventDefault();
        setIndex((current) => Math.min(rowsOf(document).length - 1, current + 1));
      } else if (key === "ArrowLeft" || lower === "k") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      } else if (lower === "u") {
        event.preventDefault();
        setIndex((current) => nextUnresolved(document, current));
      } else if (document.kind === "candidate" && lower === "q") {
        event.preventDefault();
        const row = document.sheet.rows[index];
        if (row) applySidewaysChoice(proposeSidewaysMechanic(row.target_span).choice);
      } else if (document.kind === "candidate" && lower === "x") {
        event.preventDefault();
        applySidewaysChoice("irrelevant");
      } else if (document.kind === "candidate" && lower === "o") {
        event.preventDefault();
        applySidewaysChoice("other-hit");
      } else if (document.kind === "candidate" && lower === "a") {
        event.preventDefault();
        applySidewaysChoice("ambiguous");
      } else if (document.kind === "candidate" && /^[1-5]$/.test(key)) {
        event.preventDefault();
        applyVerdict(CANDIDATE_VERDICTS[Number(key) - 1]);
      } else if (document.kind === "recall" && key === "1") {
        event.preventDefault();
        markRecall(false);
      } else if (document.kind === "recall" && key === "2") {
        event.preventDefault();
        markRecall(true);
      } else if (document.kind === "recall" && lower === "v") {
        event.preventDefault();
        beginVimSelection();
      } else if (document.kind === "recall" && lower === "f") {
        event.preventDefault();
        occurrenceFamilyInput.current?.focus();
      } else if (document.kind === "recall" && lower === "p") {
        event.preventDefault();
        occurrenceParametersInput.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });

  function openDocument(
    value: unknown,
    name: string,
    sourceName: string | null,
    etag: string | null = null,
  ) {
    try {
      const parsed = parseReviewDocument(value);
      const draftKey = `round5-review-draft:${documentIdentity(parsed)}`;
      const draft = localStorage.getItem(draftKey);
      const resolved = draft ? parseReviewDocument(JSON.parse(draft)) : parsed;
      setDocument(resolved);
      setFileName(name);
      setDirectFile(sourceName);
      setSourceEtag(etag);
      setIndex(nextUnresolved(resolved, -1));
      setBatchId(newBatchId());
      setStatus(draft ? "Restored the browser draft for this sheet." : `Loaded ${name}.`);
      setError(null);
      setIsDirty(Boolean(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function loadDirect(name: string) {
    setStatus(`Loading ${name}…`);
    try {
      const response = await fetch(`/__round5-review/file/${encodeURIComponent(name)}`);
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : response.statusText;
        throw new Error(message);
      }
      openDocument(payload, name, name, response.headers.get("etag"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    openDocument(JSON.parse(await file.text()), file.name, null, null);
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      openDocument(JSON.parse(await file.text()), file.name, null, null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function replaceDocument(next: ReviewDocument, message: string) {
    setDocument(next);
    setIsDirty(true);
    setStatus(message);
    setError(null);
  }

  function applyVerdict(verdict: CandidateVerdict) {
    if (!document || document.kind !== "candidate") return;
    try {
      const sheet = judgeCandidate(document.sheet, index, verdict, reviewer, batchId, nowIso());
      const next = { kind: "candidate", sheet } satisfies ReviewDocument;
      replaceDocument(next, `${VERDICT_LABELS[verdict]} recorded.`);
      setIndex(nextUnresolved(next, index));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function applySidewaysChoice(choice: SidewaysChoice) {
    if (!document || document.kind !== "candidate") return;
    const row = document.sheet.rows[index];
    if (!row) return;
    try {
      const sheet = judgeCandidateSideways(
        document.sheet,
        row.candidate_id,
        choice,
        reviewer,
        batchId,
        nowIso(),
      );
      const next = { kind: "candidate", sheet } satisfies ReviewDocument;
      replaceDocument(next, `Confirmed ${SIDEWAYS_GUIDANCE[choice].label} across this candidate group.`);
      setIndex(nextUnresolved(next, index));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function clearCurrentGroup() {
    if (!document || document.kind !== "candidate") return;
    const row = document.sheet.rows[index];
    if (!row) return;
    replaceDocument(
      { kind: "candidate", sheet: clearCandidateGroup(document.sheet, row.candidate_id) },
      "Candidate-level judgment cleared.",
    );
  }

  function clearCurrent() {
    if (!document || document.kind !== "candidate") return;
    replaceDocument(
      { kind: "candidate", sheet: clearCandidateJudgment(document.sheet, index) },
      "Judgment cleared.",
    );
  }

  function markRecall(containsHit: boolean) {
    if (!document || document.kind !== "recall") return;
    try {
      const sheet = completeRecall(document.sheet, index, containsHit, reviewer, nowIso());
      const next = { kind: "recall", sheet } satisfies ReviewDocument;
      replaceDocument(next, containsHit ? "Hit occurrence review completed." : "No Hit semantics recorded.");
      setIndex(nextUnresolved(next, index));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function captureSelection() {
    if (!document || document.kind !== "recall" || !sourceText.current) return;
    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const root = sourceText.current;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const prefix = window.document.createRange();
      prefix.selectNodeContents(root);
      prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      const end = start + range.toString().length;
      selectionAnchor.current = start;
      selectionFocus.current = end;
      if (selection.isCollapsed) {
        setSourceSelection({ start: 0, end: 0, text: "" });
        setVimMode("NORMAL");
        return;
      }
      const row = document.sheet.rows[index];
      setSourceSelection(utf8Selection(row.source_text, start, end));
      setVimMode("VISUAL");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function applyVimSelection(anchor: number, focus: number, visual: boolean) {
    if (!document || document.kind !== "recall" || !sourceText.current) return;
    const text = document.sheet.rows[index].source_text;
    selectionAnchor.current = anchor;
    selectionFocus.current = focus;
    setDomSelection(sourceText.current, anchor, focus);
    setVimMode(visual ? "VISUAL" : "NORMAL");
    setSourceSelection(visual && anchor !== focus
      ? utf8Selection(text, Math.min(anchor, focus), Math.max(anchor, focus))
      : { start: 0, end: 0, text: "" });
  }

  function beginVimSelection() {
    sourceText.current?.focus();
    selectionAnchor.current = selectionFocus.current;
    applyVimSelection(selectionAnchor.current, selectionFocus.current, true);
  }

  function handleSourceKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!document || document.kind !== "recall" || event.metaKey || event.ctrlKey || event.altKey) return;
    const text = document.sheet.rows[index].source_text;
    const key = event.key;
    const cues = hitCueRanges(text);
    if (key === "n" || key === "N") {
      if (cues.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = key === "n" ? 1 : -1;
      cueIndex.current = (cueIndex.current + delta + cues.length) % cues.length;
      const cue = cues[cueIndex.current];
      if (cue) applyVimSelection(cue.start, cue.end, true);
      return;
    }
    if (key === "v") {
      event.preventDefault();
      event.stopPropagation();
      if (vimMode === "VISUAL") {
        applyVimSelection(selectionFocus.current, selectionFocus.current, false);
      } else {
        beginVimSelection();
      }
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      applyVimSelection(selectionFocus.current, selectionFocus.current, false);
      return;
    }
    if (key === "Enter" && sourceSelection.text) {
      event.preventDefault();
      event.stopPropagation();
      occurrenceFamilyInput.current?.focus();
      return;
    }
    if (!["h", "l", "w", "b", "e", "0", "$", "g", "G"].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = moveVimCursor(text, selectionFocus.current, key as VimMotion);
    applyVimSelection(selectionAnchor.current, next, vimMode === "VISUAL");
  }

  function addOccurrence() {
    if (!document || document.kind !== "recall") return;
    try {
      const parameters = JSON.parse(occurrenceParameters) as unknown;
      if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
        throw new Error("Fingerprint parameters must be a JSON object.");
      }
      const sheet = addRecallOccurrence(document.sheet, index, {
        span: { start: sourceSelection.start, end: sourceSelection.end },
        text: sourceSelection.text,
        fingerprint: {
          family: occurrenceFamily.trim(),
          parameters: parameters as Record<string, string | number | boolean | null>,
        },
      });
      replaceDocument({ kind: "recall", sheet }, "Grounded occurrence added. Complete the row when all misses are recorded.");
      setSourceSelection({ start: 0, end: 0, text: "" });
      selectionAnchor.current = selectionFocus.current;
      setVimMode("NORMAL");
      window.getSelection()?.removeAllRanges();
      setOccurrenceFamily("");
      setOccurrenceParameters("{}");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function deleteOccurrence(occurrenceIndex: number) {
    if (!document || document.kind !== "recall") return;
    replaceDocument(
      { kind: "recall", sheet: removeRecallOccurrence(document.sheet, index, occurrenceIndex) },
      "Grounded occurrence removed.",
    );
  }

  async function saveDirect() {
    if (!document || !directFile) return;
    try {
      const response = await fetch(`/__round5-review/file/${encodeURIComponent(directFile)}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(sourceEtag ? { "if-match": sourceEtag } : {}),
        },
        body: JSON.stringify(document.sheet),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? response.statusText);
      setSourceEtag(response.headers.get("etag"));
      localStorage.removeItem(`round5-review-draft:${documentIdentity(document)}`);
      setIsDirty(false);
      setStatus(`Saved ${directFile} atomically to the local review directory.`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function download() {
    if (!document) return;
    const blob = new Blob([`${JSON.stringify(document.sheet, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName ?? (document.kind === "recall" ? "recall-audit.json" : `${document.sheet.split}-labels.json`);
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${anchor.download}. Attach it to this conversation when review is complete.`);
  }

  function resetDraft() {
    if (!document) return;
    localStorage.removeItem(`round5-review-draft:${documentIdentity(document)}`);
    if (directFile) void loadDirect(directFile);
    else {
      setDocument(null);
      setStatus("Browser draft cleared. Import the source sheet again.");
      setIsDirty(false);
    }
  }

  function move(delta: number) {
    if (!document) return;
    setIndex((current) => Math.max(0, Math.min(rowsOf(document).length - 1, current + delta)));
  }

  function jumpOpen() {
    if (document) setIndex((current) => nextUnresolved(document, current));
  }

  function onQueueKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Home") setIndex(0);
    if (event.key === "End" && document) setIndex(rowsOf(document).length - 1);
  }

  if (!document) {
    return (
      <main className="launch" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <section className="launch-panel" aria-labelledby="launch-title">
          <p className="eyebrow">Round 5B · Human evidence</p>
          <h1 id="launch-title">Review workbench</h1>
          <p className="launch-copy">Load a frozen review sheet. Progress stays in this browser until you save or download the JSON.</p>
          <div className="file-list" aria-label="Local review sheets">
            {DIRECT_FILES.map((name) => {
              const file = directFiles.find((item) => item.name === name);
              return (
                <button className="file-row" key={name} onClick={() => void loadDirect(name)} disabled={file ? !file.exists : false}>
                  <span>{name}</span>
                  <small>{file?.exists ? `${Math.round((file.size ?? 0) / 1024)} KB` : "not found"}</small>
                </button>
              );
            })}
          </div>
          <div className="import-line">
            <span>or</span>
            <button className="secondary" onClick={() => fileInput.current?.click()}>Import JSON</button>
            <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importFile(event)} />
          </div>
          <p className="drop-note">You can also drop a JSON file anywhere on this window.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  const rowComplete = isRowComplete(document, index);
  const candidate = document.kind === "candidate" ? (currentRow as CandidateRow) : null;
  const recall = document.kind === "recall" ? (currentRow as RecallRow) : null;
  const candidateFingerprint = candidate && document.kind === "candidate"
    ? document.sheet.fingerprints.find((fingerprint) => fingerprint.id === candidate.queried_fingerprint_id)
    : null;
  const candidateFingerprintGuide = candidateFingerprint
    ? FINGERPRINT_GUIDANCE[candidateFingerprint.family]
    : null;
  const sidewaysProposal = candidate ? proposeSidewaysMechanic(candidate.target_span) : null;
  const confirmedSidewaysChoice = candidate?.sideways_review?.confirmed_choice;

  return (
    <div className="app-shell" onKeyDown={onQueueKeyDown}>
      <header className="topbar">
        <div className="title-lockup">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Round 5B review</strong>
            <small>{fileName}</small>
          </div>
        </div>
        <div className="progress-block" aria-label={`${progress.completed} of ${progress.total} reviewed`}>
          <span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</span>
          <div className="progress-track"><div style={{ width: `${progressPercent}%` }} /></div>
        </div>
        <div className="top-actions">
          <button className="quiet" onClick={() => setShowShortcuts((visible) => !visible)}>Shortcuts <kbd>?</kbd></button>
          <button className="quiet" onClick={() => setDocument(null)}>Open another</button>
          <button className="secondary" onClick={download}>Download JSON</button>
          <button className="primary" onClick={() => void saveDirect()} disabled={!directFile || !isDirty}>Save to source</button>
        </div>
      </header>

      <aside className="sidebar">
        <label className="field-label" htmlFor="reviewer">Reviewer handle</label>
        <input id="reviewer" value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="opaque-handle" autoComplete="off" />
        <div className="queue-heading">
          <span>Queue</span>
          <button className="text-button" onClick={() => setShowOnlyOpen((value) => !value)}>{showOnlyOpen ? "Open only" : "All rows"}</button>
        </div>
        <div className="queue-list" aria-label="Review queue">
          {rowsOf(document).map((row, rowIndex) => {
            const complete = isRowComplete(document, rowIndex);
            if (showOnlyOpen && complete && rowIndex !== index) return null;
            const label = document.kind === "candidate"
              ? (row as CandidateRow).target_span
              : `${(row as RecallRow).faction_id} · ${(row as RecallRow).ability_id}`;
            return (
              <button
                key={document.kind === "candidate" ? `${(row as CandidateRow).candidate_id}:${(row as CandidateRow).queried_fingerprint_id}` : `${(row as RecallRow).faction_id}:${(row as RecallRow).ability_id}`}
                className={`queue-row${rowIndex === index ? " current" : ""}`}
                onClick={() => setIndex(rowIndex)}
              >
                <span className={`completion-mark${complete ? " done" : ""}`} aria-label={complete ? "Reviewed" : "Open"}>{complete ? "✓" : ""}</span>
                <span>{label}</span>
                <small>{rowIndex + 1}</small>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="workspace">
        <div className="record-meta">
          <div>
            <span className={`state-chip ${rowComplete ? "complete" : "open"}`}>{rowComplete ? "Reviewed" : "Needs judgment"}</span>
            <span>Row {index + 1} of {progress.total}</span>
          </div>
          <div className="nav-buttons">
            <button className="quiet" onClick={() => move(-1)} disabled={index === 0}>Previous <kbd>K</kbd></button>
            {candidateGroupProgress && (
              <span>Candidate groups {candidateGroupProgress.completed} / {candidateGroupProgress.total}</span>
            )}
            <button className="quiet" onClick={jumpOpen}>Next open <kbd>U</kbd></button>
            <button className="quiet" onClick={() => move(1)} disabled={index === progress.total - 1}>Next <kbd>J</kbd></button>
          </div>

        </div>
        {showShortcuts && (
          <aside className="shortcut-sheet" aria-label="Keyboard shortcuts">
            <strong>Keyboard</strong>
            <span><kbd>J</kbd>/<kbd>K</kbd> next/previous</span>
            <span><kbd>U</kbd> next open</span>
            <span><kbd>1–5</kbd> candidate verdict</span>
            <span><kbd>1</kbd>/<kbd>2</kbd> recall absent/complete</span>
            <span><kbd>V</kbd> focus source + visual mode</span>
            <span><kbd>N</kbd>/<kbd>Shift N</kbd> next/previous cue</span>
            <span><kbd>F</kbd>/<kbd>P</kbd> family/parameters</span>
            <span><kbd>⌘S</kbd> save source</span>
            <span><kbd>Shift D</kbd> download</span>
            <span><kbd>Q</kbd> confirm proposal</span>
            <span><kbd>X</kbd>/<kbd>O</kbd>/<kbd>A</kbd> irrelevant/other/ambiguous</span>
          </aside>
        )}

        {candidate && (
          <section className="review-surface" aria-labelledby="review-title">
            <div className="prompt-block">
              <p className="eyebrow">Queried fingerprint</p>
              <h1 id="review-title">{fingerprintLabel(document, candidate.queried_fingerprint_id)}</h1>
              <p>Judge only the highlighted source span. Context can qualify it, but must not replace it.</p>
            </div>
            <div className="source-panel">{candidateContext(candidate)}</div>
            {sidewaysProposal && (
              <section className="sideways-panel" aria-label="Sideways fingerprint proposal">
                <div>
                  <p className="eyebrow">Train-only assisted proposal</p>
                  <h2>{SIDEWAYS_GUIDANCE[sidewaysProposal.choice].label}</h2>
                  <p>{sidewaysProposal.reason}</p>
                  <small>Confirming labels all three queried fingerprints for this candidate. It does not create a Golden without your judgment.</small>
                </div>
                <button className="primary" onClick={() => applySidewaysChoice(sidewaysProposal.choice)}>
                  Confirm proposal <kbd>Q</kbd>
                </button>
                <details>
                  <summary>Choose a different mechanic</summary>
                  <div className="sideways-grid">
                    {SIDEWAYS_CHOICES.filter((choice) => choice !== sidewaysProposal.choice).map((choice) => (
                      <button key={choice} className="quiet" onClick={() => applySidewaysChoice(choice)}>
                        <strong>{SIDEWAYS_GUIDANCE[choice].label}</strong>
                        <small>{SIDEWAYS_GUIDANCE[choice].description}</small>
                      </button>
                    ))}
                  </div>
                </details>
                {confirmedSidewaysChoice && (
                  <div className="confirmed-sideways">
                    <span>Confirmed: {SIDEWAYS_GUIDANCE[confirmedSidewaysChoice].label}</span>
                    <button className="text-button danger" onClick={clearCurrentGroup}>Clear candidate group</button>
                  </div>
                )}
              </section>
            )}
            <details className="rubric-help">
              <summary>Examples and verdict guide</summary>
              {candidateFingerprintGuide && (
                <div className="fingerprint-example">
                  <strong>{candidateFingerprint?.family}</strong>
                  <span>{candidateFingerprintGuide.meaning}</span>
                  <small>{candidateFingerprintGuide.example}</small>
                </div>
              )}
              <div className="verdict-guide">
                {VERDICT_GUIDANCE.map((item, verdictIndex) => (
                  <div key={item.verdict}>
                    <strong><kbd>{verdictIndex + 1}</kbd> {VERDICT_LABELS[item.verdict]}</strong>
                    <span>{item.rule}</span>
                    <small>{item.example}</small>
                  </div>
                ))}
              </div>
            </details>
            <div className="verdict-panel action-dock">
              <h2>Verdict</h2>
              <div className="verdict-grid">
                {CANDIDATE_VERDICTS.map((verdict, verdictIndex) => (
                  <button
                    key={verdict}
                    className={`verdict ${candidate.verdict === verdict ? "selected" : ""}`}
                    onClick={() => applyVerdict(verdict)}
                  >
                    <kbd>{verdictIndex + 1}</kbd>
                    <span>{VERDICT_LABELS[verdict]}</span>
                  </button>
                ))}
              </div>
              {candidate.verdict && <button className="text-button danger" onClick={clearCurrent}>Clear current judgment</button>}
            </div>
          </section>
        )}

        {recall && (
          <section className="review-surface recall-surface" aria-labelledby="review-title">
            <div className="prompt-block">
              <p className="eyebrow">Blind recall audit · {recall.ability_type} / {recall.source_kind}</p>
              <h1 id="review-title">Does this source contain Hit-roll semantics?</h1>
              <p>If yes, select every exact occurrence in the source, then record its source-native fingerprint.</p>
            </div>
            <div className="source-commandbar">
              <span className={`vim-mode ${vimMode.toLowerCase()}`}>{vimMode}</span>
              <span><kbd>V</kbd> visual · <kbd>H/L</kbd> char · <kbd>W/B/E</kbd> word · <kbd>N</kbd>/<kbd>Shift N</kbd> cue · <kbd>Enter</kbd> fingerprint</span>
            </div>
            <div
              ref={sourceText}
              className="recall-source"
              role="textbox"
              aria-readonly="true"
              tabIndex={0}
              onMouseUp={captureSelection}
              onKeyDown={handleSourceKeyDown}
              aria-label="Recall audit source text"
              data-vim-mode={vimMode}
            >
              {hitHintSegments(recall.source_text).map((segment, segmentIndex) =>
                segment.hit ? (
                  <mark className="hit-hint" key={segmentIndex}>{segment.text}</mark>
                ) : (
                  <span key={segmentIndex}>{segment.text}</span>
                ),
              )}
            </div>
            <div className="selection-panel">
              <div className="selection-preview">
                <span>Selected bytes {sourceSelection.start}–{sourceSelection.end}</span>
                <strong>{sourceSelection.text || "Select text in the source above"}</strong>
              </div>
              <label>Fingerprint family<input ref={occurrenceFamilyInput} value={occurrenceFamily} onChange={(event) => setOccurrenceFamily(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  occurrenceParametersInput.current?.focus();
                }
              }} placeholder="e.g. reroll-hit" /></label>
              <label>Parameters JSON<textarea ref={occurrenceParametersInput} value={occurrenceParameters} onChange={(event) => setOccurrenceParameters(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  addOccurrence();
                }
              }} rows={3} spellCheck={false} /></label>
              <button className="secondary" onClick={addOccurrence} disabled={!sourceSelection.text}>Add grounded occurrence <kbd>⌘↵</kbd></button>
            </div>
            {recall.missed_occurrences.length > 0 && (
              <div className="occurrence-list">
                <h2>Grounded occurrences</h2>
                {recall.missed_occurrences.map((occurrence, occurrenceIndex) => (
                  <div className="occurrence-row" key={`${occurrence.span.start}:${occurrence.span.end}`}>
                    <div><strong>{occurrence.text}</strong><small>{occurrence.fingerprint.family} · bytes {occurrence.span.start}–{occurrence.span.end}</small></div>
                    <button className="quiet danger" onClick={() => deleteOccurrence(occurrenceIndex)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="recall-actions action-dock">
              <button className="verdict" onClick={() => markRecall(false)} disabled={recall.missed_occurrences.length > 0}><kbd>1</kbd> No Hit semantics</button>
              <button className="primary" onClick={() => markRecall(true)} disabled={recall.missed_occurrences.length === 0}><kbd>2</kbd> Complete with {recall.missed_occurrences.length} occurrence{recall.missed_occurrences.length === 1 ? "" : "s"}</button>
            </div>
          </section>
        )}

        <footer className="statusbar">
          <span className={error ? "error" : ""} role={error ? "alert" : "status"}>{error ?? status}</span>
          <div><span>{isDirty ? "Unsaved source changes" : "Source saved"}</span><button className="text-button" onClick={resetDraft}>Discard browser draft</button></div>
        </footer>
      </main>
    </div>
  );
}
