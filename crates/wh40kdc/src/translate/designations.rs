//! The designation registry: every tag an effect may apply, as a kebab-case id, and the
//! rules' own term for the ids the rules print. Mirrors `tools/src/translate/designations.ts`;
//! the labels are pinned byte-for-byte across the ports with the describers.

/// Every designation id records may apply or test, sorted (binary-searched).
pub const DESIGNATION_IDS: &[&str] = &[
    "a-trap-well-laid",
    "acquisition",
    "affected-by-order",
    "afflicted",
    "aflame",
    "analysed",
    "assailed",
    "assemblage-of-might",
    "auspex-scanned",
    "battle-shock-auto-succeed",
    "bio-stimulus-target",
    "blight-bombardment-target",
    "bloody-vengeance",
    "breaching-fire-target",
    "busted",
    "chronosorcerous-bleed",
    "claw-of-ascension-crossfire-target",
    "claw-of-ascension-priority-target",
    "claw-of-ascension-survey-augur-target",
    "cleansed",
    "condemned",
    "conqueror-imperative-active",
    "consecrated",
    "contract-unit",
    "counterstrategist-target",
    "covered-in-squigs",
    "daring-recon-target",
    "death-begets-vengeance-hated",
    "decoyed",
    "designated",
    "dreadherder-target",
    "dual-melee",
    "eliminate-at-all-costs",
    "empowered",
    "enhancement-expended",
    "entrenched",
    "favoured-champions",
    "flame-wreathed",
    "focus-of-hatred",
    "guidance-of-the-ancients",
    "guidance-of-the-ancients-crowes-sanctifiers",
    "guided",
    "hated-foe",
    "held",
    "hidden",
    "hunted",
    "illuminated",
    "losing-the-wager",
    "machine-vengeance-target",
    "marked",
    "marked-prey",
    "mutated",
    "nethershriek-mind-eater",
    "no-benefit-of-cover",
    "nulled",
    "oath-fulfilled",
    "oath-of-moment",
    "oath-of-moment-target",
    "observer",
    "octagram-battle-shock",
    "over-there-target",
    "overlapping-fire",
    "pinned",
    "pinpoint-counter-offensive",
    "pledge-of-mortal-pain",
    "plundered",
    "prey-marked",
    "priority-target",
    "prosecuted",
    "protector-imperative-active",
    "pulsa-rokkit-target",
    "pulse-onslaught-shaken",
    "quarry",
    "remains-under-your-control",
    "riled-up",
    "sabotaged",
    "scornful-analysis-designated",
    "secured",
    "servo-designated",
    "shadow-of-chaos",
    "shaken",
    "shocked",
    "signal-fire-target",
    "singular-purpose-enemy",
    "singular-purpose-marker",
    "slayer-of-champions",
    "spirit-mark",
    "split-into-single-model-units",
    "spotted",
    "staggered",
    "stormwracked",
    "strategic-conqueror",
    "suppressed",
    "suppressing-fire-pinned",
    "surveilled",
    "symbiotic-target",
    "tethered",
    "throne-tyrannicus",
    "titanic-duel-target",
    "trapped",
    "triangulated",
    "unbridled-ardour-slayer",
    "unhideable",
    "unmasked",
    "vengeful-dead",
    "whispering-web",
    "wholly-within-flow-of-magic",
    "winning-the-wager",
    "worthy-foes",
];

/// Whether `id` is a registered designation.
pub fn is_designation_id(id: &str) -> bool {
    DESIGNATION_IDS.binary_search(&id).is_ok()
}

/// The printed term for a registered id after "is"/"are" ("Spotted", "an Observer" /
/// "Observers"), else `None`.
pub fn designation_label(id: &str, plural: bool) -> Option<String> {
    let (adjective, noun) = match id {
        "afflicted" => (Some("Afflicted"), None),
        "spotted" => (Some("Spotted"), None),
        "guided" => (Some("Guided"), None),
        "riled-up" => (Some("riled up"), None),
        "empowered" => (Some("Empowered"), None),
        "observer" => (None, Some("Observer")),
        _ => return None,
    };
    if let Some(a) = adjective {
        return Some(a.to_string());
    }
    let noun = noun.unwrap_or(id);
    Some(if plural {
        format!("{noun}s")
    } else {
        let an = noun.starts_with(['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U']);
        format!("{} {noun}", if an { "an" } else { "a" })
    })
}

/// A tag as its registry id: legacy upper-case, spaced spellings fold onto the kebab-case id.
pub fn designation_id(tag: &str) -> String {
    let lower = tag.trim().to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_run = false;
    for c in lower.chars() {
        if c.is_whitespace() || c == '_' {
            if !in_run {
                out.push('-');
            }
            in_run = true;
        } else {
            out.push(c);
            in_run = false;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_is_sorted_for_binary_search() {
        assert!(DESIGNATION_IDS.windows(2).all(|w| w[0] < w[1]));
        assert!(is_designation_id("spotted") && is_designation_id("observer"));
        assert!(!is_designation_id("SPOTTED"));
    }

    #[test]
    fn labels_and_folding_match_ts() {
        assert_eq!(
            designation_label("observer", false).as_deref(),
            Some("an Observer")
        );
        assert_eq!(
            designation_label("observer", true).as_deref(),
            Some("Observers")
        );
        assert_eq!(
            designation_label("riled-up", true).as_deref(),
            Some("riled up")
        );
        assert_eq!(designation_label("hunted", false), None);
        assert_eq!(designation_id(" RILED  UP "), "riled-up");
        assert_eq!(designation_id("Oath_of Moment"), "oath-of-moment");
    }
}
