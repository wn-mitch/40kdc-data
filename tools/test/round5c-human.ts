/**
 * Test-only wrappers for the workbench's human decision functions. Fixtures act as the reviewer
 * through the `test` channel, with the reviewer the request body names, as `review-apply` does. Tests about authority itself import the real functions and pass actors explicitly.
 */
import type { DatabaseSync } from "node:sqlite";

import { humanActor } from "../src/round5c/authority.js";
import * as atoms from "../src/round5c/atoms.js";
import * as leaves from "../src/round5c/leaves.js";
import * as review from "../src/round5c/review.js";
import * as shapes from "../src/round5c/shapes.js";

function actorFor(body: unknown) {
  const reviewer = body !== null && typeof body === "object" && typeof (body as { reviewer?: unknown }).reviewer === "string"
    ? (body as { reviewer: string }).reviewer : "";
  return humanActor(reviewer, "test");
}

export const applyAnnotationBatch = (db: DatabaseSync, body: unknown) => review.applyAnnotationBatch(db, body, actorFor(body));
export const undoBatch = (db: DatabaseSync, batchId: string, body: unknown) => review.undoBatch(db, batchId, body, actorFor(body));
export const markPilotReviewed = (db: DatabaseSync, id: number, body: unknown) => review.markPilotReviewed(db, id, body, actorFor(body));
export const reviewAbility = (db: DatabaseSync, id: number, body: unknown) => review.reviewAbility(db, id, body, actorFor(body));
export const confirmSurface = (db: DatabaseSync, body: unknown) => leaves.confirmSurface(db, body, actorFor(body));
export const moveSurface = (db: DatabaseSync, body: unknown) => leaves.moveSurface(db, body, actorFor(body));
export const mergeFingerprints = (db: DatabaseSync, body: unknown) => leaves.mergeFingerprints(db, body, actorFor(body));
export const retireSurface = (db: DatabaseSync, body: unknown) => leaves.retireSurface(db, body, actorFor(body));
export const applySourceAtomBatch = (db: DatabaseSync, body: unknown) => atoms.applySourceAtomBatch(db, body, actorFor(body));
export const approveShape = (db: DatabaseSync, body: unknown) => shapes.approveShape(db, body, actorFor(body));
export const rejectShapeMembers = (db: DatabaseSync, body: unknown) => shapes.rejectShapeMembers(db, body, actorFor(body));
