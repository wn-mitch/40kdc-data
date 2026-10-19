/**
 * Prefill for batch 6's new predicate families (`predicate-families.ts`, `predicate-families-2.ts`)
 * and the `event` family's version 7 kinds, split out of `leaf-prefill.ts` per the batch-5-style
 * follow-up (that file has little headroom left). Same rule as the rest of `leaf-prefill.ts`:
 * nothing is chosen by default, only read when the wording says it outright.
 */

const SUBJECT_FAMILIES = new Set([
  "unit-owner", "unit-has-ability", "same-unit", "model-count", "wounds-state",
  "in-region", "visible", "guided", "moved-over", "designated-filter",
]);
const NEGATABLE_FAMILIES = new Set([...SUBJECT_FAMILIES, "rule-active", "battle-size", "attack-filter"]);

/** The subject a batch-6 predicate names, in its own (fuller) unit-ref vocabulary. */
function subjectRefFromSource(text: string): string | undefined {
  if (/\btargets?\b|\bthe target\b/iu.test(text)) return "defender";
  if (/\bthis model\b|\bthe bearer\b/iu.test(text)) return "this-model";
  if (/\bthis unit\b|\byour unit\b/iu.test(text)) return "this-unit";
  return undefined;
}

const MARK_TAGS: Array<[RegExp, string]> = [
  [/oath of moment/iu, "oath-of-moment-target"], [/afflicted/iu, "afflicted"], [/spotted/iu, "spotted"], [/hidden/iu, "hidden"], [/\bmarked\b/iu, "marked"],
];

const WINDOW_PHASE_WORDS: Array<[RegExp, string]> = [
  [/\bcommand phase\b/iu, "command"], [/\bmovement phase\b/iu, "movement"], [/\bshooting phase\b/iu, "shooting"],
  [/\bcharge phase\b/iu, "charge"], [/\bfight phase\b/iu, "fight"],
];

function ownerFromSource(text: string): string | undefined {
  if (/\benemy\b/iu.test(text)) return "enemy";
  if (/\bfriendly\b/iu.test(text)) return "friendly";
  return undefined;
}

/** What one batch-6 predicate leaf can read outright from its own source wording. */
export function predicateConditionPrefill(familyId: string, exactText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (SUBJECT_FAMILIES.has(familyId)) {
    const subject = subjectRefFromSource(exactText);
    if (subject) result.subject = subject;
  }
  if (NEGATABLE_FAMILIES.has(familyId) && /\bnot\b|\bcannot\b|\bcan't\b|\bno longer\b/iu.test(exactText)) result.negated = true;
  switch (familyId) {
    case "unit-owner": {
      const owner = ownerFromSource(exactText);
      if (owner) result.owner = owner;
      break;
    }
    case "model-count": {
      const atLeast = /\bat least (\d+)\b|\b(\d+)\+/iu.exec(exactText);
      if (atLeast) result.min = Number(atLeast[1] ?? atLeast[2]);
      const atMost = /\bat most (\d+)\b|\bno more than (\d+)\b/iu.exec(exactText);
      if (atMost) result.max = Number(atMost[1] ?? atMost[2]);
      break;
    }
    case "wounds-state": {
      const remaining = /\b(\d+) or fewer wounds remaining\b/iu.exec(exactText);
      if (remaining) {
        result.kind = "remaining-at-most";
        result.value = Number(remaining[1]);
      } else if (/\bdamaged\b/iu.test(exactText)) result.kind = "damaged";
      else if (/\blost (?:one or more )?wounds?\b/iu.test(exactText)) result.kind = "lost";
      break;
    }
    case "in-region": {
      result.region_kind = "territory";
      if (/\byour deployment zone\b/iu.test(exactText)) result.territory = "your-deployment-zone";
      else if (/\benemy deployment zone\b/iu.test(exactText)) result.territory = "enemy-deployment-zone";
      else if (/\bno.?man.?s.?land\b/iu.test(exactText)) result.territory = "no-mans-land";
      else if (/\byour territory\b/iu.test(exactText)) result.territory = "your-territory";
      else if (/\benemy territory\b/iu.test(exactText)) result.territory = "enemy-territory";
      else delete result.region_kind;
      if (/\bwholly\b/iu.test(exactText)) result.wholly = true;
      break;
    }
    case "controls-objective": {
      result.mode = /\bmore objectives than\b/iu.test(exactText) ? "more-than-opponent" : "count";
      const by = ownerFromSource(exactText.replace(/\bfriendly\b/iu, "")) ?? (/\byou control\b/iu.test(exactText) ? "friendly" : /\bopponent controls?\b/iu.test(exactText) ? "enemy" : undefined);
      if (result.mode === "count" && by) result.by = by;
      break;
    }
    case "visible":
      if (/\bfully visible\b/iu.test(exactText)) result.fully = true;
      break;
    case "designated-filter": {
      const mark = MARK_TAGS.find(([pattern]) => pattern.test(exactText))?.[1];
      if (mark) result.tag = mark;
      break;
    }
    case "battle-size": {
      if (/\bincursion\b/iu.test(exactText)) result.size = "incursion";
      else if (/\bstrike force\b/iu.test(exactText)) result.size = "strike-force";
      else if (/\bonslaught\b/iu.test(exactText)) result.size = "onslaught";
      break;
    }
    case "battle-round": {
      const round = /\bbattle round (\d)\b/iu.exec(exactText)?.[1];
      if (round) {
        result.min = Number(round);
        result.max = Number(round);
      } else if (/\bfirst battle round\b/iu.test(exactText)) {
        result.min = 1;
        result.max = 1;
      }
      break;
    }
    case "moved-over":
      if (/\bthis model\b/iu.test(exactText)) result.by = "this-model";
      else if (/\bthis unit\b/iu.test(exactText)) result.by = "this-unit";
      break;
    case "phase-window": {
      const phase = WINDOW_PHASE_WORDS.find(([pattern]) => pattern.test(exactText))?.[1];
      if (phase) result.phase = phase;
      if (/your opponent's/iu.test(exactText)) result.turn = "opponent";
      else if (/\byour\b/iu.test(exactText)) result.turn = "your";
      break;
    }
    case "attack-filter": {
      if (/\bmelee\b/iu.test(exactText)) result.attack_type = "melee";
      else if (/\branged\b/iu.test(exactText)) result.attack_type = "ranged";
      else if (/\bpsychic\b/iu.test(exactText)) result.attack_type = "psychic";
      break;
    }
    default:
      break;
  }
  return result;
}

const USED_ACTIVITY_WORDS: Array<[RegExp, string]> = [
  [/\bstratagem\b/iu, "stratagem"], [/\bmanoeuvre\b/iu, "manoeuvre"], [/\border\b/iu, "order"], [/\britual\b/iu, "ritual"],
  [/\bdark pact\b/iu, "dark-pact"], [/\bact of faith\b/iu, "act-of-faith"], [/\bdoctrine\b/iu, "doctrine"], [/\bability\b/iu, "ability"],
];

/** Version-7 `event` kinds `leaf-prefill.ts`'s own `eventFromSource` does not already read. */
export function eventV7Prefill(exactText: string): Record<string, unknown> {
  if (/\bstart of the battle\b/iu.test(exactText)) return { kind: "battle-started" };
  if (/\bafter deployment\b/iu.test(exactText)) return { kind: "deployment-ended" };
  if (/\bend of the battle round\b/iu.test(exactText)) return { kind: "round-ended" };
  if (/\bend of (?:the |your |your opponent's )?turn\b/iu.test(exactText)) {
    const turn = /your opponent's turn/iu.test(exactText) ? "opponent" : /\byour turn\b/iu.test(exactText) ? "your" : undefined;
    return turn ? { kind: "turn-ended", turn } : { kind: "turn-ended" };
  }
  if (/\bdisembarks?\b/iu.test(exactText)) return { kind: "disembarked" };
  if (/damage is allocated/iu.test(exactText)) return { kind: "damage-allocated" };
  const activity = USED_ACTIVITY_WORDS.find(([pattern]) => pattern.test(exactText))?.[1];
  if (activity && /\buses?\b/iu.test(exactText)) return { kind: "used", activity };
  return {};
}
