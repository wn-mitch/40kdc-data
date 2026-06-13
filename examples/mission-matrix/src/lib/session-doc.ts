/**
 * Saved match ⇄ live-session document mapping.
 *
 * In a shared session the two players score concurrently, so the mutable
 * per-side state is keyed under `sides.you` / `sides.opp`: an edit to one side
 * is a `set` op on a path disjoint from the other side's, and the two commute
 * under the server's total order instead of clobbering each other. The shared
 * scalars (dispositions, round, display prefs) are whole-value last-write-wins —
 * losing one of those races is benign; losing a side's scoring is not.
 *
 * Cloud-binding metadata (`cloudDocId`/`cloudName`) is deliberately NOT part of
 * the session doc — it's local to each device, never shared with a peer.
 */
import { emptyPlayerGame, type PlayerGame } from "@alpaca-software/40kdc-data";
import type { DocOp } from "../../../_shared/doc-protocol";
import type { PrimaryTicksByRound } from "./data.js";
import type { Saved } from "./save.js";

export interface SideState {
  game: PlayerGame;
  active: string | null;
  discards: string[];
  primaryTicks: PrimaryTicksByRound;
  cp: number;
}

export interface SessionDoc {
  dispYou: Saved["dispYou"];
  dispOpp: Saved["dispOpp"];
  round: number;
  keystoneFacing: boolean;
  autoCollapse: boolean;
  verbose: boolean;
  sides: { you: SideState; opp: SideState };
}

function sideOf(
  game: PlayerGame | undefined,
  active: string | null | undefined,
  discards: string[] | undefined,
  primaryTicks: PrimaryTicksByRound | undefined,
  cp: number | undefined,
): SideState {
  return {
    game: game ?? emptyPlayerGame(),
    active: active ?? null,
    discards: discards ?? [],
    primaryTicks: primaryTicks ?? {},
    cp: cp ?? 0,
  };
}

export function savedToSessionDoc(s: Saved): SessionDoc {
  return {
    dispYou: s.dispYou,
    dispOpp: s.dispOpp,
    round: s.round,
    keystoneFacing: s.keystoneFacing ?? true,
    autoCollapse: s.autoCollapse ?? true,
    verbose: s.verbose ?? false,
    sides: {
      you: sideOf(s.gameYou, s.activeYou, s.discardsYou, s.primaryTicksYou, s.cpYou),
      opp: sideOf(s.gameOpp, s.activeOpp, s.discardsOpp, s.primaryTicksOpp, s.cpOpp),
    },
  };
}

/** Flatten back to the storage shape. Cloud-binding fields are intentionally
 *  omitted — the adopting device keeps its own. */
export function sessionDocToSaved(d: SessionDoc): Saved {
  const you = d.sides?.you ?? sideOf(undefined, null, [], {}, 0);
  const opp = d.sides?.opp ?? sideOf(undefined, null, [], {}, 0);
  return {
    dispYou: d.dispYou ?? null,
    dispOpp: d.dispOpp ?? null,
    round: d.round ?? 1,
    keystoneFacing: d.keystoneFacing ?? true,
    autoCollapse: d.autoCollapse ?? true,
    verbose: d.verbose ?? false,
    gameYou: you.game,
    gameOpp: opp.game,
    activeYou: you.active,
    activeOpp: opp.active,
    discardsYou: you.discards,
    discardsOpp: opp.discards,
    primaryTicksYou: you.primaryTicks,
    primaryTicksOpp: opp.primaryTicks,
    cpYou: you.cp,
    cpOpp: opp.cp,
  };
}

/** Does this cloud payload carry the side-keyed session shape? (A doc that has
 *  been live-edited is stored session-shaped; uploads are storage-shaped.) */
export function isSessionShaped(payload: unknown): payload is SessionDoc {
  if (typeof payload !== "object" || payload === null) return false;
  const sides = (payload as { sides?: unknown }).sides;
  return (
    typeof sides === "object" &&
    sides !== null &&
    "you" in sides &&
    "opp" in sides
  );
}

/** Normalize any cloud payload (storage- or session-shaped) toward the `Saved`
 *  storage shape. */
export function fromCloudPayload(payload: unknown): unknown {
  return isSessionShaped(payload) ? sessionDocToSaved(payload) : payload;
}

/** The storage/interop shape for snapshot shortlinks (must stay openable even
 *  after the doc was live-edited). */
export function toSnapshotPayload(payload: unknown): unknown {
  return fromCloudPayload(payload);
}

/** Minimal op batch turning `prev` into `next`: whole-value sets for the shared
 *  scalars, and a per-side set when that side changed (disjoint paths). */
export function diffSessionDocs(prev: SessionDoc, next: SessionDoc): DocOp[] {
  const ops: DocOp[] = [];
  if (prev.dispYou !== next.dispYou) ops.push({ o: "set", p: ["dispYou"], v: next.dispYou });
  if (prev.dispOpp !== next.dispOpp) ops.push({ o: "set", p: ["dispOpp"], v: next.dispOpp });
  if (prev.round !== next.round) ops.push({ o: "set", p: ["round"], v: next.round });
  if (prev.keystoneFacing !== next.keystoneFacing)
    ops.push({ o: "set", p: ["keystoneFacing"], v: next.keystoneFacing });
  if (prev.autoCollapse !== next.autoCollapse)
    ops.push({ o: "set", p: ["autoCollapse"], v: next.autoCollapse });
  if (prev.verbose !== next.verbose) ops.push({ o: "set", p: ["verbose"], v: next.verbose });
  for (const side of ["you", "opp"] as const) {
    if (JSON.stringify(prev.sides[side]) !== JSON.stringify(next.sides[side])) {
      ops.push({ o: "set", p: ["sides", side], v: next.sides[side] });
    }
  }
  return ops;
}
