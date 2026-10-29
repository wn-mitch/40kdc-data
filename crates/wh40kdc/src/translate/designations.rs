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
    "aggressive-deployment-target",
    "analysed",
    "assailed",
    "assemblage-of-might",
    "auspex-scanned",
    "bastion-shield-yp-spent",
    "battle-shock-auto-succeed",
    "bio-stimulus-target",
    "blessed",
    "blight-bombardment-target",
    "blood-throne-target",
    "bloody-vengeance",
    "bondsman-affected",
    "bounty-hunters-target",
    "breaching-fire-target",
    "busted",
    "catechism-of-fire-target",
    "chronosorcerous-bleed",
    "claw-of-ascension-crossfire-target",
    "claw-of-ascension-priority-target",
    "claw-of-ascension-survey-augur-target",
    "cleansed",
    "co-ordinated-eradication-target",
    "condemned",
    "conqueror-imperative-active",
    "consecrated",
    "contract-unit",
    "coordinated-crossfire-target",
    "corrupted",
    "counterstrategist-target",
    "covered-in-squigs",
    "crossfire-target",
    "crystalline-targeting-target",
    "cyberstimm-infusion-yp-spent",
    "daring-recon-target",
    "death-begets-vengeance-hated",
    "deaths-heads-target",
    "decoyed",
    "defect-scrutiny-target",
    "defence-stance",
    "designated",
    "detected",
    "devastating-reprise-target",
    "devoted-duellists-target",
    "disrupted",
    "doom-target",
    "dreadherder-target",
    "driven-from-cover-target",
    "dual-melee",
    "eliminate-at-all-costs",
    "empowered",
    "enfeebled",
    "enhancement-expended",
    "ensnared",
    "entrenched",
    "exposed-flaws-yp-spent",
    "eye-of-spite-pain-spent",
    "fanatical-hail-target",
    "favoured-champions",
    "fields-of-fire-target",
    "fire-focus-target",
    "fire-support-target",
    "flame-wreathed",
    "focus-of-hatred",
    "focused-hunters-target",
    "focused-immolation-target",
    "focused-strikes-target",
    "grav-pinned",
    "grounded",
    "guidance-of-the-ancients",
    "guidance-of-the-ancients-crowes-sanctifiers",
    "guidance-of-the-ancients-psychic-target",
    "guide-target",
    "guided",
    "hail-of-corrosive-disease-target",
    "hailstrike-target",
    "hated-foe",
    "held",
    "herald-of-ynnead-target",
    "hidden",
    "honour-of-the-hold-target",
    "honour-of-the-hold-yp-spent",
    "hunted",
    "illuminated",
    "illuminated-priority-target",
    "imperial-law-target",
    "infested-with-snotlings",
    "inflamed-infections-target",
    "instinctive-spite-pain-spent",
    "judged-for-execution-target",
    "losing-the-wager",
    "machine-vengeance-target",
    "malevolent",
    "mark",
    "marked",
    "marked-by-fate-target",
    "marked-prey",
    "murderous-crossfire-target",
    "mutated",
    "nethershriek-mind-eater",
    "no-benefit-of-cover",
    "nulled",
    "oath-fulfilled",
    "oath-of-moment",
    "oath-of-moment-target",
    "observer",
    "octagram-battle-shock",
    "on-my-signal-fire-target",
    "optimal-expenditure-yp-spent",
    "over-there-target",
    "overlapping-fire",
    "pinned",
    "pinpoint-counter-offensive",
    "piratical-raiders-target",
    "pledge-of-mortal-pain",
    "plundered",
    "poisoned",
    "practiced-eye-target",
    "prey",
    "prey-marked",
    "priority-target",
    "privateer-arsenal-yp-spent",
    "prosecuted",
    "protector-imperative-active",
    "pulsa-rokkit-target",
    "pulse-onslaught-shaken",
    "quarry",
    "readied",
    "remains-under-your-control",
    "righteous",
    "riled-up",
    "rites-of-castigation-target",
    "riven",
    "rotted",
    "sabotaged",
    "scanned",
    "scattered",
    "scornful-analysis-designated",
    "scornful-analysis-target",
    "secured",
    "servo-designated",
    "servo-designators-target",
    "shadow-of-chaos",
    "shaken",
    "shattered-defences-target",
    "shocked",
    "signal-fire-target",
    "singular-purpose-enemy",
    "singular-purpose-marker",
    "singular-purpose-target",
    "slayer-of-champions",
    "slayers-oath",
    "slowed",
    "smashed",
    "snared",
    "sorcerous-support-target",
    "spirit-mark",
    "spirit-thief-target",
    "split-into-single-model-units",
    "spotted",
    "staggered",
    "stalker-target",
    "stormwracked",
    "strategic-conqueror",
    "struck-by-arcing-energies",
    "struck-by-concussive-wave",
    "struck-by-explosive-debris",
    "struck-by-spores",
    "stunned",
    "suppressed",
    "suppressing-fire-pinned",
    "surprise-assault-target",
    "surveilled",
    "survey-augur-target",
    "symbiotic-target",
    "symbiotic-targeting-target",
    "symphony-of-pain-target",
    "tethered",
    "the-eternal-dance-target",
    "throne-tyrannicus",
    "titanic-duel-target",
    "transport-support-target",
    "trapped",
    "triangulated",
    "trivarg-yp-spent",
    "unbridled-ardour-slayer",
    "unhideable",
    "unmasked",
    "unravelling",
    "vendetta-target",
    "vengeful-dead",
    "victim",
    "virulent-blessing-target",
    "warded",
    "warlord",
    "whispering-web",
    "wholly-within-flow-of-magic",
    "winning-the-wager",
    "withering-hail-target",
    "wobbled",
    "worthy-foes",
    "wracked-with-agonies",
    "yp-spent-this-use",
    "zapped",
];

/// Whether `id` is a registered designation.
pub fn is_designation_id(id: &str) -> bool {
    DESIGNATION_IDS.binary_search(&id).is_ok()
}

/// Designations only list building sets (the model chosen as Warlord); a rule may test them, never apply them.
pub const LIST_BUILDING_DESIGNATIONS: &[&str] = &["warlord"];

/// Whether `id` is a list-building designation.
pub fn is_list_building_designation(id: &str) -> bool {
    LIST_BUILDING_DESIGNATIONS.contains(&id)
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
        "blessed" => (Some("blessed"), None),
        "bondsman-affected" => (Some("Bondsman-affected"), None),
        "detected" => (Some("detected"), None),
        "readied" => (Some("readied"), None),
        "disrupted" => (Some("disrupted"), None),
        "enfeebled" => (Some("enfeebled"), None),
        "ensnared" => (Some("ensnared"), None),
        "grav-pinned" => (Some("grav-pinned"), None),
        "grounded" => (Some("grounded"), None),
        "infested-with-snotlings" => (Some("infested with Snotlings"), None),
        "malevolent" => (Some("malevolent"), None),
        "mutated" => (Some("mutated"), None),
        "nulled" => (Some("nulled"), None),
        "overlapping-fire" => (Some("caught in overlapping fire"), None),
        "poisoned" => (Some("poisoned"), None),
        "riven" => (Some("riven"), None),
        "rotted" => (Some("rotted"), None),
        "defence-stance" => (Some("in defence stance"), None),
        "scanned" => (Some("scanned"), None),
        "scattered" => (Some("scattered"), None),
        "shaken" => (Some("shaken"), None),
        "slowed" => (Some("slowed"), None),
        "smashed" => (Some("smashed"), None),
        "snared" => (Some("snared"), None),
        "struck-by-arcing-energies" => (Some("struck by arcing energies"), None),
        "struck-by-concussive-wave" => (Some("struck by concussive wave"), None),
        "struck-by-explosive-debris" => (Some("struck by explosive debris"), None),
        "struck-by-spores" => (Some("struck by spores"), None),
        "stunned" => (Some("stunned"), None),
        "wobbled" => (Some("wobbled"), None),
        "wracked-with-agonies" => (Some("wracked with agonies"), None),
        "zapped" => (Some("zapped"), None),
        "yp-spent-this-use" => (Some("YP-spent this use"), None),
        "unravelling" => (Some("unravelling"), None),
        "prey" => (None, Some("prey")),
        "slayers-oath" => (None, Some("Slayer's Oath")),
        "vendetta-target" => (None, Some("Vendetta target")),
        "victim" => (None, Some("victim")),
        "sabotaged" => (Some("Sabotaged"), None),
        "warded" => (Some("Warded"), None),
        "corrupted" => (Some("Corrupted"), None),
        "warlord" => (Some("the Warlord"), None),
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
        // The Warlord is the list-building designation: a definite noun, singular in every form.
        assert!(is_designation_id("warlord") && is_list_building_designation("warlord"));
        assert_eq!(
            designation_label("warlord", false).as_deref(),
            Some("the Warlord")
        );
        assert!(!is_list_building_designation("spotted"));
        assert_eq!(designation_id(" RILED  UP "), "riled-up");
        assert_eq!(designation_id("Oath_of Moment"), "oath-of-moment");
    }
}
