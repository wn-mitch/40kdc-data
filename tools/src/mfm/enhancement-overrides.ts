/**
 * Enhancements whose dump eligibility rows disagree with the dump's own rules text for the same
 * record. Core follows the rules text there, one entry per enhancement, keyed by the MFM
 * enhancement id. Each entry replaces only the field it names; every other field still comes
 * from the dump rows.
 */
export interface EnhancementEligibilityOverride {
  /** Replaces the keyword groups (AND within a group, OR across groups). */
  keyword_restriction_groups?: string[][];
  /** Replaces the excluded keywords. */
  exclusion_keywords?: string[];
}

export const RULES_TEXT_ELIGIBILITY: Readonly<Record<string, EnhancementEligibilityOverride>> = {
  // Kill Kommanda: the rows add a bare {Big Mek} group, which admits the Big Mek Dakkarig (a WALKER);
  // the card prints "Big Mek/Warboss Infantry model only".
  "2de8b6d3-68fc-4c7b-a499-0bff89ab1e06": { keyword_restriction_groups: [["Big Mek", "Infantry"], ["Infantry", "Warboss"]] },
  // Smoky Gubbinz (Upgrade): the rows have no excluded keyword; the card prints "excluding Aircraft units".
  "94c08bd8-7e2a-4ffc-8377-1243a0d091fc": { exclusion_keywords: ["Aircraft"] },
};
