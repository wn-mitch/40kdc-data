#!/usr/bin/env python3
"""Extract official terrain layouts from the GW Event Companion PDF.

Authoring-time tooling only (like tools/src/extract-faction-pack.ts): it reads
a gitignored PDF from _private/, never runs in CI, and never emits GW prose —
only geometry (positions/rotations/mirrors of terrain pieces, which the
dataset already models as numerical facts).

Pipeline
--------
The PDF places each layout page's board as one large raster image and every
terrain feature as a separate image stamp with its own CTM. Identical artwork
reuses the same image xref across pages, so a one-time calibration against the
hand-authored take-and-hold-mirror-{1,2,3} entries (pages 9-11) learns, per
xref: which template it depicts, the artwork-vs-template rotation offset, the
mirror parity, and the artwork-center -> footprint-centroid offset. With that
table, any layout page decomposes into schema-shaped pieces.

Subcommands:
  selfcheck   port-validate the Python resolver against conformance cases
  census      locate layout pages, parse matchup + variant headers
  calibrate   learn xref -> template calibration from the mirror ground truth
  extract     emit candidate layout JSON for given pages (uses calibration)
  verify      resolve candidates vs committed mirrors, report vertex deltas

Working artifacts land in _private/terrain-scrape/ (gitignored).

Usage:
  python3 tools/extract-terrain-layouts.py selfcheck
  python3 tools/extract-terrain-layouts.py census
  python3 tools/extract-terrain-layouts.py calibrate
  python3 tools/extract-terrain-layouts.py verify        # pages 9-11 proof
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PDF = next(
    iter(sorted(REPO.glob("_private/*event_companion-s3bfb5f9s1*.pdf"))), None
)
SCRAPE_DIR = REPO / "_private" / "terrain-scrape"
LAYOUTS_PATH = REPO / "data" / "core" / "terrain-layouts.json"
TEMPLATES_PATH = REPO / "data" / "core" / "terrain-templates.json"
MATCHUPS_PATH = REPO / "data" / "core" / "mission-matchups.json"
CASES_PATH = REPO / "conformance" / "terrain-resolver" / "cases.json"

BOARD_W, BOARD_H = 60.0, 44.0

# ── Resolver port (mirrors tools/src/terrain/resolve.ts; validated by `selfcheck`)

def footprint_vertices(fp: dict) -> list[tuple[float, float]]:
    t = fp["type"]
    if t == "rectangle":
        w, h = fp["width"], fp["height"]
        return [(0, 0), (w, 0), (w, h), (0, h)]
    if t == "right-triangle":
        w, h = fp["width"], fp["height"]
        return [(0, 0), (w, 0), (0, h)]
    if t == "polygon":
        return [(p["x"], p["y"]) for p in fp["points"]]
    raise ValueError(f"unknown footprint type {t}")


def polygon_centroid(verts: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(verts)
    if n == 0:
        return (0.0, 0.0)
    twice_area = cx = cy = 0.0
    for i in range(n):
        ax, ay = verts[i]
        bx, by = verts[(i + 1) % n]
        cross = ax * by - bx * ay
        twice_area += cross
        cx += (ax + bx) * cross
        cy += (ay + by) * cross
    if twice_area == 0:
        return (sum(v[0] for v in verts) / n, sum(v[1] for v in verts) / n)
    return (cx / (3 * twice_area), cy / (3 * twice_area))


def _orient(x: float, y: float, rotation: float, mirror: str) -> tuple[float, float]:
    if mirror == "horizontal":
        x = -x
    elif mirror == "vertical":
        y = -y
    if rotation:
        r = math.radians(rotation)
        c, s = math.cos(r), math.sin(r)
        x, y = c * x - s * y, s * x + c * y
    return (x, y)


def _place(fp: dict, position: dict, rotation: float, mirror: str) -> list[tuple[float, float]]:
    verts = footprint_vertices(fp)
    cx, cy = polygon_centroid(verts)
    out = []
    for vx, vy in verts:
        ox, oy = _orient(vx - cx, vy - cy, rotation, mirror)
        out.append((ox + position["x"], oy + position["y"]))
    return out


def _round4(v: float) -> float:
    return round(v * 1e4) / 1e4


def resolve_layout(layout: dict, templates: list[dict]) -> list[dict]:
    by_id = {t["id"]: t for t in templates}
    pieces = layout.get("pieces") or []
    areas = {p["id"]: p for p in pieces if p.get("id")}
    out: list[dict] = []

    def fp_of(piece: dict, where: str) -> dict:
        if piece.get("footprint"):
            return piece["footprint"]
        tid = piece.get("template")
        if tid:
            if tid not in by_id:
                raise ValueError(f'{where}: unknown template "{tid}"')
            return by_id[tid]["footprint"]
        raise ValueError(f"{where}: piece has neither footprint nor template")

    for piece in pieces:
        where = piece.get("id") or piece.get("name") or "<piece>"
        fp = fp_of(piece, where)
        rotation = piece.get("rotation_degrees", 0)
        mirror = piece.get("mirror", "none")
        ptype = piece.get("piece_type") or ("feature" if piece.get("parent_area_id") else "area")

        if piece.get("parent_area_id"):
            parent = areas.get(piece["parent_area_id"])
            if parent is None:
                raise ValueError(f'{where}: unknown parent_area_id "{piece["parent_area_id"]}"')
            area_local = _place(fp, piece["position"], rotation, mirror)
            a_rot = parent.get("rotation_degrees", 0)
            a_mir = parent.get("mirror", "none")
            verts = []
            for x, y in area_local:
                ox, oy = _orient(x, y, a_rot, a_mir)
                verts.append({"x": _round4(ox + parent["position"]["x"]), "y": _round4(oy + parent["position"]["y"])})
            out.append({"id": piece.get("id"), "name": piece.get("name"), "piece_type": ptype,
                        "floor": piece.get("floor", 0), "vertices": verts})
            continue

        verts = [{"x": _round4(x), "y": _round4(y)} for x, y in _place(fp, piece["position"], rotation, mirror)]
        out.append({"id": piece.get("id"), "name": piece.get("name"), "piece_type": ptype,
                    "floor": piece.get("floor", 0), "vertices": verts})

        tid = piece.get("template")
        if tid and by_id.get(tid, {}).get("features"):
            for feat in by_id[tid]["features"]:
                ft = by_id.get(feat["template"])
                if ft is None:
                    raise ValueError(f'{where}: composed feature references unknown template "{feat["template"]}"')
                area_local = _place(ft["footprint"], feat["position"],
                                    feat.get("rotation_degrees", 0), feat.get("mirror", "none"))
                fverts = []
                for x, y in area_local:
                    ox, oy = _orient(x, y, rotation, mirror)
                    fverts.append({"x": _round4(ox + piece["position"]["x"]), "y": _round4(oy + piece["position"]["y"])})
                out.append({"id": feat.get("id"), "name": ft.get("name"), "piece_type": "feature",
                            "floor": feat.get("floor", 0), "vertices": fverts})
    return out


def cmd_selfcheck(_args) -> int:
    cases = json.loads(CASES_PATH.read_text())
    failures = 0
    for case in cases:
        got = resolve_layout(case["layout"], case["templates"])
        want = case["expected"]["pieces"]
        ok = len(got) == len(want)
        if ok:
            for g, w in zip(got, want):
                gv = [(v["x"], v["y"]) for v in g["vertices"]]
                wv = [(v["x"], v["y"]) for v in w["vertices"]]
                if gv != wv or g["id"] != w["id"] or g["piece_type"] != w["piece_type"]:
                    ok = False
                    break
        print(f"  {'ok ' if ok else 'FAIL'} {case['name']}")
        failures += 0 if ok else 1
    print(f"selfcheck: {len(cases) - failures}/{len(cases)} cases reproduced")
    return 1 if failures else 0


# ── PDF access ───────────────────────────────────────────────────────────────

def open_pdf(path: Path):
    import fitz  # PyMuPDF

    if not path or not path.exists():
        sys.exit(f"PDF not found: {path} (expected under _private/)")
    return fitz.open(str(path))


HEADER_RE = re.compile(r"LAYOUT ([ABC])")

DISPOSITION_NAMES = [
    "TAKE AND HOLD",
    "DISRUPTION",
    "PURGE THE FOE",
    "PRIORITY ASSETS",
    "RECONNAISSANCE",
]


def page_header(page) -> tuple[str, str, int] | None:
    """(matchup_slug, header_line, variant) for a layout page, else None.

    PyMuPDF's text comes out block-ordered, not visually-lined, so the two
    disposition names are recovered positionally: search the page for each of
    the five known labels and keep the hits adjacent to the "VS" marker, in
    left-to-right (printed) order.
    """
    text = page.get_text()
    m = HEADER_RE.search(text)
    if m is None or "FORCE DISPOSITION" not in text:
        return None
    variant = "ABC".index(m.group(1)) + 1

    vs_rects = page.search_for("VS")
    hits = []
    for name in DISPOSITION_NAMES:
        for rect in page.search_for(name):
            hits.append((rect, name))
    if not vs_rects or len(hits) < 2:
        return None
    # The header pair straddles a "VS" at roughly the same height.
    for vs in vs_rects:
        row = [(r, n) for r, n in hits if abs((r.y0 + r.y1) / 2 - (vs.y0 + vs.y1) / 2) < r.height * 1.5]
        left = [(r, n) for r, n in row if r.x1 <= vs.x0]
        right = [(r, n) for r, n in row if r.x0 >= vs.x1]
        if left and right:
            lname = max(left, key=lambda h: h[0].x1)[1]
            rname = min(right, key=lambda h: h[0].x0)[1]
            slug = f"{_slug(lname)}-vs-{_slug(rname)}"
            return slug, f"{lname} VS {rname}", variant
    return None


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def cmd_census(args) -> int:
    doc = open_pdf(args.pdf)
    matchups = {m["id"] for m in json.loads(MATCHUPS_PATH.read_text())}
    found = []
    for i in range(len(doc)):
        h = page_header(doc[i])
        if h:
            slug, line, variant = h
            known = slug in matchups
            found.append((i + 1, slug, variant, known))
            print(f"  p{i+1:<3} {slug:<55} variant {variant} {'' if known else '  ← UNKNOWN MATCHUP'}")
    by_slug = defaultdict(set)
    for _, slug, variant, _k in found:
        by_slug[slug].add(variant)
    complete = sum(1 for v in by_slug.values() if v == {1, 2, 3})
    print(f"census: {len(found)} layout pages, {len(by_slug)} matchups ({complete} with all 3 variants)")
    return 0


# ── Geometry recovery ────────────────────────────────────────────────────────

class Mat:
    """2x3 affine: [a b; c d] linear + (e, f) translation, row-vector PDF style."""

    def __init__(self, a, b, c, d, e, f):
        self.a, self.b, self.c, self.d, self.e, self.f = a, b, c, d, e, f

    def apply(self, x, y):
        return (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)

    def compose(self, other: "Mat") -> "Mat":
        """self then other (row-vector convention: v * self * other)."""
        return Mat(
            self.a * other.a + self.b * other.c,
            self.a * other.b + self.b * other.d,
            self.c * other.a + self.d * other.c,
            self.c * other.b + self.d * other.d,
            self.e * other.a + self.f * other.c + other.e,
            self.e * other.b + self.f * other.d + other.f,
        )

    def invert(self) -> "Mat":
        det = self.a * self.d - self.b * self.c
        ia, ib = self.d / det, -self.b / det
        ic, id_ = -self.c / det, self.a / det
        ie = -(self.e * ia + self.f * ic)
        if_ = -(self.e * ib + self.f * id_)
        return Mat(ia, ib, ic, id_, ie, if_)


def board_transform(page) -> tuple[Mat, dict] | None:
    """Map page space -> board inches (y-down). The board is the page's largest
    image with a ~60:44 aspect; its CTM maps the unit square onto the page."""
    import fitz

    best, best_area = None, 0.0
    for info in page.get_image_info(xrefs=True):
        bbox = info["bbox"]
        area = abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
        w, h = info["width"], info["height"]
        if h == 0:
            continue
        aspect = w / h
        if 1.2 < aspect < 1.55 and area > best_area:
            best, best_area = info, area
    if best is None:
        return None
    # PDF image CTM maps unit square -> page placement. Unit-square (0,0) is the
    # artwork's *bottom-left* (PDF y-up); board frame wants top-left origin,
    # y-down. unit (u, v) -> board (u * 60, (1 - v) * 44).
    t = best["transform"]
    ctm = Mat(t[0], t[1], t[2], t[3], t[4], t[5])
    inv = ctm.invert()  # page -> unit square
    unit_to_board = Mat(BOARD_W, 0, 0, -BOARD_H, 0, BOARD_H)
    return inv.compose(unit_to_board), best


def decompose_stamp(stamp_ctm, page_to_board: Mat) -> dict:
    """Stamp CTM (unit square -> page) composed into board space: the full
    affine (kept for the witness math) plus convenience facts — rotation of
    the artwork's u axis, mirror parity, artwork size, artwork center."""
    t = stamp_ctm
    m = Mat(t[0], t[1], t[2], t[3], t[4], t[5]).compose(page_to_board)
    ux, uy = m.a, m.b
    vx, vy = m.c, m.d
    w = math.hypot(ux, uy)
    h = math.hypot(vx, vy)
    det = ux * vy - uy * vx
    mirrored = det > 0  # PDF y-up flipped into the y-down board makes det<0 the norm
    rot = math.degrees(math.atan2(uy, -ux if mirrored else ux)) % 360
    center = m.apply(0.5, 0.5)
    return {
        "mat": m,
        "rotation_raw": rot,
        "mirrored": mirrored,
        "w_in": w,
        "h_in": h,
        "center": center,
    }


def snap_rotation(deg: float, tol: float = 2.0) -> int | None:
    for target in (0, 90, 180, 270):
        d = min((deg - target) % 360, (target - deg) % 360)
        if d <= tol:
            return target
    return None


#: The four candidate global orientations of the recovered board frame. The
#: PDF's y-up convention vs the dataset's y-down corner-origin frame leaves a
#: flip ambiguity that the mirror layouts (180°-symmetric!) can't reveal via
#: naive matching — so calibration tries all four and keeps the one that
#: matches best. Row-vector affines, applied after the base board map.
ORIENTATIONS: dict[str, Mat] = {
    "identity": Mat(1, 0, 0, 1, 0, 0),
    "flip-x": Mat(-1, 0, 0, 1, BOARD_W, 0),
    "flip-y": Mat(1, 0, 0, -1, 0, BOARD_H),
    "rot180": Mat(-1, 0, 0, -1, BOARD_W, BOARD_H),
}


def page_stamps(page, page_to_board: Mat, board_info: dict) -> list[dict]:
    """All non-board image stamps whose center lands on the board. Stamps
    larger than the board itself (page background art) are dropped."""
    out = []
    for info in page.get_image_info(xrefs=True):
        if info["xref"] == board_info["xref"] and info["bbox"] == board_info["bbox"]:
            continue
        d = decompose_stamp(info["transform"], page_to_board)
        if d["w_in"] > BOARD_W + 2 or d["h_in"] > BOARD_H + 2:
            continue
        x, y = d["center"]
        if -1 <= x <= BOARD_W + 1 and -1 <= y <= BOARD_H + 1:
            d["xref"] = info["xref"]
            d["px"] = (info["width"], info["height"])
            out.append(d)
    return out


def piece_local_dims(p: dict) -> tuple[float, float]:
    """The footprint's own (unrotated) bbox, sorted — rotation-invariant."""
    verts = footprint_vertices(p["footprint"])
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    return tuple(sorted((max(xs) - min(xs), max(ys) - min(ys))))


def match_stamps_to_pieces(
    stamps: list[dict], pieces: list[dict], gate: float
) -> list[tuple[dict, dict, float]]:
    """Greedy min-cost matching. Cost = centroid distance + a size term —
    pure distance cross-pairs the area/feature stacks that share a centroid
    (area-long-line + gantry, area-short-line + pipe...). Sizes compare the
    artwork's sorted dims to the footprint's local bbox so oblique pieces
    match the same as axis-aligned ones."""
    pairs = []
    for si, s in enumerate(stamps):
        sw, sh = sorted((s["w_in"], s["h_in"]))
        for pi, p in enumerate(pieces):
            d = math.dist(s["center"], p["centroid"])
            if d > gate:
                continue
            pw, ph = piece_local_dims(p)
            # Oblique pieces are drawn rotated INSIDE a straight canvas, so the
            # canvas runs up to the footprint diagonal: gate on containment
            # (canvas can't be smaller than the piece) and a diagonal-bounded
            # ceiling, with the size delta kept as a soft preference.
            diag = math.hypot(pw, ph)
            if sw < pw - 0.4 or sh < ph - 0.4 or sh > diag + 2.5:
                continue
            size_pen = abs(sw - pw) + abs(sh - ph)
            pairs.append((d + size_pen, d, si, pi))
    pairs.sort(key=lambda t: t[0])
    used_s, used_p = set(), set()
    matched = []
    for _cost, d, si, pi in pairs:
        if si in used_s or pi in used_p:
            continue
        used_s.add(si)
        used_p.add(pi)
        matched.append((stamps[si], pieces[pi], d))
    return matched


# ── Calibration against the mirror ground truth ─────────────────────────────

MIRROR_PAGES = {9: "take-and-hold-mirror-1", 10: "take-and-hold-mirror-2", 11: "take-and-hold-mirror-3"}


def load_dataset():
    layouts = {l["id"]: l for l in json.loads(LAYOUTS_PATH.read_text())}
    templates = json.loads(TEMPLATES_PATH.read_text())
    return layouts, templates


def _piece_board_map(src: dict, parent: dict | None, fp: dict) -> Mat:
    """The template-local -> board affine of a placed piece, built numerically
    from the images of (0,0), (1,0), (0,1) under the resolver's math."""
    verts = footprint_vertices(fp)
    cx, cy = polygon_centroid(verts)
    rot = src.get("rotation_degrees", 0)
    mir = src.get("mirror", "none")

    def img(x: float, y: float) -> tuple[float, float]:
        ox, oy = _orient(x - cx, y - cy, rot, mir)
        bx, by = ox + src["position"]["x"], oy + src["position"]["y"]
        if parent is not None:
            px, py = _orient(bx, by, parent.get("rotation_degrees", 0), parent.get("mirror", "none"))
            bx, by = px + parent["position"]["x"], py + parent["position"]["y"]
        return (bx, by)

    e, f = img(0, 0)
    ax, ay = img(1, 0)
    cx2, cy2 = img(0, 1)
    return Mat(ax - e, ay - f, cx2 - e, cy2 - f, e, f)


def resolved_pieces_with_meta(layout: dict, templates: list[dict]) -> list[dict]:
    """Resolved vertices joined back to the source piece, plus the full
    template-local -> board affine (`mat`) the witness calibration needs."""
    by_id = {p["id"]: p for p in (layout.get("pieces") or []) if p.get("id")}
    t_by_id = {t["id"]: t for t in templates}
    resolved = resolve_layout(layout, templates)
    out = []
    for res in resolved:
        src = by_id.get(res["id"])
        if src is None:
            continue  # composed template features — none in these layouts
        fp = src.get("footprint") or t_by_id[src["template"]]["footprint"]
        parent = by_id.get(src["parent_area_id"]) if src.get("parent_area_id") else None
        verts = [(v["x"], v["y"]) for v in res["vertices"]]
        out.append({
            "id": res["id"],
            "template": src.get("template"),
            "footprint": fp,
            "mat": _piece_board_map(src, parent, fp),
            "centroid": polygon_centroid(verts),
            "vertices": verts,
        })
    return out


def fit_placement(fp: dict, board_verts: list[tuple[float, float]]) -> tuple[dict, float]:
    """Recover (position, rotation, mirror) whose resolver placement best
    reproduces `board_verts` (direct vertex correspondence). Rotation is
    continuous — official layouts include oblique pieces (e.g. ~37.5°) — but
    snaps to the nearest right angle when within a degree. Returns the
    placement fields and the residual max-vertex error."""
    pos = polygon_centroid(board_verts)
    local = footprint_vertices(fp)
    lc = polygon_centroid(local)
    centered_local = [(x - lc[0], y - lc[1]) for x, y in local]
    centered_board = [(x - pos[0], y - pos[1]) for x, y in board_verts]

    best, best_err = None, math.inf
    for mir in ("none", "horizontal"):
        src = [(-x, y) if mir == "horizontal" else (x, y) for x, y in centered_local]
        # Least-squares rotation (Procrustes, y-down cw): board ≈ R(θ)·src.
        num = sum(sx * by - sy * bx for (sx, sy), (bx, by) in zip(src, centered_board))
        den = sum(sx * bx + sy * by for (sx, sy), (bx, by) in zip(src, centered_board))
        theta = math.degrees(math.atan2(num, den)) % 360
        for cand in ({round(theta / 90) * 90 % 360, round(theta * 2) / 2 % 360}):
            placed = _place(fp, {"x": pos[0], "y": pos[1]}, cand, mir)
            err = max(math.dist(a, b) for a, b in zip(placed, board_verts))
            if err < best_err:
                best, best_err = (cand, mir), err
    rot, mir = best
    rot = int(rot) if float(rot).is_integer() else rot
    fields: dict = {"position": {"x": round(pos[0], 2), "y": round(pos[1], 2)}}
    if rot:
        fields["rotation_degrees"] = rot
    if mir != "none":
        fields["mirror"] = mir
    return fields, best_err


#: Committed gw-11e ground-truth pages beyond the mirrors. Page 13 is the
#: asymmetric layout that disambiguates flip-x from flip-y — the mirror pages
#: are 180°-rotation-symmetric, so the two flips score identically on them.
EXTRA_TRUTH_PAGES = {13: "take-and-hold-vs-purge-the-foe-2"}


def _truth_pages(layouts: dict) -> dict[int, str]:
    pages = dict(MIRROR_PAGES)
    for page_no, lid in EXTRA_TRUTH_PAGES.items():
        if lid in layouts:
            pages[page_no] = lid
    return pages


def cmd_calibrate(args) -> int:
    doc = open_pdf(args.pdf)
    layouts, templates = load_dataset()
    truth_pages = _truth_pages(layouts)

    # Pick the global board orientation empirically: the one that matches the
    # most stamps to ground-truth pieces. The asymmetric extra page is what
    # actually decides between flip-x and flip-y.
    scores: dict[str, int] = {}
    for name, orient_mat in ORIENTATIONS.items():
        total = 0
        for page_no, layout_id in truth_pages.items():
            page = doc[page_no - 1]
            bt = board_transform(page)
            if bt is None:
                continue
            base, board_info = bt
            stamps = page_stamps(page, base.compose(orient_mat), board_info)
            pieces = resolved_pieces_with_meta(layouts[layout_id], templates)
            total += len(match_stamps_to_pieces(stamps, pieces, args.gate))
        scores[name] = total
    orientation = max(scores, key=lambda k: scores[k])
    print(f"orientation search: {scores} -> {orientation}")

    # Iterative witness harvest. GW reuses several artwork variants per
    # template (pages 10/11 introduce xrefs absent from page 9), and raw
    # geometric matching on a page weakens once art slop creeps in — so each
    # round first *extracts* with the witnesses found so far, then matches
    # only the still-unknown stamps against the still-unclaimed truth pieces.
    votes: dict[int, list[dict]] = defaultdict(list)
    known: set[int] = set()
    for round_no in range(1, 6):
        grew = False
        for page_no, layout_id in truth_pages.items():
            page = doc[page_no - 1]
            base, board_info = board_transform(page)
            page_to_board = base.compose(ORIENTATIONS[orientation])
            stamps = page_stamps(page, page_to_board, board_info)
            pieces = resolved_pieces_with_meta(layouts[layout_id], templates)

            # Truth pieces already explained by a known-xref stamp are claimed
            # (same size-aware matcher, so a pipe stamp can't eat an area row).
            unknown_stamps = [s for s in stamps if s["xref"] not in known]
            known_stamps = [s for s in stamps if s["xref"] in known]
            claimed_ids = {
                p["id"] for _s, p, _d in match_stamps_to_pieces(known_stamps, pieces, args.gate)
            }
            open_pieces = [p for p in pieces if p["id"] not in claimed_ids]

            for s, p, d in match_stamps_to_pieces(unknown_stamps, open_pieces, args.gate):
                # Witness: C maps template-local -> artwork-unit coords — a
                # constant of the artwork (up to footprint symmetry, which
                # doesn't change resolved geometry). `verify` is the arbiter.
                c_mat = p["mat"].compose(s["mat"].invert())
                votes[s["xref"]].append({
                    "template": p["template"],
                    "C": [c_mat.a, c_mat.b, c_mat.c, c_mat.d, c_mat.e, c_mat.f],
                    "match_dist": round(d, 3),
                    "page": page_no,
                    "piece": p["id"],
                })
                if s["xref"] not in known:
                    known.add(s["xref"])
                    grew = True
        if not grew:
            break
        print(f"round {round_no}: {len(known)} xrefs known")

    # Pick the lowest-cost witness per xref; report template consensus.
    SCRAPE_DIR.mkdir(parents=True, exist_ok=True)
    calibration: dict = {"orientation": orientation, "xrefs": {}}
    for xref, vs in sorted(votes.items()):
        templates_seen = sorted({v["template"] for v in vs})
        witness = min(vs, key=lambda v: v["match_dist"])
        flag = "" if len(templates_seen) == 1 else f"  ← matched as {templates_seen} (chiral twins ok)"
        print(f"  xref {xref}: {witness['template']} witness p{witness['page']}/{witness['piece']}"
              f" d={witness['match_dist']} votes={len(vs)}{flag}")
        calibration["xrefs"][str(xref)] = {
            "template": witness["template"],
            "C": [round(v, 6) for v in witness["C"]],
            "votes": len(vs),
        }
    out_path = SCRAPE_DIR / "calibration.json"
    out_path.write_text(json.dumps(calibration, indent=2) + "\n")
    print(f"calibrate: {len(calibration['xrefs'])} xrefs calibrated -> {out_path}")
    (SCRAPE_DIR / "calibration-votes.json").write_text(
        json.dumps({str(k): v for k, v in votes.items()}, indent=2) + "\n"
    )
    return 0


# ── Extraction + verification ───────────────────────────────────────────────

def extract_page(doc, page_no: int, calibration: dict, templates: list[dict]) -> tuple[list[dict], list[dict]]:
    """Candidate pieces for a page + a list of unknown/unfittable stamps."""
    page = doc[page_no - 1]
    base, board_info = board_transform(page)
    page_to_board = base.compose(ORIENTATIONS[calibration["orientation"]])
    stamps = page_stamps(page, page_to_board, board_info)
    t_by_id = {t["id"]: t for t in templates}
    pieces, unknown = [], []
    counter: dict[str, int] = defaultdict(int)
    for s in stamps:
        cal = calibration["xrefs"].get(str(s["xref"]))
        if cal is None:
            unknown.append({"xref": s["xref"], "px": s["px"],
                            "w_in": round(s["w_in"], 2), "h_in": round(s["h_in"], 2),
                            "rot_raw": round(s["rotation_raw"], 1),
                            "center": [round(c, 2) for c in s["center"]]})
            continue
        # template-local -> board for THIS instance: witness C, then the
        # instance's artwork placement.
        c_mat = Mat(*cal["C"])
        piece_mat = c_mat.compose(s["mat"])
        fp = t_by_id[cal["template"]]["footprint"]
        board_verts = [piece_mat.apply(x, y) for x, y in footprint_vertices(fp)]
        fields, err = fit_placement(fp, board_verts)
        if err > 0.35:
            unknown.append({"xref": s["xref"], "fit_residual": round(err, 3),
                            "template": cal["template"],
                            "center": [round(c, 2) for c in s["center"]]})
            continue
        counter[cal["template"]] += 1
        pieces.append({
            "id": f"{cal['template']}-{counter[cal['template']]}",
            "template": cal["template"],
            **fields,
        })
    return pieces, unknown


def match_and_report(
    candidate: list[dict], truth: list[dict], templates: list[dict], verbose: bool = True
) -> dict:
    """Pair resolved candidate pieces to resolved truth pieces (same vertex
    count, nearest centroid) and report per-tier worst vertex deltas. The
    area/feature tiers verify against different realities: GW prints feature
    artwork precisely but places the decorative area splats with up to ~1.3in
    of slop relative to the card's true (dimension-line) coordinates."""
    kind_of = {t["id"]: t["kind"] for t in templates}
    cand = resolve_layout({"id": "cand", "name": "cand", "pieces": candidate}, templates)
    by_key = {c["id"]: next(p for p in candidate if p["id"] == c["id"]) for c in cand}
    used = set()
    worst = {"area": 0.0, "feature": 0.0}
    rows = []
    unmatched = 0
    for c in cand:
        cv = [(v["x"], v["y"]) for v in c["vertices"]]
        cc = polygon_centroid(cv)
        best_j, best_d = None, 1e9
        for j, t in enumerate(truth):
            if j in used or len(t["vertices"]) != len(cv):
                continue
            d = math.dist(cc, t["centroid"])
            if d < best_d:
                best_j, best_d = j, d
        if best_j is None or best_d > 2.0:
            unmatched += 1
            rows.append((math.inf, c["id"], "<unmatched>", "?"))
            continue
        used.add(best_j)
        delta = _poly_delta(cv, truth[best_j]["vertices"])
        kind = kind_of.get(by_key[c["id"]].get("template"), "feature")
        worst[kind] = max(worst[kind], delta)
        rows.append((delta, c["id"], truth[best_j]["id"], kind))
    if verbose:
        for delta, cid, tid, kind in sorted(rows, reverse=True):
            d = "∞" if delta == math.inf else f"{delta:.3f}"
            print(f"    Δ={d:<6} [{kind:<7}] {cid:<34} -> {tid}")
    return {
        "worst_area": worst["area"],
        "worst_feature": worst["feature"],
        "unmatched_cand": unmatched,
        "unmatched_truth": len(truth) - len(used),
    }


def _poly_delta(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> float:
    """Min over cyclic alignments and both windings of max per-vertex distance."""
    n = len(a)
    best = 1e9
    for direction in (1, -1):
        seq = a if direction == 1 else list(reversed(a))
        for shift in range(n):
            worst = 0.0
            for i in range(n):
                worst = max(worst, math.dist(seq[(i + shift) % n], b[i]))
                if worst >= best:
                    break
            best = min(best, worst)
    return best


def cmd_verify(args) -> int:
    doc = open_pdf(args.pdf)
    layouts, templates = load_dataset()
    cal_path = SCRAPE_DIR / "calibration.json"
    if not cal_path.exists():
        sys.exit("run `calibrate` first")
    calibration = json.loads(cal_path.read_text())

    all_ok = True
    for page_no, layout_id in _truth_pages(layouts).items():
        print(f"p{page_no} vs {layout_id}:")
        candidate, unknown = extract_page(doc, page_no, calibration, templates)
        truth = resolved_pieces_with_meta(layouts[layout_id], templates)
        r = match_and_report(candidate, truth, templates, verbose=args.verbose)
        ok = (
            r["worst_feature"] <= args.tolerance
            and r["worst_area"] <= args.area_tolerance
            and r["unmatched_cand"] == 0
            and r["unmatched_truth"] == 0
            and not unknown
        )
        all_ok &= ok
        print(f"  candidate pieces={len(candidate)} truth pieces={len(truth)} unknown stamps={len(unknown)}")
        print(f"  worst Δ: features={r['worst_feature']:.3f}in (≤{args.tolerance})"
              f" areas={r['worst_area']:.3f}in (≤{args.area_tolerance})"
              f"  unmatched cand={r['unmatched_cand']} truth={r['unmatched_truth']}"
              f"  -> {'PASS' if ok else 'FAIL'}")
        if unknown:
            for u in unknown[:10]:
                print(f"    unknown stamp: {u}")
        SCRAPE_DIR.mkdir(parents=True, exist_ok=True)
        (SCRAPE_DIR / f"candidate-p{page_no}.json").write_text(json.dumps(candidate, indent=2) + "\n")
    print(f"verify: {'PASS' if all_ok else 'FAIL'}"
          f" (feature tolerance {args.tolerance}in, area tolerance {args.area_tolerance}in)")
    return 0 if all_ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("selfcheck")
    sub.add_parser("census")
    cal = sub.add_parser("calibrate")
    cal.add_argument("--gate", type=float, default=1.5, help="stamp-piece match gate, inches")
    cal.add_argument("--offset-spread", type=float, default=0.1)
    ver = sub.add_parser("verify")
    ver.add_argument("--tolerance", type=float, default=0.25)
    # GW's decorative area splats carry up to ~1.3in of print slop relative to
    # the card's dimension-line coordinates (measured on the mirror pages).
    ver.add_argument("--area-tolerance", type=float, default=1.5)
    ver.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    return {"selfcheck": cmd_selfcheck, "census": cmd_census,
            "calibrate": cmd_calibrate, "verify": cmd_verify}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
