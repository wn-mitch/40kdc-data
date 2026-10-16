//! Keep recursive DSL nodes pointer-sized without boxing their edges twice.

use std::collections::BTreeMap;

use anyhow::{bail, Context, Result};
use syn::visit_mut::VisitMut;
use syn::{GenericArgument, Item, PathArguments, Type};

const NODES: [&str; 2] = ["EffectNode", "ConditionNode"];

fn type_name(ty: &Type) -> Option<String> {
    let Type::Path(path) = ty else { return None };
    Some(path.path.segments.last()?.ident.to_string())
}

/// Each node owns its variant payload. Recursive fields then store the small node directly,
/// so a nested effect or predicate has one allocation rather than a box around another box.
pub fn install(file: &mut syn::File) -> Result<()> {
    let mut constructors = BTreeMap::new();
    for item in &mut file.items {
        let Item::Enum(node) = item else { continue };
        let name = node.ident.to_string();
        if !NODES.contains(&name.as_str()) {
            continue;
        }
        for variant in &mut node.variants {
            let syn::Fields::Unnamed(fields) = &mut variant.fields else {
                bail!("{name}::{} is not a tuple variant", variant.ident);
            };
            if fields.unnamed.len() != 1 {
                bail!("{name}::{} must have one payload", variant.ident);
            }
            let field = fields.unnamed.first_mut().expect("one payload");
            let payload = type_name(&field.ty).context("node payload is not a named type")?;
            constructors.insert((name.clone(), payload.clone()), variant.ident.to_string());
            field.ty = syn::parse_str(&format!("::std::boxed::Box<{payload}>"))?;
        }
    }
    for name in NODES {
        if !constructors.keys().any(|(node, _)| node == name) {
            bail!("generated code has no {name} variants");
        }
    }
    for item in &mut file.items {
        let Item::Impl(implementation) = item else {
            continue;
        };
        let Some(node) = type_name(&implementation.self_ty) else {
            continue;
        };
        if !NODES.contains(&node.as_str()) {
            continue;
        }
        let Some((_, path, _)) = &implementation.trait_ else {
            continue;
        };
        let Some(segment) = path.segments.last() else {
            continue;
        };
        if segment.ident != "From" {
            continue;
        }
        let PathArguments::AngleBracketed(arguments) = &segment.arguments else {
            bail!("{node} From implementation has no payload type");
        };
        let Some(GenericArgument::Type(payload)) = arguments.args.first() else {
            bail!("{node} From implementation has no payload type");
        };
        let payload = type_name(payload).context("From payload is not a named type")?;
        let Some(variant) = constructors.get(&(node.clone(), payload)) else {
            continue;
        };
        for member in &mut implementation.items {
            if let syn::ImplItem::Fn(method) = member {
                if method.sig.ident == "from" {
                    method.block = syn::parse_str(&format!(
                        "{{ Self::{variant}(::std::boxed::Box::new(value)) }}"
                    ))?;
                }
            }
        }
    }
    UnboxEdges.visit_file_mut(file);
    Ok(())
}

struct UnboxEdges;

impl VisitMut for UnboxEdges {
    fn visit_type_mut(&mut self, ty: &mut Type) {
        let replacement = match ty {
            Type::Path(path) => path.path.segments.last().and_then(|segment| {
                if segment.ident != "Box" {
                    return None;
                }
                let PathArguments::AngleBracketed(arguments) = &segment.arguments else {
                    return None;
                };
                let GenericArgument::Type(inner) = arguments.args.first()? else {
                    return None;
                };
                type_name(inner)
                    .filter(|name| NODES.contains(&name.as_str()))
                    .map(|_| inner.clone())
            }),
            _ => None,
        };
        if let Some(inner) = replacement {
            *ty = inner;
        }
        syn::visit_mut::visit_type_mut(self, ty);
    }
}
