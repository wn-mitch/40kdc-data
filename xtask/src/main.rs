//! Repo automation. Two tasks:
//! - `codegen` regenerates `crates/wh40kdc/src/generated.rs` from the bundled
//!   JSON Schema (the schema itself is produced upstream by
//!   `cd tools && npm run bundle:schemas`).
//! - `bundle-data` regenerates `crates/wh40kdc/src/data/bundle.generated.json`
//!   from the repository's `data/` tree (the Rust analogue of the TS
//!   `npm run codegen:data`). Committed and CI-drift-checked.
//!
//! Run with `cargo run -p xtask -- <task>`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use schemars::schema::RootSchema;
use serde_json::Value;
use typify::{TypeSpace, TypeSpaceSettings};

mod dispatch;

fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("codegen") => codegen(),
        Some("bundle-data") => bundle_data(),
        other => bail!(
            "unknown task {:?}; expected `codegen` or `bundle-data`",
            other.unwrap_or("<none>")
        ),
    }
}

/// Workspace root = parent of the xtask crate dir.
fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask has a parent dir")
        .to_path_buf()
}

/// Make each `effect-node` variant's `type` constant a checked value. typify turns
/// `oneOf` into an untagged enum and a bare `{"const": X}` into an unchecked
/// `serde_json::Value`, so the first variant whose other fields fit would win (an
/// `ability-part` with a `name` read as a `named-effect`). A one-value string enum
/// means the same and generates a type that only accepts X, so every variant is
/// told apart by its `type`. Only codegen's input changes; the schema does not.
fn tag_effect_variants(schema: &mut serde_json::Value) {
    let refs: Vec<String> = schema
        .pointer("/$defs/effect-node/oneOf")
        .and_then(|members| members.as_array())
        .map(|members| {
            members
                .iter()
                .filter_map(|member| member.get("$ref")?.as_str())
                .filter_map(|reference| reference.strip_prefix("#/$defs/"))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    for name in refs {
        let Some(type_schema) = schema.pointer_mut(&format!("/$defs/{name}/properties/type"))
        else {
            continue;
        };
        let Some(constant) = type_schema
            .get("const")
            .and_then(|c| c.as_str())
            .map(str::to_string)
        else {
            continue;
        };
        *type_schema = serde_json::json!({ "type": "string", "enum": [constant] });
    }
}

/// Give each member of a `type`-keyed `oneOf` its own named definition for one
/// inline object property. typify turns such a `oneOf` into a `type`-tagged enum
/// but names every member's inline `<property>` object after the enum (for example
/// `SimpleConditionParameters`, `SingleEffectModifier`) and keeps only the first, so
/// every member but the first would fail to deserialize. Moving each object to
/// `$defs/<type>-<suffix>` (and referencing it) gives every member its own type.
/// Only codegen's input changes; the schema does not.
fn hoist_member_objects(schema: &mut serde_json::Value, def: &str, property: &str, suffix: &str) {
    let mut hoisted: Vec<(String, serde_json::Value)> = Vec::new();
    if let Some(members) = schema
        .pointer_mut(&format!("/$defs/{def}/oneOf"))
        .and_then(|members| members.as_array_mut())
    {
        for member in members {
            let Some(constant) = member
                .pointer("/properties/type/const")
                .and_then(|c| c.as_str())
                .map(str::to_string)
            else {
                continue;
            };
            let Some(object) = member.pointer_mut(&format!("/properties/{property}")) else {
                continue;
            };
            if object.get("$ref").is_some() {
                continue;
            }
            // An `anyOf` of bare `required` lists means "at least one of these
            // keys". typify turns it into one variant per list that admits only
            // that key, rejecting valid data that sets several (`lost` and
            // `remaining_max`). Dropping it keeps every key optional; the
            // validator still enforces the constraint from the real schema.
            if let Some(obj) = object.as_object_mut() {
                let presence_only =
                    obj.get("anyOf")
                        .and_then(|any| any.as_array())
                        .is_some_and(|any| {
                            any.iter().all(|m| {
                                m.as_object()
                                    .is_some_and(|m| m.keys().all(|k| k == "required"))
                            })
                        });
                if presence_only {
                    obj.remove("anyOf");
                }
            }
            let name = format!("{constant}-{suffix}");
            let body = std::mem::replace(
                object,
                serde_json::json!({ "$ref": format!("#/$defs/{name}") }),
            );
            hoisted.push((name, body));
        }
    }
    if let Some(defs) = schema.get_mut("$defs").and_then(|d| d.as_object_mut()) {
        for (name, body) in hoisted {
            defs.insert(name, body);
        }
    }
}

/// True when `node` only constrains which keys are present: a `required` list, a `not`
/// of such a constraint, or an `allOf`/`oneOf`/`anyOf` of them.
fn presence_only(node: &serde_json::Value) -> bool {
    let Some(obj) = node.as_object() else {
        return false;
    };
    !obj.is_empty()
        && obj.iter().all(|(key, value)| match key.as_str() {
            "required" => value.is_array(),
            "not" => presence_only(value),
            "allOf" | "oneOf" | "anyOf" => value
                .as_array()
                .is_some_and(|members| members.iter().all(presence_only)),
            _ => false,
        })
}

/// Drop presence-only `not`, `allOf` and `anyOf` constraints from every object schema that
/// declares `properties`. typify cannot express them: it emits an empty enum for an
/// `allOf` of key-exclusivity `oneOf`s (`dice-gated`: exactly one of `dice`/`from`) and
/// silently drops properties from a struct with a sibling `not` (resource-spend's `face`
/// and `requirement`), and splits an `anyOf` of `required` lists into one strict variant per
/// list, rejecting records that set several (a unit ability ref with `value` and `wargear`).
/// Dropping them keeps every key optional; the validator still
/// enforces the constraint from the real schema. `oneOf` siblings are left to typify,
/// which generates working types for them. Only codegen's input changes; the schema does not.
fn strip_presence_constraints(node: &mut serde_json::Value) {
    match node {
        serde_json::Value::Object(obj) => {
            if obj.contains_key("properties") {
                for key in ["not", "allOf", "anyOf"] {
                    if obj.get(key).is_some_and(|v| {
                        v.as_array()
                            .map_or_else(|| presence_only(v), |m| m.iter().all(presence_only))
                    }) {
                        obj.remove(key);
                    }
                }
            }
            for value in obj.values_mut() {
                strip_presence_constraints(value);
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(strip_presence_constraints),
        _ => {}
    }
}

fn codegen() -> Result<()> {
    let root = workspace_root();
    let schema_path = root.join("crates/wh40kdc/schemas/bundled.schema.json");
    let out_path = root.join("crates/wh40kdc/src/generated.rs");

    let content = std::fs::read_to_string(&schema_path)
        .with_context(|| format!("reading {}", schema_path.display()))?;
    let mut raw: serde_json::Value = serde_json::from_str(&content)
        .with_context(|| format!("parsing {} as JSON", schema_path.display()))?;
    let dispatch_schema = raw.clone();
    tag_effect_variants(&mut raw);
    strip_presence_constraints(&mut raw);
    hoist_member_objects(
        &mut raw,
        "simple-condition",
        "parameters",
        "condition-parameters",
    );
    hoist_member_objects(&mut raw, "single-effect", "modifier", "effect-modifier");
    let schema: RootSchema = serde_json::from_value(raw)
        .with_context(|| format!("parsing {} as a JSON Schema", schema_path.display()))?;

    let mut settings = TypeSpaceSettings::default();
    // typify already derives Serialize, Deserialize, Debug, Clone; add PartialEq
    // so generated types are comparable (used by the round-trip integration test).
    settings.with_derive("PartialEq".to_string());

    let mut type_space = TypeSpace::new(&settings);
    type_space
        .add_root_schema(schema)
        .context("typify failed to ingest the bundled schema")?;

    let tokens = type_space.to_stream();
    let mut file = syn::parse2::<syn::File>(tokens)
        .context("generated token stream did not parse as a Rust file")?;
    dispatch::install(&mut file, &dispatch_schema)?;
    let formatted = prettyplease::unparse(&file);

    // The `mod generated` declaration in lib.rs carries `#[rustfmt::skip]`, so
    // `cargo fmt` leaves prettyplease's output alone (avoids a conflict with the
    // CI drift check).
    let header = "// @generated by `cargo run -p xtask -- codegen` — do not edit by hand.\n\
                  // Source of truth: crates/wh40kdc/schemas/bundled.schema.json\n\
                  // (regenerate that first via `cd tools && npm run bundle:schemas`).\n\n";

    std::fs::write(&out_path, format!("{header}{formatted}"))
        .with_context(|| format!("writing {}", out_path.display()))?;

    println!("Wrote {}", out_path.display());
    Ok(())
}

/// Map a data file's base name (sans `.json`) to its `RawData` field key.
/// Mirrors `tools/src/codegen-data.ts` `FILE_TO_COLLECTION`, but with the
/// snake_case keys the Rust `RawData` struct deserializes from. Files not listed
/// here (schemas, scratch json) are not bundled.
const FILE_TO_COLLECTION: &[(&str, &str)] = &[
    ("units", "units"),
    ("target-profiles", "target_profiles"),
    ("weapons", "weapons"),
    ("weapon-keywords", "weapon_keywords"),
    ("unit-keywords", "unit_keywords"),
    ("factions", "factions"),
    ("abilities", "abilities"),
    ("phase-mappings", "phase_mappings"),
    ("detachments", "detachments"),
    ("allies", "allied_rules"),
    ("stratagems", "stratagems"),
    ("enhancements", "enhancements"),
    ("leader-attachments", "leader_attachments"),
    ("unit-compositions", "unit_compositions"),
    ("wargear-options", "wargear_options"),
    ("wargear", "wargear"),
    ("game-versions", "game_versions"),
    ("missions", "missions"),
    ("mission-matchups", "mission_matchups"),
    ("mission-cards", "mission_cards"),
    ("deployment-patterns", "deployment_patterns"),
    ("force-dispositions", "force_dispositions"),
    ("terrain-templates", "terrain_templates"),
    ("terrain-layouts", "terrain_layouts"),
    ("hull-shapes", "hull_shapes"),
    ("resource-pools", "resource_pools"),
    ("interaction-flags", "interaction_flags"),
];

/// Directory names holding examples/scratch data that must never be bundled.
/// (`_core` is deliberately *not* excluded — its shared abilities are bundled.)
const EXCLUDED_DIRS: &[&str] = &["_example", "_port-audit"];

/// Collections whose records are stamped with their owning faction (the
/// `data/{core,enrichment}/<faction>/` directory) at bundle time, so ids
/// shared across factions resolve faction-scoped in the linked API instead of
/// first-wins (issue #59 generalized). A record is stamped only when it has no
/// `faction_id` key at all (an authored value, even `null`, is kept verbatim for
/// byte-stability). Records in `_`-prefixed directories (the shared
/// `enrichment/_core` pool) are never stamped. Abilities are not stamped: their
/// ids are unique and every faction record names its faction.
/// Mirrors `tools/src/codegen-data.ts` `STAMP_FACTION` — keep the two in sync.
const STAMP_FACTION: &[&str] = &["weapons"];

/// Bundle every authored `data/` file into one embedded JSON object.
///
/// Output is deterministic: files are visited in sorted path order and every
/// collection key is present (empty arrays included), so the committed bundle
/// only changes when the underlying data does — which is what the CI drift check
/// keys on.
fn bundle_data() -> Result<()> {
    let root = workspace_root();
    let out_path = root.join("crates/wh40kdc/src/data/bundle.generated.json");

    // Pre-seed every collection so the bundle surface is stable.
    let mut bundle: BTreeMap<&str, Vec<Value>> = FILE_TO_COLLECTION
        .iter()
        .map(|&(_, key)| (key, Vec::new()))
        .collect();

    let mut files = Vec::new();
    for sub in ["core", "enrichment"] {
        let dir = root.join("data").join(sub);
        if dir.exists() {
            collect_files(&dir, &mut files)?;
        }
    }
    files.sort();

    for file in &files {
        let stem = file
            .file_stem()
            .and_then(|s| s.to_str())
            .context("data file has no UTF-8 stem")?;
        let Some(&(_, key)) = FILE_TO_COLLECTION.iter().find(|&&(name, _)| name == stem) else {
            continue; // schema / scratch json we don't bundle
        };
        let raw =
            std::fs::read_to_string(file).with_context(|| format!("reading {}", file.display()))?;
        let parsed: Value = serde_json::from_str(&raw)
            .with_context(|| format!("parsing {} as JSON", file.display()))?;
        let Value::Array(mut items) = parsed else {
            bail!("expected a JSON array in {}", file.display());
        };
        // Stamp records with their owning faction directory so ids shared
        // across factions resolve faction-scoped rather than first-wins (see
        // STAMP_FACTION for the per-collection rules and the `_core`
        // exclusion). Mirrors the TS bundler.
        if STAMP_FACTION.contains(&key) {
            if let Some(faction) = faction_of_path(file) {
                if !faction.starts_with('_') {
                    for item in &mut items {
                        if let Value::Object(map) = item {
                            if !map.contains_key("faction_id") {
                                map.insert(
                                    "faction_id".to_string(),
                                    Value::String(faction.clone()),
                                );
                            }
                        }
                    }
                }
            }
        }
        bundle.get_mut(key).expect("key pre-seeded").extend(items);
    }

    let object: serde_json::Map<String, Value> = bundle
        .into_iter()
        .map(|(k, v)| (k.to_string(), Value::Array(v)))
        .collect();
    let json = serde_json::to_string(&Value::Object(object.clone()))
        .context("serializing the data bundle")?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(&out_path, json).with_context(|| format!("writing {}", out_path.display()))?;

    let counts = object
        .iter()
        .map(|(k, v)| format!("{k}={}", v.as_array().map_or(0, Vec::len)))
        .collect::<Vec<_>>()
        .join(", ");
    println!("Wrote {}\n  {counts}", out_path.display());

    // Mirror the committed share-token registry into the crate, so the share
    // codec can embed it via include_str! (a published crate can't reach the
    // repo-root data/ tree). This is the Rust analogue of the TS codegen step
    // that emits src/share/registry.generated.ts.
    let reg_src = root.join("data/share-registry.json");
    let reg_out = root.join("crates/wh40kdc/src/share/registry.generated.json");
    if reg_src.exists() {
        if let Some(parent) = reg_out.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        std::fs::copy(&reg_src, &reg_out)
            .with_context(|| format!("copying {} → {}", reg_src.display(), reg_out.display()))?;
        println!("Wrote {}", reg_out.display());
    }
    Ok(())
}

/// Recursively collect `.json` files under `dir`, skipping excluded dirs.
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("reading dir {}", dir.display()))? {
        let path = entry?.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if path.is_dir() {
            if !EXCLUDED_DIRS.contains(&name) {
                collect_files(&path, out)?;
            }
        } else if name.ends_with(".json") && !name.ends_with(".example.json") {
            out.push(path);
        }
    }
    Ok(())
}

/// The faction a data file belongs to: its parent directory name when the file
/// sits in `data/<core|enrichment>/<faction>/…`. Returns `None` for a file
/// directly under `core`/`enrichment` (faction-less), matching the TS bundler.
fn faction_of_path(file: &Path) -> Option<String> {
    let parent = file.parent()?;
    let grand = parent.parent()?.file_name()?.to_str()?;
    if grand == "core" || grand == "enrichment" {
        parent.file_name()?.to_str().map(str::to_string)
    } else {
        None
    }
}
