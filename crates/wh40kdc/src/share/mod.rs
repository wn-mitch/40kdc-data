//! Compact, URL-safe list sharing — the Rust mirror of the TS `share` module
//! (`tools/src/share/`).
//!
//! [`encode_share_token`] packs a [`ShareList`] (the lossless essential subset of
//! a roster) into a `share-v1` token: registry-indexed unsigned-LEB128 varints,
//! base64url, no gzip. [`decode_share_token`] reverses it against the embedded
//! [`ShareRegistry`]. The wire format and registry are documented in
//! `tools/docs/share-token.md`; the `conformance/share` corpus pins this
//! implementation byte-for-byte against the TS and Python ports.
//!
//! The registry is the versioned, append-only id dictionary: indices never move
//! (so a newer registry decodes any older token), renames ride in
//! [`ShareRegistry::aliases`], and removed ids sit in
//! [`ShareRegistry::tombstones`].

use std::collections::HashMap;

use base64::Engine;
use serde::{Deserialize, Serialize};

/// Current wire-format version. Bumped only if the byte layout changes.
pub const SHARE_FORMAT_VERSION: u8 = 1;

const FLAG_WARLORD: u64 = 1 << 0;
const FLAG_ENH: u64 = 1 << 1;
const FLAG_ATTACH: u64 = 1 << 2;
const FLAG_ALLY: u64 = 1 << 3;
const FLAG_GRANTS: u64 = 1 << 4;

const BATTLE_SIZES: [&str; 2] = ["incursion", "strike-force"];

const REGISTRY_JSON: &str = include_str!("registry.generated.json");

// ── registry ──────────────────────────────────────────────────────────────────

/// The committed registry artifact (mirrors `data/share-registry.json`).
#[derive(Debug, Clone, Deserialize)]
pub struct ShareRegistry {
    pub version: u64,
    pub kinds: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub aliases: HashMap<String, String>,
    #[serde(default)]
    pub tombstones: Vec<String>,
}

/// Registry kinds, in fixed order (only used to validate the artifact's shape).
pub const SHARE_KINDS: [&str; 7] = [
    "faction",
    "detachment",
    "unit",
    "wargear",
    "enhancement",
    "ally_rule",
    "disposition",
];

/// Bidirectional lookup over one registry, prepared once for encode/decode.
pub struct ShareRegistryIndex {
    pub version: u64,
    to_index: HashMap<String, HashMap<String, usize>>,
    from_index: HashMap<String, Vec<String>>,
}

impl ShareRegistryIndex {
    /// Build the lookup, folding renames into both directions.
    pub fn new(registry: &ShareRegistry) -> Self {
        let mut to_index: HashMap<String, HashMap<String, usize>> = HashMap::new();
        let mut from_index: HashMap<String, Vec<String>> = HashMap::new();

        for kind in SHARE_KINDS {
            let ids = registry.kinds.get(kind).cloned().unwrap_or_default();
            let mut map = HashMap::new();
            let mut out = Vec::with_capacity(ids.len());
            for (i, id) in ids.iter().enumerate() {
                map.insert(id.clone(), i);
                // Decode resolves a slot to its current id (rewriting a rename).
                out.push(registry.aliases.get(id).cloned().unwrap_or_else(|| id.clone()));
            }
            // Encode must also find the current id at a renamed slot.
            for (old_id, new_id) in &registry.aliases {
                if let Some(&slot) = map.get(old_id) {
                    map.entry(new_id.clone()).or_insert(slot);
                }
            }
            to_index.insert(kind.to_string(), map);
            from_index.insert(kind.to_string(), out);
        }

        Self { version: registry.version, to_index, from_index }
    }

    /// The package's embedded registry index, parsed once.
    pub fn embedded() -> &'static ShareRegistryIndex {
        use std::sync::OnceLock;
        static INDEX: OnceLock<ShareRegistryIndex> = OnceLock::new();
        INDEX.get_or_init(|| {
            let registry: ShareRegistry =
                serde_json::from_str(REGISTRY_JSON).expect("embedded share registry parses");
            ShareRegistryIndex::new(&registry)
        })
    }

    fn index(&self, kind: &str, id: &str) -> Option<usize> {
        self.to_index.get(kind).and_then(|m| m.get(id).copied())
    }

    fn id(&self, kind: &str, index: usize) -> Option<&str> {
        self.from_index.get(kind).and_then(|v| v.get(index)).map(String::as_str)
    }
}

// ── public data shape ──────────────────────────────────────────────────────────

/// One unit in a [`ShareList`]. Field names mirror the TS `ShareUnit` so the
/// conformance corpus deserializes directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareUnit {
    pub datasheet_id: String,
    pub model_count: u64,
    pub is_warlord: bool,
    pub enhancement_id: Option<String>,
    pub ally_faction_id: Option<String>,
    pub ally_rule_id: Option<String>,
    pub attached_to_ordinal: Option<u64>,
    pub grants: Vec<String>,
    /// `[wargearId, count]` pairs.
    pub loadout: Vec<(String, u64)>,
}

/// The lossless, serializable essence of a list — what a share link carries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareList {
    pub name: String,
    pub faction_id: Option<String>,
    pub detachment_ids: Vec<String>,
    pub battle_size: String,
    pub disposition: Option<String>,
    pub units: Vec<ShareUnit>,
}

/// Why a token couldn't be read. Serializes to the `reason` string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    Malformed,
    StaleRegistry,
}

impl DecodeError {
    fn reason(self) -> &'static str {
        match self {
            DecodeError::Malformed => "malformed",
            DecodeError::StaleRegistry => "stale-registry",
        }
    }
}

/// Outcome of [`decode_share_token`]. Serializes to `{"ok":true,"list":…}` or
/// `{"ok":false,"reason":"…"}` to match the TS `DecodeResult`.
#[derive(Debug, Clone, PartialEq)]
pub enum DecodeResult {
    Ok(ShareList),
    Err(DecodeError),
}

impl Serialize for DecodeResult {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            DecodeResult::Ok(list) => {
                let mut m = s.serialize_map(Some(2))?;
                m.serialize_entry("ok", &true)?;
                m.serialize_entry("list", list)?;
                m.end()
            }
            DecodeResult::Err(e) => {
                let mut m = s.serialize_map(Some(2))?;
                m.serialize_entry("ok", &false)?;
                m.serialize_entry("reason", e.reason())?;
                m.end()
            }
        }
    }
}

/// An id missing from the registry — the only way encoding can fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShareEncodeError {
    pub kind: String,
    pub id: String,
}

impl std::fmt::Display for ShareEncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "share registry has no {} id \"{}\" — run `cargo run -p xtask -- bundle-data` after `npm run registry:build`",
            self.kind, self.id
        )
    }
}

impl std::error::Error for ShareEncodeError {}

// ── varint + base64url ──────────────────────────────────────────────────────────

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8 & 0x7f) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn write_str(out: &mut Vec<u8>, s: &str) {
    write_varint(out, s.len() as u64);
    out.extend_from_slice(s.as_bytes());
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn byte(&mut self) -> Result<u8, DecodeError> {
        let b = *self.bytes.get(self.pos).ok_or(DecodeError::Malformed)?;
        self.pos += 1;
        Ok(b)
    }

    fn varint(&mut self) -> Result<u64, DecodeError> {
        let mut result: u64 = 0;
        let mut shift = 0u32;
        loop {
            let b = self.byte()?;
            // 64-bit guard: refuse a shift that would overflow.
            if shift >= 64 {
                return Err(DecodeError::Malformed);
            }
            result |= ((b & 0x7f) as u64) << shift;
            if b & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
        }
    }

    fn str(&mut self) -> Result<String, DecodeError> {
        let len = self.varint()? as usize;
        let end = self.pos.checked_add(len).ok_or(DecodeError::Malformed)?;
        let slice = self.bytes.get(self.pos..end).ok_or(DecodeError::Malformed)?;
        self.pos = end;
        String::from_utf8(slice.to_vec()).map_err(|_| DecodeError::Malformed)
    }
}

fn base64url() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

// ── encode ───────────────────────────────────────────────────────────────────────

fn require_index(idx: &ShareRegistryIndex, kind: &str, id: &str) -> Result<usize, ShareEncodeError> {
    idx.index(kind, id)
        .ok_or_else(|| ShareEncodeError { kind: kind.to_string(), id: id.to_string() })
}

/// Encode a [`ShareList`] into a URL-safe `share-v1` token using `registry`.
pub fn encode_share_list(
    list: &ShareList,
    registry: &ShareRegistryIndex,
) -> Result<String, ShareEncodeError> {
    let mut out = Vec::new();
    out.push(SHARE_FORMAT_VERSION);
    write_varint(&mut out, registry.version);
    write_str(&mut out, &list.name);

    match &list.faction_id {
        None => write_varint(&mut out, 0),
        Some(id) => write_varint(&mut out, require_index(registry, "faction", id)? as u64 + 1),
    }
    let bs = BATTLE_SIZES.iter().position(|&b| b == list.battle_size).unwrap_or(0);
    write_varint(&mut out, bs as u64);
    match &list.disposition {
        None => write_varint(&mut out, 0),
        Some(id) => write_varint(&mut out, require_index(registry, "disposition", id)? as u64 + 1),
    }

    write_varint(&mut out, list.detachment_ids.len() as u64);
    for id in &list.detachment_ids {
        write_varint(&mut out, require_index(registry, "detachment", id)? as u64);
    }

    write_varint(&mut out, list.units.len() as u64);
    for u in &list.units {
        write_varint(&mut out, require_index(registry, "unit", &u.datasheet_id)? as u64);
        write_varint(&mut out, u.model_count);
        let flags = (if u.is_warlord { FLAG_WARLORD } else { 0 })
            | (if u.enhancement_id.is_some() { FLAG_ENH } else { 0 })
            | (if u.attached_to_ordinal.is_some() { FLAG_ATTACH } else { 0 })
            | (if u.ally_rule_id.is_some() || u.ally_faction_id.is_some() { FLAG_ALLY } else { 0 })
            | (if !u.grants.is_empty() { FLAG_GRANTS } else { 0 });
        write_varint(&mut out, flags);
        if let Some(enh) = &u.enhancement_id {
            write_varint(&mut out, require_index(registry, "enhancement", enh)? as u64);
        }
        if let Some(ord) = u.attached_to_ordinal {
            write_varint(&mut out, ord);
        }
        if flags & FLAG_ALLY != 0 {
            match &u.ally_faction_id {
                None => write_varint(&mut out, 0),
                Some(id) => write_varint(&mut out, require_index(registry, "faction", id)? as u64 + 1),
            }
            match &u.ally_rule_id {
                None => write_varint(&mut out, 0),
                Some(id) => write_varint(&mut out, require_index(registry, "ally_rule", id)? as u64 + 1),
            }
        }
        if !u.grants.is_empty() {
            write_varint(&mut out, u.grants.len() as u64);
            for g in &u.grants {
                write_str(&mut out, g);
            }
        }
        write_varint(&mut out, u.loadout.len() as u64);
        for (wid, count) in &u.loadout {
            write_varint(&mut out, require_index(registry, "wargear", wid)? as u64);
            write_varint(&mut out, *count);
        }
    }

    Ok(base64url().encode(out))
}

/// Encode using the package's embedded registry.
pub fn encode_share_token(list: &ShareList) -> Result<String, ShareEncodeError> {
    encode_share_list(list, ShareRegistryIndex::embedded())
}

// ── decode ───────────────────────────────────────────────────────────────────────

fn require_id(idx: &ShareRegistryIndex, kind: &str, slot: usize) -> Result<String, DecodeError> {
    idx.id(kind, slot).map(str::to_string).ok_or(DecodeError::StaleRegistry)
}

fn decode_inner(token: &str, registry: &ShareRegistryIndex) -> Result<ShareList, DecodeError> {
    let bytes = base64url().decode(token).map_err(|_| DecodeError::Malformed)?;
    let mut r = Reader { bytes: &bytes, pos: 0 };

    if r.byte()? != SHARE_FORMAT_VERSION {
        return Err(DecodeError::Malformed);
    }
    let _registry_version = r.varint()?; // informational; bounds checks gate staleness.

    let name = r.str()?;
    let faction_ref = r.varint()?;
    let faction_id = if faction_ref == 0 {
        None
    } else {
        Some(require_id(registry, "faction", (faction_ref - 1) as usize)?)
    };
    let battle_size =
        BATTLE_SIZES.get(r.varint()? as usize).copied().unwrap_or("strike-force").to_string();
    let disposition_ref = r.varint()?;
    let disposition = if disposition_ref == 0 {
        None
    } else {
        Some(require_id(registry, "disposition", (disposition_ref - 1) as usize)?)
    };

    let det_count = r.varint()?;
    let mut detachment_ids = Vec::with_capacity(det_count as usize);
    for _ in 0..det_count {
        detachment_ids.push(require_id(registry, "detachment", r.varint()? as usize)?);
    }

    let unit_count = r.varint()?;
    let mut units = Vec::with_capacity(unit_count as usize);
    for _ in 0..unit_count {
        let datasheet_id = require_id(registry, "unit", r.varint()? as usize)?;
        let model_count = r.varint()?;
        let flags = r.varint()?;
        let enhancement_id = if flags & FLAG_ENH != 0 {
            Some(require_id(registry, "enhancement", r.varint()? as usize)?)
        } else {
            None
        };
        let attached_to_ordinal = if flags & FLAG_ATTACH != 0 { Some(r.varint()?) } else { None };
        let (mut ally_faction_id, mut ally_rule_id) = (None, None);
        if flags & FLAG_ALLY != 0 {
            let f_ref = r.varint()?;
            ally_faction_id = if f_ref == 0 {
                None
            } else {
                Some(require_id(registry, "faction", (f_ref - 1) as usize)?)
            };
            let r_ref = r.varint()?;
            ally_rule_id = if r_ref == 0 {
                None
            } else {
                Some(require_id(registry, "ally_rule", (r_ref - 1) as usize)?)
            };
        }
        let mut grants = Vec::new();
        if flags & FLAG_GRANTS != 0 {
            let g_count = r.varint()?;
            for _ in 0..g_count {
                grants.push(r.str()?);
            }
        }
        let l_count = r.varint()?;
        let mut loadout = Vec::with_capacity(l_count as usize);
        for _ in 0..l_count {
            let wid = require_id(registry, "wargear", r.varint()? as usize)?;
            loadout.push((wid, r.varint()?));
        }
        units.push(ShareUnit {
            datasheet_id,
            model_count,
            is_warlord: flags & FLAG_WARLORD != 0,
            enhancement_id,
            ally_faction_id,
            ally_rule_id,
            attached_to_ordinal,
            grants,
            loadout,
        });
    }

    Ok(ShareList { name, faction_id, detachment_ids, battle_size, disposition, units })
}

/// Decode a `share-v1` token against `registry`.
pub fn decode_share_list(token: &str, registry: &ShareRegistryIndex) -> DecodeResult {
    match decode_inner(token, registry) {
        Ok(list) => DecodeResult::Ok(list),
        Err(e) => DecodeResult::Err(e),
    }
}

/// Decode using the package's embedded registry.
pub fn decode_share_token(token: &str) -> DecodeResult {
    decode_share_list(token, ShareRegistryIndex::embedded())
}
