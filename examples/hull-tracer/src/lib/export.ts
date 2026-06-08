/**
 * Turns a traced pixel polygon into a schema-conformant `hull-shape` entity.
 *
 * The export type is the dataset's *generated* `HullShape` (a type-only import,
 * erased at build), so if the schema's field set ever changes this file stops
 * compiling — the tracer can never silently emit a stale shape. Nothing else
 * from the package reaches the browser bundle.
 *
 * The IP firewall lives here by construction: the only inputs are geometry +
 * identity, so there is no field that could carry the source image, a URL, or
 * any asset metadata.
 */
import type { HullShape } from "@alpaca-software/40kdc-data";
import { boundsSize, polygonCentroid, round } from "./geometry.js";
import type { GameVersion, Vec2 } from "./types.js";

export interface BuildHullShapeInput {
  id: string;
  name: string;
  /** Traced vertices in image pixels (y-down), in order around the outline. */
  pixelPoints: readonly Vec2[];
  /** Calibration: image pixels per real-world inch. */
  pxPerInch: number;
  gameVersion: GameVersion;
}

const COORD_DP = 3;

/**
 * Build the hull-shape entity. Vertices are scaled pixels→inches, then
 * re-centered on the polygon's area centroid so the stored outline is
 * origin-agnostic (matching the terrain footprint convention), and rounded to
 * {@link COORD_DP} decimals. Caller must guarantee ≥3 points and a positive
 * `pxPerInch` (see {@link canExport}).
 */
export function buildHullShape(input: BuildHullShapeInput): HullShape {
  const { id, name, pixelPoints, pxPerInch, gameVersion } = input;

  const inches: Vec2[] = pixelPoints.map((p) => ({
    x: p.x / pxPerInch,
    y: p.y / pxPerInch,
  }));
  const centroid = polygonCentroid(inches);
  const centered: Vec2[] = inches.map((p) => ({
    x: round(p.x - centroid.x, COORD_DP),
    y: round(p.y - centroid.y, COORD_DP),
  }));

  const size = boundsSize(centered);

  return {
    id,
    name,
    // Runtime-guaranteed ≥3 by canExport(); the tuple cast is the only place
    // the array shape meets the generated min-3 tuple type.
    points: centered as [Vec2, Vec2, Vec2, ...Vec2[]],
    bounds_width_in: round(size.width, COORD_DP),
    bounds_height_in: round(size.height, COORD_DP),
    // Fresh literal so it satisfies the generated GameVersionReference (which
    // carries an open index signature — the ref schema allows extra keys).
    game_version: { edition: gameVersion.edition, dataslate: gameVersion.dataslate },
  };
}

/** Serialize one hull shape as a one-element JSON array — the dataset's data
 * files are arrays, so the download drops straight into a `hull-shapes*.json`. */
export function hullShapeFileText(shape: HullShape): string {
  return JSON.stringify([shape], null, 2) + "\n";
}

/** The download filename. Begins with the `hull-shapes` prefix so the validator
 * resolves it to the hull-shape schema if dropped into `data/core/`. */
export const EXPORT_FILENAME = "hull-shapes.json";
