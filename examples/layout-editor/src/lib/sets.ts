/**
 * Terrain sets: editor-only macros that stamp a recurring area + parented
 * feature composition in one action. Definitions are mined from the committed
 * layouts (the consensus local placements across 4+ layouts), so a stamped set
 * matches how the same furniture is already arranged on real boards. Feature
 * positions are in the parent area's centroid-local frame — the convention the
 * resolver and `parent_area_id` use — so the whole set moves/rotates with the
 * area after stamping. Purely an authoring affordance: the exported JSON is
 * ordinary pieces, indistinguishable from hand-placed ones.
 */
import type { Mirror, Vec2 } from "./model.js";

export interface SetFeatureDef {
  template: string;
  /** Centroid in the parent area's centroid-local frame. */
  position: Vec2;
  rotation: number;
  mirror?: Mirror;
}

export interface TerrainSetDef {
  id: string;
  name: string;
  area: { template: string; rotation?: number };
  features: SetFeatureDef[];
}

export const TERRAIN_SETS: TerrainSetDef[] = [
  {
    id: "gantry-line",
    name: "Gantry strip",
    area: { template: "area-long-line" },
    features: [
      { template: "gantry", position: { x: 0, y: 0 }, rotation: 0 },
      { template: "barricade", position: { x: 2.93, y: 0 }, rotation: 180 },
      { template: "barricade", position: { x: -2.93, y: 0 }, rotation: 180 },
    ],
  },
  {
    id: "catwalk-line",
    name: "Catwalk strip",
    area: { template: "area-short-line" },
    features: [{ template: "catwalk", position: { x: 0, y: 0 }, rotation: 0 }],
  },
  {
    id: "pipe-line",
    name: "Pipe strip",
    area: { template: "area-short-line" },
    features: [{ template: "pipe", position: { x: 0, y: 0 }, rotation: 0 }],
  },
  {
    id: "generator-pad",
    name: "Generator pad",
    area: { template: "area-medium" },
    features: [{ template: "generator", position: { x: 0, y: 0 }, rotation: 90 }],
  },
  {
    id: "ruin-corners-medium",
    name: "Medium ruin corners",
    area: { template: "area-medium" },
    features: [
      { template: "corner-short", position: { x: -2.05, y: -0.6 }, rotation: 0 },
      { template: "corner-short", position: { x: 2.05, y: 0.6 }, rotation: 180 },
    ],
  },
  {
    id: "ruin-large",
    name: "Large ruin",
    area: { template: "area-large" },
    features: [
      { template: "corner-ruin-left", position: { x: -2.9, y: 2.31 }, rotation: 270 },
      { template: "corner-short", position: { x: 4.77, y: -1.97 }, rotation: 0 },
    ],
  },
];
