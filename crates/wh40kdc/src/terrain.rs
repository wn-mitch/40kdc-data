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

/// A board edge a card dimension is measured from. left/right pin x;
/// top/bottom pin y.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BoardEdge {
    Left,
    Right,
    Top,
    Bottom,
}

/// Which feature of the placed piece a keystone measurement reaches: a
/// footprint vertex (by resolver vertex order) or an axis-aligned bounding
/// face of the placed footprint.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FeatureRef {
    Vertex { index: usize },
    Face { side: FaceSide },
}

/// An axis-aligned bounding face of a placed footprint.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FaceSide {
    MinX,
    MaxX,
    MinY,
    MaxY,
}

/// One authored measurement keystone (board edge → piece feature). Only the
/// selection is stored; the distance is derived by [`keystone_measurements`].
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Keystone {
    pub edge: BoardEdge,
    pub r#ref: FeatureRef,
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
    #[serde(default)]
    pub keystones: Option<Vec<Keystone>>,
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
            Vec2 {
                x: *width,
                y: *height,
            },
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
        return Vec2 {
            x: mx / n as f64,
            y: my / n as f64,
        };
    }
    Vec2 {
        x: cx / (3.0 * twice_area),
        y: cy / (3.0 * twice_area),
    }
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
    Vec2 {
        x: c * v.x - s * v.y,
        y: s * v.x + c * v.y,
    }
}

/// mirror → rotate (no translation).
fn orient(v: Vec2, rotation: f64, mirror: Mirror) -> Vec2 {
    rotate_cw(apply_mirror(v, mirror), rotation)
}

/// Round a coordinate to 4 dp using JS `Math.round` semantics (`floor(x+0.5)`),
/// so the two implementations round half-values identically.
fn round4(v: Vec2) -> Vec2 {
    let r = |x: f64| (x * 10000.0 + 0.5).floor() / 10000.0;
    Vec2 {
        x: r(v.x),
        y: r(v.y),
    }
}

/// Recenter a footprint on its centroid, mirror, rotate, translate to `position`.
fn place_footprint(fp: &Footprint, position: Vec2, rotation: f64, mirror: Mirror) -> Vec<Vec2> {
    let verts = footprint_vertices(fp);
    let c = polygon_centroid(&verts);
    verts
        .iter()
        .map(|v| {
            let o = orient(
                Vec2 {
                    x: v.x - c.x,
                    y: v.y - c.y,
                },
                rotation,
                mirror,
            );
            Vec2 {
                x: o.x + position.x,
                y: o.y + position.y,
            }
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

    let footprint_of = |piece_fp: &Option<Footprint>,
                        piece_template: &Option<String>,
                        where_: &str|
     -> Result<Footprint, TerrainResolveError> {
        if let Some(fp) = piece_fp {
            return Ok(fp.clone());
        }
        if let Some(tid) = piece_template {
            return by_id
                .get(tid.as_str())
                .map(|t| t.footprint.clone())
                .ok_or_else(|| {
                    TerrainResolveError(format!("{where_}: unknown template \"{tid}\""))
                });
        }
        Err(TerrainResolveError(format!(
            "{where_}: piece has neither footprint nor template"
        )))
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
        let piece_type = piece.piece_type.clone().unwrap_or_else(|| {
            if piece.parent_area_id.is_some() {
                "feature".into()
            } else {
                "area".into()
            }
        });

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
                    round4(Vec2 {
                        x: o.x + parent.position.x,
                        y: o.y + parent.position.y,
                    })
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
                            round4(Vec2 {
                                x: o.x + piece.position.x,
                                y: o.y + piece.position.y,
                            })
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

// ── measurement keystones ────────────────────────────────────────────────────
//
// The Rust mirror of `tools/src/terrain/keystones.ts`, pinned by the
// `conformance/terrain-keystones` corpus. A keystone stores only the author's
// selection (board edge → piece feature); the printed distance is always
// derived from the resolved geometry, so it can never disagree with the
// layout. Distances are raw inches rounded to 4 dp; display formatting is
// deliberately presentation, not part of this contract.

/// The 40kdc standard board extents, in inches (x spans width, y height).
pub const BOARD_INCHES: BoardExtents = BoardExtents {
    width: 60.0,
    height: 44.0,
};

/// Board extents for keystone derivation.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub struct BoardExtents {
    pub width: f64,
    pub height: f64,
}

/// One derived dimension line, ready to print on a card. Field order matches
/// the TS helper's emitted JSON (piece_index, piece_id, edge, ref, distance)
/// so cross-impl byte comparison of the runner op holds.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct KeystoneMeasurement {
    pub piece_index: usize,
    pub piece_id: Option<String>,
    pub edge: BoardEdge,
    pub r#ref: FeatureRef,
    pub distance: f64,
}

/// Error raised for a keystone whose ref can't be measured (vertex index out
/// of range, or a face whose axis disagrees with the edge).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainKeystoneError(pub String);

impl std::fmt::Display for TerrainKeystoneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for TerrainKeystoneError {}

/// Keystone failures: the layout didn't resolve, or a keystone ref is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeystoneError {
    Resolve(TerrainResolveError),
    Keystone(TerrainKeystoneError),
}

impl std::fmt::Display for KeystoneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeystoneError::Resolve(e) => write!(f, "{e}"),
            KeystoneError::Keystone(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for KeystoneError {}

fn axis_is_x(edge: BoardEdge) -> bool {
    matches!(edge, BoardEdge::Left | BoardEdge::Right)
}

/// The measured board-space coordinate a keystone's ref resolves to.
fn ref_coordinate(
    rp: &ResolvedPiece,
    k: &Keystone,
    where_: &str,
) -> Result<f64, TerrainKeystoneError> {
    let on_x = axis_is_x(k.edge);
    let coord = |v: &Vec2| if on_x { v.x } else { v.y };
    match k.r#ref {
        FeatureRef::Vertex { index } => rp.vertices.get(index).map(coord).ok_or_else(|| {
            TerrainKeystoneError(format!(
                "{where_}: keystone vertex index {index} out of range ({} vertices)",
                rp.vertices.len()
            ))
        }),
        FeatureRef::Face { side } => {
            let side_is_x = matches!(side, FaceSide::MinX | FaceSide::MaxX);
            if side_is_x != on_x {
                return Err(TerrainKeystoneError(format!(
                    "{where_}: face axis disagrees with the measured edge"
                )));
            }
            let vals = rp.vertices.iter().map(coord);
            Ok(match side {
                FaceSide::MinX | FaceSide::MinY => vals.fold(f64::INFINITY, f64::min),
                FaceSide::MaxX | FaceSide::MaxY => vals.fold(f64::NEG_INFINITY, f64::max),
            })
        }
    }
}

/// Derive every keystone's printed distance for a layout. Pieces resolve via
/// [`resolve_layout`] (the pinned transform contract); near edges
/// (`left`/`top`) read the coordinate directly, far edges (`right`/`bottom`)
/// read the remaining extent.
pub fn keystone_measurements(
    layout: &TerrainLayout,
    templates: &[TerrainTemplate],
    board: BoardExtents,
) -> Result<Vec<KeystoneMeasurement>, KeystoneError> {
    let resolved = resolve_layout(layout, templates).map_err(KeystoneError::Resolve)?;
    let features_of: HashMap<&str, usize> = templates
        .iter()
        .map(|t| (t.id.as_str(), t.features.as_ref().map_or(0, Vec::len)))
        .collect();

    let mut out = Vec::new();
    // Walk the emission contract: one entry per explicit piece, in order, with
    // an unparented templated piece followed by its template's composed
    // features.
    let mut cursor = 0usize;
    for (i, piece) in layout.pieces.iter().enumerate() {
        let rp = resolved.get(cursor).ok_or_else(|| {
            KeystoneError::Keystone(TerrainKeystoneError(format!(
                "piece {i}: resolved emission shorter than layout.pieces"
            )))
        })?;
        cursor += 1;
        if piece.parent_area_id.is_none() {
            if let Some(tid) = &piece.template {
                cursor += features_of.get(tid.as_str()).copied().unwrap_or(0);
            }
        }

        for k in piece.keystones.iter().flatten() {
            let where_ = match &rp.id {
                Some(id) => format!("piece {id}"),
                None => format!("piece {i}"),
            };
            let c = ref_coordinate(rp, k, &where_).map_err(KeystoneError::Keystone)?;
            let extent = if axis_is_x(k.edge) {
                board.width
            } else {
                board.height
            };
            let distance = match k.edge {
                BoardEdge::Left | BoardEdge::Top => c,
                BoardEdge::Right | BoardEdge::Bottom => extent - c,
            };
            out.push(KeystoneMeasurement {
                piece_index: i,
                piece_id: piece.id.clone(),
                edge: k.edge,
                r#ref: k.r#ref,
                distance: (distance * 10000.0 + 0.5).floor() / 10000.0,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod keystone_tests {
    use super::*;

    fn templates() -> Vec<TerrainTemplate> {
        vec![TerrainTemplate {
            id: "area-medium".into(),
            name: Some("Medium Area".into()),
            kind: Some("area".into()),
            footprint: Footprint::Rectangle {
                width: 6.0,
                height: 4.0,
            },
            features: None,
        }]
    }

    fn layout_with(keystones: Vec<Keystone>) -> TerrainLayout {
        TerrainLayout {
            id: Some("c".into()),
            name: Some("c".into()),
            pieces: vec![LayoutPiece {
                id: Some("p".into()),
                name: None,
                piece_type: None,
                template: Some("area-medium".into()),
                footprint: None,
                position: Vec2 { x: 30.0, y: 22.0 },
                rotation_degrees: None,
                mirror: Mirror::None,
                parent_area_id: None,
                floor: None,
                keystones: Some(keystones),
            }],
        }
    }

    #[test]
    fn rejects_vertex_index_out_of_range() {
        let layout = layout_with(vec![Keystone {
            edge: BoardEdge::Left,
            r#ref: FeatureRef::Vertex { index: 4 },
        }]);
        let err = keystone_measurements(&layout, &templates(), BOARD_INCHES).unwrap_err();
        assert!(err.to_string().contains("index 4 out of range"), "{err}");
    }

    #[test]
    fn rejects_face_axis_mismatch() {
        let layout = layout_with(vec![Keystone {
            edge: BoardEdge::Left,
            r#ref: FeatureRef::Face {
                side: FaceSide::MinY,
            },
        }]);
        let err = keystone_measurements(&layout, &templates(), BOARD_INCHES).unwrap_err();
        assert!(err.to_string().contains("axis"), "{err}");
    }

    #[test]
    fn propagates_resolver_errors() {
        let mut layout = layout_with(vec![]);
        layout.pieces[0].template = Some("nope".into());
        let err = keystone_measurements(&layout, &templates(), BOARD_INCHES).unwrap_err();
        assert!(err.to_string().contains("unknown template"), "{err}");
    }

    #[test]
    fn empty_when_no_keystones() {
        let layout = layout_with(vec![]);
        let out = keystone_measurements(&layout, &templates(), BOARD_INCHES).unwrap();
        assert!(out.is_empty());
    }
}
