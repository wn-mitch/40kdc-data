//! Tag-dispatched deserializers for the recursive Ability-DSL enums.
//!
//! typify derives `Deserialize` for a `oneOf` as `#[serde(untagged)]`: serde buffers the
//! value, then tries every variant in turn from one function whose debug-build frame holds a
//! result slot for each variant. `EffectNode` (22 variants) and `ConditionNode` nest inside
//! each other, so a deep ability spent about 200 KiB of stack per level and overflowed a
//! 2 MiB thread. The impls emitted here read the discriminating key first (`type` for an
//! effect node, `operator` for a condition node) and deserialize only the matching variant,
//! through a function pointer so each level pays for one variant's frame. Errors also name
//! the real problem instead of "did not match any variant".

use anyhow::{bail, Context, Result};
use serde_json::Value;

/// The `type` tags each `effect-node` member accepts, in `oneOf` order, with the member's
/// definition name. A member that is itself a `oneOf` (`single-effect`) contributes the tags of
/// all its members.
pub fn effect_node_tags(schema: &Value) -> Result<Vec<(String, Vec<String>)>> {
    let members = schema
        .pointer("/$defs/effect-node/oneOf")
        .and_then(Value::as_array)
        .context("bundled schema has no $defs/effect-node/oneOf")?;
    let mut out = Vec::new();
    for member in members {
        let name = member
            .get("$ref")
            .and_then(Value::as_str)
            .and_then(|r| r.strip_prefix("#/$defs/"))
            .context("effect-node member is not a local $ref")?;
        let def = schema
            .pointer(&format!("/$defs/{name}"))
            .with_context(|| format!("missing $defs/{name}"))?;
        let tags: Vec<String> = match def.get("oneOf").and_then(Value::as_array) {
            Some(inner) => inner.iter().filter_map(type_const).collect(),
            None => type_const(def).into_iter().collect(),
        };
        if tags.is_empty() {
            bail!("effect-node member {name} declares no `type` constant");
        }
        out.push((name.to_string(), tags));
    }
    Ok(out)
}

fn type_const(def: &Value) -> Option<String> {
    let t = def.pointer("/properties/type")?;
    t.get("const")
        .and_then(Value::as_str)
        .or_else(
            || match t.get("enum").and_then(Value::as_array)?.as_slice() {
                [only] => only.as_str(),
                _ => None,
            },
        )
        .map(str::to_string)
}

/// typify's type name for a definition (`single-effect` → `SingleEffect`).
fn pascal(name: &str) -> String {
    name.split(['-', '_'])
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
                .unwrap_or_default()
        })
        .collect()
}

fn find_enum<'a>(file: &'a mut syn::File, name: &str) -> Result<&'a mut syn::ItemEnum> {
    file.items
        .iter_mut()
        .find_map(|item| match item {
            syn::Item::Enum(e) if e.ident == name => Some(e),
            _ => None,
        })
        .with_context(|| format!("generated code has no enum {name}"))
}

/// Drop `Deserialize` from the enum's derive list; its impl is emitted by hand.
fn strip_deserialize(e: &mut syn::ItemEnum) -> Result<()> {
    let mut removed = false;
    for attr in &mut e.attrs {
        if !attr.path().is_ident("derive") {
            continue;
        }
        let paths = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
        )?;
        let mut kept = Vec::new();
        for p in &paths {
            if p.segments.last().is_some_and(|s| s.ident == "Deserialize") {
                removed = true;
            } else {
                kept.push(path_string(p));
            }
        }
        *attr = derive_attr(&kept)?;
    }
    if !removed {
        bail!("enum {} derives no Deserialize to replace", e.ident);
    }
    Ok(())
}

fn path_string(p: &syn::Path) -> String {
    let lead = if p.leading_colon.is_some() { "::" } else { "" };
    let segs: Vec<String> = p.segments.iter().map(|s| s.ident.to_string()).collect();
    format!("{lead}{}", segs.join("::"))
}

/// `#[derive(<paths>)]`, parsed from source text.
fn derive_attr(paths: &[String]) -> Result<syn::Attribute> {
    let item: syn::ItemStruct =
        syn::parse_str(&format!("#[derive({})] struct X;", paths.join(", ")))?;
    item.attrs
        .into_iter()
        .next()
        .context("derive attribute did not parse")
}

/// Replace the untagged `Deserialize` derives on `EffectNode` and `ConditionNode` with
/// tag-dispatched impls.
pub fn install(file: &mut syn::File, schema: &Value) -> Result<()> {
    let tags = effect_node_tags(schema)?;
    let effect = find_enum(file, "EffectNode")?;
    let variants: Vec<String> = effect
        .variants
        .iter()
        .map(|v| v.ident.to_string())
        .collect();
    if variants.len() != tags.len() {
        bail!(
            "EffectNode has {} variants but effect-node has {} members",
            variants.len(),
            tags.len()
        );
    }
    let mut arms = String::new();
    for ((def, tags), variant) in tags.iter().zip(&variants) {
        if pascal(def) != *variant {
            bail!(
                "effect-node member {def} generated as variant {variant}, expected {}",
                pascal(def)
            );
        }
        let pattern = tags
            .iter()
            .map(|t| format!("{t:?}"))
            .collect::<Vec<_>>()
            .join(" | ");
        arms.push_str(&format!(
            "Some({pattern}) => |v| ::serde_json::from_value(v).map(EffectNode::{variant}),\n"
        ));
    }
    strip_deserialize(effect)?;
    let condition = find_enum(file, "ConditionNode")?;
    let cond_variants: Vec<String> = condition
        .variants
        .iter()
        .map(|v| v.ident.to_string())
        .collect();
    if cond_variants != ["SimpleCondition", "CompoundCondition"] {
        bail!("ConditionNode variants changed: {cond_variants:?}");
    }
    strip_deserialize(condition)?;

    let code = format!(
        r#"
/// Deserializes by the node's `type` tag: only the matching variant is attempted.
impl<'de> ::serde::Deserialize<'de> for EffectNode {{
    fn deserialize<D: ::serde::Deserializer<'de>>(deserializer: D) -> ::std::result::Result<Self, D::Error> {{
        let value = <::serde_json::Value as ::serde::Deserialize>::deserialize(deserializer)?;
        effect_node_from_value(value).map_err(<D::Error as ::serde::de::Error>::custom)
    }}
}}
#[inline(never)]
fn effect_node_from_value(value: ::serde_json::Value) -> ::std::result::Result<EffectNode, ::serde_json::Error> {{
    type Parse = fn(::serde_json::Value) -> ::std::result::Result<EffectNode, ::serde_json::Error>;
    let parse: Parse = match value.get("type").and_then(::serde_json::Value::as_str) {{
        {arms}
        Some(other) => return Err(<::serde_json::Error as ::serde::de::Error>::custom(format_args!("unknown effect node type `{{other}}`"))),
        None => return Err(<::serde_json::Error as ::serde::de::Error>::custom("effect node has no string `type`")),
    }};
    parse(value)
}}
/// Deserializes an and/or/not node when `operator` is present, else a predicate.
impl<'de> ::serde::Deserialize<'de> for ConditionNode {{
    fn deserialize<D: ::serde::Deserializer<'de>>(deserializer: D) -> ::std::result::Result<Self, D::Error> {{
        let value = <::serde_json::Value as ::serde::Deserialize>::deserialize(deserializer)?;
        condition_node_from_value(value).map_err(<D::Error as ::serde::de::Error>::custom)
    }}
}}
#[inline(never)]
fn condition_node_from_value(value: ::serde_json::Value) -> ::std::result::Result<ConditionNode, ::serde_json::Error> {{
    type Parse = fn(::serde_json::Value) -> ::std::result::Result<ConditionNode, ::serde_json::Error>;
    let parse: Parse = if value.get("operator").is_some() {{
        |v| ::serde_json::from_value(v).map(ConditionNode::CompoundCondition)
    }} else {{
        |v| ::serde_json::from_value(v).map(ConditionNode::SimpleCondition)
    }};
    parse(value)
}}
"#
    );
    let extra: syn::File = syn::parse_str(&code).context("tag-dispatch impls did not parse")?;
    file.items.extend(extra.items);
    Ok(())
}
