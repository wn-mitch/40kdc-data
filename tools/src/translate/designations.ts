/**
 * The designation registry (D5): every tag an effect may apply, as a kebab-case id, and the
 * rules' own term for the ids the rules print. Integrity rejects a tag outside the registry;
 * the describers print the label ("the unit is Spotted") and fall back to "marked as <id>"
 * for internal tags the rules never name. Pinned across the ports with the describers.
 */

/** Every designation id records may apply or test. Add an id here before a record uses it. */
export const DESIGNATION_IDS: ReadonlySet<string> = new Set([
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
]);

/** The rules' term for a designation: an adjective ("Spotted") or a noun ("Observer" -> "an Observer", "Observers"). */
const DESIGNATION_TERMS: Readonly<Record<string, { adjective?: string; noun?: string }>> = {
  afflicted: { adjective: "Afflicted" },
  spotted: { adjective: "Spotted" },
  guided: { adjective: "Guided" },
  "riled-up": { adjective: "riled up" },
  empowered: { adjective: "Empowered" },
  observer: { noun: "Observer" },
};

/** The printed term for a registered id after "is"/"are" ("Spotted", "an Observer" / "Observers"), else undefined. */
export function designationLabel(id: string, plural = false): string | undefined {
  const term = DESIGNATION_TERMS[id];
  if (term == null) return undefined;
  if (term.adjective != null) return term.adjective;
  const noun = term.noun ?? id;
  return plural ? `${noun}s` : `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** A tag as its registry id: legacy upper-case, spaced spellings fold onto the kebab-case id. */
export function designationId(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s_]+/g, "-");
}
