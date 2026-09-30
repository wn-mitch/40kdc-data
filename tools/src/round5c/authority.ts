/**
 * Who may make which semantic decision. Three authorities, ranked:
 *
 * - `human`: a decision Will made on this row through a human channel (the review UI bridge or
 *   a TTY-confirmed `review apply`).
 * - `derived`: a mechanical copy of a human decision (a human-founded leaf surface applied to
 *   another occurrence, a family-version migration of a human row). Trusted like `human`.
 * - `machine`: anything a model or pipeline decided. Never trusted: it never counts toward
 *   coverage, examples, shapes, gates-for-publication or publish.
 *
 * Machine callers can only obtain a `MachineActor`; a `HumanActor` carries a brand that only
 * `humanActor` mints. `test/round5c-authority.test.ts` pins the set of modules allowed to call it.
 */

export const AUTHORITY_KINDS = ["human", "derived", "machine"] as const;
export type Authority = (typeof AUTHORITY_KINDS)[number];

const RANK: Record<Authority, number> = { machine: 0, derived: 1, human: 2 };

/** Whether a write of `writer` authority may replace an active row of `existing` authority. */
export function mayReplace(writer: Authority, existing: Authority): boolean {
  return RANK[writer] >= RANK[existing];
}

export function isTrusted(authority: Authority): boolean {
  return authority !== "machine";
}

/** SQL predicate over `annotations`: the row is trusted (human or derived). */
export const TRUSTED_ANNOTATION = "(annotations.authority_kind IN ('human', 'derived'))";

/**
 * Reviewer names that belong to Will's review surfaces or to rows Will approved before authority
 * was recorded (approved leaf stamps, the Round 5B hit-train import).
 */
export const HUMAN_REVIEWERS: ReadonlySet<string> = new Set(["will", "local-reviewer", "deterministic-stamp-engine", "round5b-import"]);

/** Reviewer names of pipelines and models. `jev-v2-round-<n>` is matched by pattern. */
export const MACHINE_REVIEWERS: ReadonlySet<string> = new Set(["pipeline-8b", "pilot-auto", "claude-assist", "phase4-8b-fib"]);

export function isMachineReviewer(reviewer: string): boolean {
  return MACHINE_REVIEWERS.has(reviewer) || /^jev-v2-round-\d+$/u.test(reviewer);
}

declare const humanBrand: unique symbol;

export type HumanActor = { readonly authority: "human"; readonly reviewer: string; readonly channel: HumanChannel; readonly [humanBrand]: true };
export type MachineActor = { readonly authority: "machine"; readonly reviewer: string };
export type Actor = HumanActor | MachineActor;

/** Where a human decision entered the system. `test` is for the test suite's own fixtures. */
export type HumanChannel = "review-bridge" | "review-apply" | "test";

export class AuthorityError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "AuthorityError";
  }
}

/** Mint a human actor. Only the review bridge, `review apply`, and tests may call this. */
export function humanActor(reviewer: string, channel: HumanChannel): HumanActor {
  if (!reviewer.trim()) throw new AuthorityError("A human decision needs a reviewer.");
  if (isMachineReviewer(reviewer) || reviewer === "system") throw new AuthorityError(`"${reviewer}" is a machine reviewer name.`);
  return { authority: "human", reviewer, channel } as HumanActor;
}

/** A model or pipeline actor. Its reviewer name must never collide with a human one. */
export function machineActor(reviewer: string): MachineActor {
  if (!reviewer.trim()) throw new AuthorityError("A machine decision needs a reviewer name.");
  if (HUMAN_REVIEWERS.has(reviewer)) throw new AuthorityError(`"${reviewer}" is a human reviewer name.`);
  return { authority: "machine", reviewer };
}

/** The authority of a row a surface writes at an occurrence: human surfaces derive, machine ones stay machine. */
export function propagatedAuthority(surfaceAuthority: "human" | "machine"): "derived" | "machine" {
  return surfaceAuthority === "human" ? "derived" : "machine";
}

/** Throw unless the actor is human; for decisions only Will may make. */
export function requireHuman(actor: Actor, what: string): asserts actor is HumanActor {
  if (actor.authority !== "human") throw new AuthorityError(`Only a human reviewer may ${what}.`);
}

/** Throw unless the body's reviewer (when given) is the actor's reviewer. */
export function assertReviewer(actor: Actor, reviewer: unknown): void {
  if (reviewer !== undefined && reviewer !== actor.reviewer) {
    throw new AuthorityError(`The request names reviewer "${String(reviewer)}" but was made by "${actor.reviewer}".`);
  }
}
