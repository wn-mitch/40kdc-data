//! Terrain layout resolver — the Rust mirror of `tools/src/terrain/resolve.ts`.
//!
//! Turns a [`TerrainLayout`] (template references + centroid-anchored placements
//! + rotation/mirror) into absolute board-space polygon vertices. The transform
//! contract is pinned by the `conformance/terrain-resolver` corpus; this module
//! and the TS resolver must produce the same vertices (4-dp rounded, ±5e-4).
//!
//! ## Transform contract
//!
//! Board inches, origin at a board corner, **y-down**. A footprint is authored
//! in natural local y-down coordinates; the resolver derives its polygon area
//! centroid and treats local vertices as `(v - centroid)`, so `position` always
//! denotes the centroid (invariant under rotation and mirror).
//!
//! Local → board, unparented: `mirror → rotate → translate`:
//!   `board = position + R_cw(rotation) · M(mirror) · (v - centroid)`
//! with `M` horizontal → `(-x, y)`, vertical → `(x, -y)`; `R_cw(θ)` clockwise in
//! the y-down frame, `[[cosθ, -sinθ], [sinθ, cosθ]]`.
//!
//! A feature with `parent_area_id` (or an area template's composed feature) is
//! placed in the parent area's centroid-local frame, then carried through the
//! area's own placement. Emission order: `layout.pieces` order; an area
//! template's composed features are emitted immediately after their area, in
//! declaration order.
//!
//! These structs are deliberately decoupled from the typify-generated types
//! (whose `anyOf` piece renders as `PieceVariant0/1`): they deserialize plain
//! JSON, matching the TS resolver's own interfaces, and keep the cross-language
//! contract legible.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A 2D point in inches (y-down).
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

/// A terrain footprint in natural local coordinates.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Footprint {
    Rectangle { width: f64, height: f64 },
    RightTriangle { width: f64, height: f64 },
    Polygon { points: Vec<Vec2> },
}

/// Reflection applied in the local frame before rotation.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mirror {
    #[default]
    None,
    Horizontal,
    Vertical,
}

/// A scenery feature composed onto an area template, in the area-local frame.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ComposedFeature {
    #[serde(default)]
    pub id: Option<String>,
    pub template: String,
    pub position: Vec2,
    #[serde(default)]
    pub rotation_degrees: Option<f64>,
    #[serde(default)]
    pub mirror: Mirror,
    #[serde(default)]
    pub floor: u64,
}

/// A catalog terrain template (area or feature).
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct TerrainTemplate {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    pub footprint: Footprint,
    #[serde(default)]
    pub features: Option<Vec<ComposedFeature>>,
}

/// One placement in a layout.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct LayoutPiece {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub piece_type: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub footprint: Option<Footprint>,
    pub position: Vec2,
    #[serde(default)]
    pub rotation_degrees: Option<f64>,
    #[serde(default)]
    pub mirror: Mirror,
    #[serde(default)]
    pub parent_area_id: Option<String>,
    #[serde(default)]
    pub floor: Option<u64>,
}

/// A terrain layout.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct TerrainLayout {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub pieces: Vec<LayoutPiece>,
}

/// A resolved piece: absolute board-space vertices plus identity fields. Field
/// order matches the TS resolver's emitted JSON (id, name, piece_type, floor,
/// vertices) so cross-impl byte comparison of the runner op holds.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct ResolvedPiece {
    pub id: Option<String>,
    pub name: Option<String>,
    pub piece_type: String,
    pub floor: u64,
    pub vertices: Vec<Vec2>,
}

/// Error raised when a layout references a missing template or has a piece with
/// neither footprint nor template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainResolveError(pub String);

impl std::fmt::Display for TerrainResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for TerrainResolveError {}

/// A footprint's polygon vertices in natural local (y-down) coordinates.
pub fn footprint_vertices(fp: &Footprint) -> Vec<Vec2> {
    match fp {
        Footprint::Rectangle { width, height } => vec![
            Vec2 { x: 0.0, y: 0.0 },
            Vec2 { x: *width, y: 0.0 },
            Vec2 { x: *width, y: *height },
            Vec2 { x: 0.0, y: *height },
        ],
        Footprint::RightTriangle { width, height } => vec![
            Vec2 { x: 0.0, y: 0.0 },
            Vec2 { x: *width, y: 0.0 },
            Vec2 { x: 0.0, y: *height },
        ],
        Footprint::Polygon { points } => points.clone(),
    }
}

/// Polygon area centroid (shoelace), with a vertex-mean fallback for degenerate
/// (zero-area) polygons. Matches the TS resolver.
pub fn polygon_centroid(verts: &[Vec2]) -> Vec2 {
    let n = verts.len();
    if n == 0 {
        return Vec2 { x: 0.0, y: 0.0 };
    }
    let mut twice_area = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for i in 0..n {
        let a = verts[i];
        let b = verts[(i + 1) % n];
        let cross = a.x * b.y - b.x * a.y;
        twice_area += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
    }
    if twice_area == 0.0 {
        let (mut mx, mut my) = (0.0, 0.0);
        for v in verts {
            mx += v.x;
            my += v.y;
        }
        return Vec2 { x: mx / n as f64, y: my / n as f64 };
    }
    Vec2 { x: cx / (3.0 * twice_area), y: cy / (3.0 * twice_area) }
}

fn apply_mirror(v: Vec2, m: Mirror) -> Vec2 {
    match m {
        Mirror::Horizontal => Vec2 { x: -v.x, y: v.y },
        Mirror::Vertical => Vec2 { x: v.x, y: -v.y },
        Mirror::None => v,
    }
}

/// Clockwise rotation by `deg` degrees in the y-down frame.
fn rotate_cw(v: Vec2, deg: f64) -> Vec2 {
    if deg == 0.0 {
        return v;
    }
    let r = deg * std::f64::consts::PI / 180.0;
    let c = r.cos();
    let s = r.sin();
    Vec2 { x: c * v.x - s * v.y, y: s * v.x + c * v.y }
}

/// mirror → rotate (no translation).
fn orient(v: Vec2, rotation: f64, mirror: Mirror) -> Vec2 {
    rotate_cw(apply_mirror(v, mirror), rotation)
}

/// Round a coordinate to 4 dp using JS `Math.round` semantics (`floor(x+0.5)`),
/// so the two implementations round half-values identically.
fn round4(v: Vec2) -> Vec2 {
    let r = |x: f64| (x * 10000.0 + 0.5).floor() / 10000.0;
    Vec2 { x: r(v.x), y: r(v.y) }
}

/// Recenter a footprint on its centroid, mirror, rotate, translate to `position`.
fn place_footprint(fp: &Footprint, position: Vec2, rotation: f64, mirror: Mirror) -> Vec<Vec2> {
    let verts = footprint_vertices(fp);
    let c = polygon_centroid(&verts);
    verts
        .iter()
        .map(|v| {
            let o = orient(Vec2 { x: v.x - c.x, y: v.y - c.y }, rotation, mirror);
            Vec2 { x: o.x + position.x, y: o.y + position.y }
        })
        .collect()
}

/// Resolve a layout to absolute board-space vertices per piece.
pub fn resolve_layout(
    layout: &TerrainLayout,
    templates: &[TerrainTemplate],
) -> Result<Vec<ResolvedPiece>, TerrainResolveError> {
    let by_id: HashMap<&str, &TerrainTemplate> =
        templates.iter().map(|t| (t.id.as_str(), t)).collect();
    let areas_by_id: HashMap<&str, &LayoutPiece> = layout
        .pieces
        .iter()
        .filter_map(|p| p.id.as_deref().map(|id| (id, p)))
        .collect();

    let footprint_of = |piece_fp: &Option<Footprint>, piece_template: &Option<String>, where_: &str| -> Result<Footprint, TerrainResolveError> {
        if let Some(fp) = piece_fp {
            return Ok(fp.clone());
        }
        if let Some(tid) = piece_template {
            return by_id
                .get(tid.as_str())
                .map(|t| t.footprint.clone())
                .ok_or_else(|| TerrainResolveError(format!("{where_}: unknown template \"{tid}\"")));
        }
        Err(TerrainResolveError(format!("{where_}: piece has neither footprint nor template")))
    };

    let mut out: Vec<ResolvedPiece> = Vec::new();

    for piece in &layout.pieces {
        let where_ = piece
            .id
            .as_deref()
            .or(piece.name.as_deref())
            .unwrap_or("<piece>")
            .to_string();
        let fp = footprint_of(&piece.footprint, &piece.template, &where_)?;
        let rotation = piece.rotation_degrees.unwrap_or(0.0);
        let mirror = piece.mirror;
        let piece_type = piece
            .piece_type
            .clone()
            .unwrap_or_else(|| if piece.parent_area_id.is_some() { "feature".into() } else { "area".into() });

        if let Some(parent_id) = &piece.parent_area_id {
            let parent = areas_by_id.get(parent_id.as_str()).ok_or_else(|| {
                TerrainResolveError(format!("{where_}: unknown parent_area_id \"{parent_id}\""))
            })?;
            let area_local = place_footprint(&fp, piece.position, rotation, mirror);
            let a_rot = parent.rotation_degrees.unwrap_or(0.0);
            let a_mirror = parent.mirror;
            let vertices = area_local
                .iter()
                .map(|p| {
                    let o = orient(*p, a_rot, a_mirror);
                    round4(Vec2 { x: o.x + parent.position.x, y: o.y + parent.position.y })
                })
                .collect();
            out.push(ResolvedPiece {
                id: piece.id.clone(),
                name: piece.name.clone(),
                piece_type,
                floor: piece.floor.unwrap_or(0),
                vertices,
            });
            continue;
        }

        let vertices: Vec<Vec2> = place_footprint(&fp, piece.position, rotation, mirror)
            .into_iter()
            .map(round4)
            .collect();
        out.push(ResolvedPiece {
            id: piece.id.clone(),
            name: piece.name.clone(),
            piece_type,
            floor: piece.floor.unwrap_or(0),
            vertices,
        });

        // Expand an area template's composed features, carried through this
        // area's placement.
        if let Some(tid) = &piece.template {
            if let Some(t) = by_id.get(tid.as_str()) {
                for feat in t.features.iter().flatten() {
                    let ft = by_id.get(feat.template.as_str()).ok_or_else(|| {
                        TerrainResolveError(format!(
                            "{where_}: composed feature references unknown template \"{}\"",
                            feat.template
                        ))
                    })?;
                    let area_local = place_footprint(
                        &ft.footprint,
                        feat.position,
                        feat.rotation_degrees.unwrap_or(0.0),
                        feat.mirror,
                    );
                    let feat_verts = area_local
                        .iter()
                        .map(|p| {
                            let o = orient(*p, rotation, mirror);
                            round4(Vec2 { x: o.x + piece.position.x, y: o.y + piece.position.y })
                        })
                        .collect();
                    out.push(ResolvedPiece {
                        id: feat.id.clone(),
                        name: ft.name.clone(),
                        piece_type: "feature".into(),
                        floor: feat.floor,
                        vertices: feat_verts,
                    });
                }
            }
        }
    }

    Ok(out)
}
