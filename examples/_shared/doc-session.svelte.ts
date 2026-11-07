/**
 * Generic live doc-session client (runes), modeled on shadowboxing's session
 * client but much smaller: the server owns the authoritative document and a
 * welcome always carries it in full, so reconnect = fresh welcome (no
 * snapshot uploads, no digests). The host app supplies two callbacks:
 *
 *  - onDoc(doc): replace local state with the authoritative document
 *    (welcome / reconnect / hard-resync after a rejected batch);
 *  - onRemoteOps(ops): apply a peer's ops to local state.
 *
 * The host sends its own local mutations via sendOps() — already applied
 * locally (optimistic); the server acks rather than echoing, so there is no
 * rebase. A peer op that arrives while this client has unacked ops was
 * ordered BEFORE them by the server, so applying it on top of the optimistic
 * state would invert that order (same-path edits would diverge for good);
 * the client resyncs instead: it re-sends `hello` (with an id) on the same
 * socket, and the welcome that echoes that id is ordered after every op this
 * socket already sent, so it carries their server-ordered result. Edits made
 * while that welcome is pending are queued and replayed onto it. Joining is free (the link token is the auth); creation is
 * entitlement-gated by the worker.
 *
 * Two room flavors share this client:
 *
 *  - DOC-BOUND (`?d=<docId>&token=` live doc links — the Google-docs model):
 *    the room is a cloud doc's live presence; edits persist server-side.
 *    Enter via goLive() (owner) or requestDocJoin() (link holder). When the
 *    live room can't be joined (capacity), the client degrades to a
 *    read-only `snapshot` of the at-rest doc with a Retry affordance.
 *
 *  - EPHEMERAL (`?session=CODE&token=` invite links): the original
 *    create-from-current-state rooms; kept so old links keep working.
 *
 * Connecting needs a nickname; when none is remembered the session enters
 * `prompt-nickname` and waits for confirmNickname() from the widget.
 */
import { storedEntitlement } from "./entitlement.svelte";
import {
  createDoc,
  docInviteUrl,
  getSharedDoc,
  putDoc,
  shareDoc,
  SYNC_URL,
  type DocKind,
} from "./sync-api";
import { saveNickname, storedNickname } from "./nickname";
import { applyDocOps, type DocOp, type Participant, type ServerMessage } from "./doc-protocol";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export interface DocSessionState {
  status: "idle" | "prompt-nickname" | "connecting" | "connected" | "snapshot" | "error";
  /** Ephemeral-session code (null for doc-bound rooms). */
  code: string | null;
  /** Cloud doc backing the room (null for ephemeral sessions). */
  docId: string | null;
  /** Cloud doc name, from the welcome (or the snapshot fallback). */
  docName: string | null;
  role: "editor" | "viewer" | null;
  /** Our own participant id, for "(you)" in rosters. */
  participantId: string | null;
  participants: Participant[];
  /** Share links for inviting others (both set for the creator; joiners get
   *  the one their own token can mint). */
  editorLink: string | null;
  viewerLink: string | null;
  error: string | null;
  /** True when the last create attempt was refused for lack of entitlement. */
  entitlementRequired: boolean;
}

export const docSession = $state<DocSessionState>({
  status: "idle",
  code: null,
  docId: null,
  docName: null,
  role: null,
  participantId: null,
  participants: [],
  editorLink: null,
  viewerLink: null,
  error: null,
  entitlementRequired: false,
});

export interface DocSessionCallbacks {
  onDoc: (doc: unknown) => void;
  onRemoteOps: (ops: DocOp[]) => void;
}

let callbacks: DocSessionCallbacks | null = null;
let ws: WebSocket | null = null;
/** Where to (re)connect: an ephemeral session's code or a doc id. */
type Target = { kind: "session"; code: string } | { kind: "doc"; docId: string };
let target: Target | null = null;
let connectToken: string | null = null;
let nicknameMemo = "";
/** Join waiting on the nickname prompt (doc-bound entry points). */
let pendingJoin: { docId: string; token: string } | null = null;
/** Welcome received on the CURRENT socket — distinguishes a refused join
 *  (snapshot fallback) from a dropped established connection (reconnect). */
let welcomed = false;
let clientSeq = 0;
/** Op batches sent on the current socket that the server hasn't acked yet. */
let unackedOps = 0;
/** Id of the resync hello whose welcome hasn't arrived yet (null: none). */
let pendingHelloId: number | null = null;
let helloSeq = 0;
/** Local edits made while a resync is pending, replayed onto its welcome. */
let queuedOps: DocOp[][] = [];
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Deliberate leave — suppresses the reconnect loop. */
let closing = false;

export function registerDocSession(cb: DocSessionCallbacks): void {
  callbacks = cb;
}

function inviteLink(code: string, token: string): string {
  return `${location.origin}${location.pathname}?session=${code}&token=${token}`;
}

// ── Doc-bound rooms (live doc links) ─────────────────────────────────────────

/**
 * Owner entry point: make the current document live and join as editor.
 * Creates the cloud doc when `docId` is absent; otherwise seeds the room by
 * uploading the current local state first (unless the doc is already live —
 * then the living state wins and the welcome adopts it). Returns the doc id
 * so the host can remember it for next time, or null on refusal.
 */
export async function goLive(
  kind: DocKind,
  name: string,
  payload: unknown,
  opts: { docId?: string | null } = {},
): Promise<string | null> {
  const entitlement = storedEntitlement();
  docSession.entitlementRequired = false;
  docSession.error = null;
  if (!entitlement) {
    docSession.entitlementRequired = true;
    return null;
  }

  let docId = opts.docId ?? null;
  if (docId) {
    // Seed the room with the host's current state. doc_live means others are
    // already editing — join and adopt the living state instead.
    const put = await putDoc(entitlement, docId, { payload });
    if (!put.ok && !("conflict" in put)) {
      if (put.status === 401 || put.status === 403) {
        docSession.entitlementRequired = true;
        return null;
      }
      if (put.status === 404) {
        docId = null; // the doc was deleted on another device — recreate
      } else if (put.error !== "doc_live") {
        docSession.status = "error";
        docSession.error = `Couldn't update the cloud doc (${put.error}).`;
        return null;
      }
    }
  }
  if (!docId) {
    const created = await createDoc(entitlement, { kind, name, payload });
    if (!created.ok) {
      if (created.status === 401 || created.status === 403) {
        docSession.entitlementRequired = created.error !== "doc_quota_exceeded";
        docSession.error =
          created.error === "doc_quota_exceeded"
            ? "Cloud is full — delete some saves first."
            : null;
        if (docSession.error) docSession.status = "error";
        return null;
      }
      docSession.status = "error";
      docSession.error = `Couldn't create the cloud doc (${created.error}).`;
      return null;
    }
    docId = created.value.id;
  }

  const share = await shareDoc(entitlement, docId);
  if (!share.ok) {
    docSession.status = "error";
    docSession.error = `Couldn't mint share links (${share.error}).`;
    return null;
  }
  docSession.editorLink = docInviteUrl(
    location.origin,
    location.pathname,
    docId,
    share.value.editorToken,
  );
  docSession.viewerLink = docInviteUrl(
    location.origin,
    location.pathname,
    docId,
    share.value.viewerToken,
  );
  requestDocJoin(docId, share.value.editorToken);
  return docId;
}

/** Link-holder entry point (`?d=&token=` — and goLive's own join). Prompts
 *  for a nickname first when none is remembered. */
export function requestDocJoin(docId: string, token: string): void {
  pendingJoin = { docId, token };
  docSession.error = null;
  const nickname = storedNickname();
  if (!nickname) {
    docSession.status = "prompt-nickname";
    docSession.docId = docId;
    return;
  }
  connect({ kind: "doc", docId }, token, nickname);
}

/** The widget's answer to `prompt-nickname`. */
export function confirmNickname(name: string): void {
  saveNickname(name);
  if (docSession.status === "prompt-nickname" && pendingJoin) {
    connect({ kind: "doc", docId: pendingJoin.docId }, pendingJoin.token, name);
  }
}

/** Re-attempt a live join after a `snapshot` fallback. */
export function retryLive(): void {
  if (pendingJoin) requestDocJoin(pendingJoin.docId, pendingJoin.token);
}

/** Rename in place (and remember it). No reconnect needed. */
export function sendNickname(name: string): void {
  saveNickname(name);
  nicknameMemo = name;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ t: "nick", nickname: name }));
  }
}

// ── Ephemeral sessions (legacy `?session=` invite links) ─────────────────────

/** Create an ephemeral room seeded with the current document, then join as
 *  editor. Superseded by goLive() for the example apps — kept so existing
 *  integrations and old invite links keep working. */
export async function createDocSession(
  kind: DocKind,
  doc: unknown,
  nickname: string,
): Promise<void> {
  const entitlement = storedEntitlement();
  docSession.entitlementRequired = false;
  docSession.error = null;
  if (!entitlement) {
    docSession.entitlementRequired = true;
    return;
  }
  docSession.status = "connecting";
  try {
    const res = await fetch(`${SYNC_URL.replace(/\/$/, "")}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${entitlement}`,
      },
      body: JSON.stringify({ kind, payload: doc }),
    });
    if (res.status === 401 || res.status === 403) {
      docSession.entitlementRequired = true;
      docSession.status = "idle";
      return;
    }
    if (res.status === 503) {
      docSession.status = "error";
      docSession.error = "All session slots are in use right now — try again soon.";
      return;
    }
    if (!res.ok) throw new Error(`create failed (${res.status})`);
    const { code, editorToken, viewerToken } = (await res.json()) as {
      code: string;
      editorToken: string;
      viewerToken: string;
    };
    docSession.editorLink = inviteLink(code, editorToken);
    docSession.viewerLink = inviteLink(code, viewerToken);
    connect({ kind: "session", code }, editorToken, nickname);
  } catch (e) {
    docSession.status = "error";
    docSession.error = e instanceof Error ? e.message : "create failed";
  }
}

/** Join an existing ephemeral room from a code + link token (free). */
export function joinDocSession(code: string, token: string, nickname: string): void {
  docSession.error = null;
  connect({ kind: "session", code: code.toUpperCase() }, token, nickname);
}

// ── Shared connection machinery ──────────────────────────────────────────────

export function leaveDocSession(): void {
  closing = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  ws?.close(1000, "leaving");
  ws = null;
  target = null;
  pendingJoin = null;
  docSession.status = "idle";
  docSession.code = null;
  docSession.docId = null;
  docSession.docName = null;
  docSession.role = null;
  docSession.participantId = null;
  docSession.participants = [];
  docSession.editorLink = null;
  docSession.viewerLink = null;
  docSession.error = null;
}

/** Send a locally-applied op batch (editors only; no-op otherwise). */
export function sendOps(ops: DocOp[]): void {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN ||
    docSession.status !== "connected" ||
    docSession.role !== "editor" ||
    ops.length === 0
  ) {
    return;
  }
  if (pendingHelloId !== null) {
    // Sent now, it would reach the server after the resync hello, so the
    // welcome would omit it while replacing local state. Replay it instead.
    queuedOps.push(ops);
    return;
  }
  transmit(ops);
}

function transmit(ops: DocOp[]): void {
  if (!ws) return;
  clientSeq += 1;
  unackedOps += 1;
  ws.send(JSON.stringify({ t: "op", clientSeq, ops }));
}

function wsUrl(t: Target, token: string): string {
  const base = SYNC_URL.replace(/^http/, "ws").replace(/\/$/, "");
  return t.kind === "doc"
    ? `${base}/docs/${encodeURIComponent(t.docId)}/ws?token=${encodeURIComponent(token)}`
    : `${base}/session/${t.code}/ws?token=${encodeURIComponent(token)}`;
}

function sameTarget(a: Target | null, b: Target): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "doc" ? a.docId === (b as { docId: string }).docId : a.code === (b as { code: string }).code;
}

function connect(t: Target, token: string, nickname: string): void {
  // Edits queued during a resync survive a reconnect to the same room: the
  // new socket's first welcome is ordered after nothing of ours, so they are
  // replayed onto it like the resync answer.
  // (leaveDocSession nulls the target, so a leave always clears them.)
  if (!sameTarget(target, t)) queuedOps = [];
  closing = false;
  target = t;
  connectToken = token;
  nicknameMemo = nickname;
  welcomed = false;
  unackedOps = 0;
  pendingHelloId = null;
  docSession.status = "connecting";
  docSession.code = t.kind === "session" ? t.code : null;
  docSession.docId = t.kind === "doc" ? t.docId : null;

  const socket = new WebSocket(wsUrl(t, token));
  ws = socket;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ t: "hello", nickname, lastSeq: 0 }));
  });

  socket.addEventListener("message", (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      return;
    }
    if (ws !== socket) return; // superseded socket — its traffic is stale
    if (msg.t === "welcome") {
      if (pendingHelloId !== null && msg.helloId !== pendingHelloId) {
        // Unsolicited (the room reloaded its row) while our resync is out:
        // the answer to our hello is ordered later and supersedes it.
        return;
      }
      if (pendingHelloId === null && welcomed && unackedOps > 0) {
        // A re-welcome (the room reloaded its row) while our ops are still in
        // flight: the server will apply them to the reloaded doc after this
        // welcome, so adopting it would drop them locally. Resync; the answer
        // carries their server-ordered result.
        resync(socket);
        return;
      }
      pendingHelloId = null;
      welcomed = true;
      unackedOps = 0;
      docSession.status = "connected";
      docSession.role = msg.role;
      docSession.participantId = msg.participantId;
      docSession.participants = msg.participants;
      docSession.docName = msg.name ?? docSession.docName;
      docSession.error = null;
      reconnectDelay = RECONNECT_MIN_MS;
      // A joiner can mint the invite link for their own role from their token.
      if (t.kind === "doc" && connectToken) {
        const link = docInviteUrl(location.origin, location.pathname, t.docId, connectToken);
        if (msg.role === "editor" && !docSession.editorLink) docSession.editorLink = link;
        if (msg.role === "viewer" && !docSession.viewerLink) docSession.viewerLink = link;
      }
      let doc = msg.doc;
      // Replay edits queued during a resync (or carried across a reconnect)
      // onto the welcome, sending the ones that still apply; the rest target
      // state that's gone. The queue is empty for any other welcome.
      const replay = queuedOps;
      queuedOps = [];
      for (const ops of replay) {
        try {
          doc = applyDocOps(doc, ops);
        } catch {
          continue;
        }
        transmit(ops);
      }
      callbacks?.onDoc(doc);
    } else if (msg.t === "ack") {
      unackedOps = Math.max(0, unackedOps - 1);
    } else if (msg.t === "op") {
      if (pendingHelloId !== null) {
        // Already reflected in the welcome that answers our resync hello.
      } else if (unackedOps > 0) {
        // Ordered before our in-flight ops — take the server's document
        // rather than replaying it out of order (see the header).
        resync(socket);
      } else {
        callbacks?.onRemoteOps(msg.ops);
      }
    } else if (msg.t === "presence") {
      docSession.participants = msg.participants;
    } else if (msg.t === "error") {
      if (msg.code === "bad_ops") {
        // The doc diverged — resync for a fresh welcome.
        resync(socket);
      } else if (msg.code === "doc_too_large") {
        // The room refused to outgrow the cloud cap; resync sheds the
        // over-cap local change.
        docSession.error = "That change made the document too large to sync — it was rolled back.";
        resync(socket);
      } else if (msg.code === "read_only") {
        docSession.error = "You're viewing this session — ask for an editor link to make changes.";
      }
    }
  });

  socket.addEventListener("close", () => {
    if (ws !== socket) return; // superseded by a newer connect
    ws = null;
    if (closing) return;
    if (t.kind === "doc" && !welcomed) {
      // The join itself was refused (capacity / revoked / deleted) — the
      // anonymous snapshot probe tells us which, and serves read-only state.
      void fallbackToSnapshot(t.docId, token);
      return;
    }
    // Drop to connecting and retry with backoff; a fresh welcome restores
    // the exact document, so nothing is lost by reconnecting.
    docSession.status = "connecting";
    reconnectTimer = setTimeout(() => {
      if (!closing && target && connectToken) {
        connect(target, connectToken, nicknameMemo);
      }
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  });

  socket.addEventListener("error", () => {
    /* close fires next; the close handler owns retry */
  });
}

/** Ask for a fresh welcome on the same socket (see the header). */
function resync(socket: WebSocket): void {
  if (pendingHelloId !== null) return;
  pendingHelloId = ++helloSeq;
  socket.send(JSON.stringify({ t: "hello", nickname: nicknameMemo, lastSeq: 0, id: pendingHelloId }));
}

/** A doc-bound join was refused — open the at-rest doc read-only when the
 *  link is still good (capacity), or surface the honest failure when not. */
async function fallbackToSnapshot(docId: string, token: string): Promise<void> {
  try {
    const res = await getSharedDoc(docId, token);
    if (closing) return;
    if (res.ok) {
      docSession.status = "snapshot";
      docSession.docName = res.value.name;
      docSession.role = res.value.role;
      docSession.participants = [];
      docSession.error =
        "Live session is full right now — opened the latest saved copy (read-only).";
      callbacks?.onDoc(res.value.payload);
    } else {
      docSession.status = "error";
      docSession.error =
        res.status === 404
          ? "That document no longer exists."
          : "This link has been revoked — ask for a fresh one.";
    }
  } catch {
    // The probe couldn't reach the server either — a plain network drop;
    // retry the live join with backoff like any lost connection.
    docSession.status = "connecting";
    reconnectTimer = setTimeout(() => {
      if (!closing && target && connectToken) {
        connect(target, connectToken, nicknameMemo);
      }
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}

/** Parse `?session=CODE&token=UUID` (the ephemeral invite-link shape). */
export function parseSessionInvite(search: string): { code: string; token: string } | null {
  const params = new URLSearchParams(search);
  const code = params.get("session") ?? "";
  const token = params.get("token") ?? "";
  return /^[A-HJ-NP-Z2-9]{6}$/i.test(code) && token ? { code: code.toUpperCase(), token } : null;
}
