import { describe, expect, it } from "vitest";
import { createValidator } from "../src/schema-loader.js";
import { hullShapeRecord, joinParts, meshOutline, parseObj, type Placement } from "../src/tts-hulls/outline.js";
import type { Vec2 } from "../src/terrain/resolve.js";

type Box = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];

/** An OBJ of axis-aligned boxes; `zUp` writes each vertex (x, y, z) as (x, -z, y), the way a Z-up exporter would. */
function obj(boxes: Box[], zUp = false): string {
  const lines: string[] = [];
  boxes.forEach(([x0, x1, y0, y1, z0, z1], b) => {
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
      lines.push(zUp ? `v ${x} ${-z} ${y}` : `v ${x} ${y} ${z}`);
    }
    const o = b * 8;
    // Corner index = 4*xi + 2*yi + zi, 1-based. Quads: bottom, top, and the four sides.
    for (const q of [[1, 3, 7, 5], [2, 6, 8, 4], [1, 2, 4, 3], [5, 7, 8, 6], [1, 5, 6, 2], [3, 4, 8, 7]]) {
      lines.push(`f ${q.map((i) => i + o).join(" ")}`);
    }
  });
  return lines.join("\n");
}

/** File units, Y up: a 2 × 4 body, a 1 × 1 foot on the +x side at the low-z end, and a 0.05-wide aerial off the high-z end. */
const L_BODY: Box[] = [
  [0, 2, 0, 1, 0, 4],
  [2, 3, 0, 1, 0, 1],
  [0.9, 0.95, 0, 2, 4, 5],
];
const UPRIGHT: Placement = { scale: 1, rotXDeg: 0, rotZDeg: 0 };

function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const area = (poly: Vec2[]) =>
  Math.abs(poly.reduce((s, a, i) => s + a.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * a.y, 0)) / 2;

const GV = { edition: "11th", dataslate: "2026-10-14" };

describe("TTS mesh hull outline", () => {
  it("projects the body straight down as TTS places it, without the thin aerial", () => {
    const rec = hullShapeRecord("test-hull", "Test Hull", meshOutline(parseObj(obj(L_BODY)), UPRIGHT), GV);
    // 3 wide (body + foot) by 4 long; the aerial would make it 5.
    expect(rec.bounds_width_in).toBeCloseTo(3, 1);
    expect(rec.bounds_height_in).toBeCloseTo(4, 1);
    // Body area 8 + foot 1. Area centroid in table coordinates (x mirrored, y = -z):
    // ((-1)·8 + (-2.5)·1) / 9 = -1.1667, ((-2)·8 + (-0.5)·1) / 9 = -1.8333.
    expect(area(rec.points)).toBeCloseTo(9, 1);
    // Unity mirrors file x, and the low-z end is the bottom of a y-down outline,
    // so the foot sits at the bottom left: centred, its middle is (-1.333, 1.833).
    expect(inside({ x: -1.333, y: 1.833 }, rec.points)).toBe(true);
    expect(inside({ x: 1.333, y: 1.833 }, rec.points)).toBe(false);
    expect(inside({ x: -1.333, y: -1.833 }, rec.points)).toBe(false);
  });

  it("stands a Z-up file upright with its saved rotation and applies the saved scale", () => {
    const upright = meshOutline(parseObj(obj(L_BODY)), { scale: 0.5, rotXDeg: 0, rotZDeg: 0 });
    const zUp = meshOutline(parseObj(obj(L_BODY, true)), { scale: 0.5, rotXDeg: -90, rotZDeg: 0 });
    const a = hullShapeRecord("a", "A", upright, GV);
    const b = hullShapeRecord("b", "B", zUp, GV);
    expect(a.bounds_width_in).toBeCloseTo(1.5, 1);
    expect(a.bounds_height_in).toBeCloseTo(2, 1);
    expect(b.points).toEqual(a.points);
  });

  it("projects an open-topped thin-walled shell as a solid footprint", () => {
    const t = 0.03;
    const shell: Box[] = [
      [0, 3, 0, 1, 0, t],
      [0, 3, 0, 1, 5 - t, 5],
      [0, t, 0, 1, 0, 5],
      [3 - t, 3, 0, 1, 0, 5],
    ];
    const rec = hullShapeRecord("shell", "Shell", meshOutline(parseObj(obj(shell)), UPRIGHT), GV);
    expect(area(rec.points)).toBeCloseTo(15, 0);
    expect(rec.points.length).toBeLessThanOrEqual(8);
  });

  it("drops a display base modelled into the mesh, measured from the mesh's lowest point", () => {
    // A 6 × 6 slab 0.1 thick whose underside sits 0.5 above the file origin, with a 2 × 4 body standing on it.
    const onBase: Box[] = [
      [-2, 4, 0.5, 0.6, -1, 5],
      [0, 2, 0.6, 2, 0, 4],
    ];
    const withBase = hullShapeRecord("b", "B", meshOutline(parseObj(obj(onBase)), UPRIGHT), GV);
    expect(withBase.bounds_width_in).toBeCloseTo(6, 1);
    const body = hullShapeRecord("b", "B", meshOutline(parseObj(obj(onBase)), { ...UPRIGHT, dropBelowIn: 0.15 }), GV);
    expect(body.bounds_width_in).toBeCloseTo(2, 1);
    expect(body.bounds_height_in).toBeCloseTo(4, 1);
  });

  it("joins child parts at their local Transform, rotated about Unity's Y", () => {
    // Parent: a 2 × 2 block centred on the origin. Child: a 4 × 1 bar, turned 90° about Y
    // (so it runs along Unity z), moved +1.5 along Unity x so it touches the block. Unity x is the file's -x.
    const parent = parseObj(obj([[-1, 1, 0, 1, -1, 1]]));
    const bar = parseObj(obj([[-2, 2, 0, 1, -0.5, 0.5]]));
    const joined = joinParts([{ mesh: parent }, { mesh: bar, position: [1.5, 0, 0], rotation: [0, 90, 0] }]);
    const rec = hullShapeRecord("j", "J", meshOutline(joined, UPRIGHT), GV);
    // Bar spans Unity x 1..2 and z -2..2; with the block, the footprint is 3 wide and 4 long.
    expect(rec.bounds_width_in).toBeCloseTo(3, 1);
    expect(rec.bounds_height_in).toBeCloseTo(4, 1);
    expect(area(rec.points)).toBeCloseTo(4 + 4, 0);
  });

  it("emits a schema-valid record centred on its area centroid", () => {
    const rec = hullShapeRecord("test-hull", "Test Hull", meshOutline(parseObj(obj(L_BODY)), UPRIGHT), GV);
    const validate = createValidator().getSchema("https://40kdc.dev/schemas/core/hull-shape.schema.json")!;
    expect(validate(rec), JSON.stringify(validate.errors)).toBe(true);
    const n = rec.points.length;
    let a2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const p = rec.points[i], q = rec.points[(i + 1) % n];
      const c = p.x * q.y - q.x * p.y;
      a2 += c;
      cx += (p.x + q.x) * c;
      cy += (p.y + q.y) * c;
    }
    expect(Math.abs(cx / (3 * a2))).toBeLessThan(0.002);
    expect(Math.abs(cy / (3 * a2))).toBeLessThan(0.002);
    for (const p of rec.points) {
      expect(Math.round(p.x * 1000) / 1000).toBe(p.x);
      expect(Math.round(p.y * 1000) / 1000).toBe(p.y);
    }
  });
});
