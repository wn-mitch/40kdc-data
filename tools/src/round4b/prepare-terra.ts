import { join } from "node:path";
import { hashFile, hashJson } from "./hash.js";
import { readJson, requireAbsent, writeJson } from "./manifest.js";
import { EVALUATOR_ROOT, ROUND4B_ROOT } from "./paths.js";
import type { EscalationTicketArtifact } from "./routing.js";

const TICKETS_PATH = join(EVALUATOR_ROOT, "round4b-terra-escalation-tickets.json");
const OUTPUT_PATH = join(ROUND4B_ROOT, "terra", "round4b-terra-batch-input.json");
const SAMPLE_SIZE = 30;

interface TerraInputTicket {
  ticket_id: string;
  scope: "local" | "ability";
  ability_id: string;
  question_family: string;
  source_excerpt: string;
  wider_context: string;
  candidate_answers: string[];
  decomposer_outputs: Array<{ model: string; answers: string[] }>;
  reason: string;
}

function stratifiedSample(artifact: EscalationTicketArtifact): TerraInputTicket[] {
  const groups = new Map<string, typeof artifact.tickets>();
  for (const ticket of artifact.tickets.filter((candidate) => candidate.target === "Terra")) {
    const group = groups.get(ticket.question_family) ?? [];
    group.push(ticket);
    groups.set(ticket.question_family, group);
  }
  for (const group of groups.values()) group.sort((left, right) => left.id.localeCompare(right.id));
  const families = [...groups.keys()].sort();
  const selected: typeof artifact.tickets = [];
  for (let round = 0; selected.length < SAMPLE_SIZE; round += 1) {
    let added = false;
    for (const family of families) {
      const ticket = groups.get(family)?.[round];
      if (!ticket) continue;
      selected.push(ticket);
      added = true;
      if (selected.length === SAMPLE_SIZE) break;
    }
    if (!added) break;
  }
  return selected.map((ticket) => ({
    ticket_id: ticket.id,
    scope: ticket.scope,
    ability_id: ticket.identity,
    question_family: ticket.question_family,
    source_excerpt: ticket.source_excerpt,
    wider_context: ticket.wider_context,
    candidate_answers: ticket.candidate_answers,
    decomposer_outputs: ticket.decomposer_outputs,
    reason: ticket.reason,
  }));
}

function main(): void {
  requireAbsent(OUTPUT_PATH, "Round 4B Terra batch input");
  const artifact = readJson<EscalationTicketArtifact>(TICKETS_PATH);
  const tickets = stratifiedSample(artifact);
  if (tickets.length !== SAMPLE_SIZE) throw new Error(`Round 4B Terra queue sample requires ${SAMPLE_SIZE} tickets; received ${tickets.length}`);
  const payload = {
    run_id: artifact.run_id,
    contract_version: 1,
    task: "Resolve each escalation ticket independently from its source context and candidate decompositions. Do not reparse unrelated abilities. Return one answer per ticket. Abstain when the source does not determine the answer.",
    batching: { tickets: tickets.length, intended_invocations: 1, semantic_isolation: "Each answer is keyed only by its ticket_id." },
    response_schema: {
      answers: [{ ticket_id: "string", selected_answer: "string|null", abstained: "boolean", explanation: "string", confidence: "number 0..1" }],
    },
    ticket_source_hash: hashFile(TICKETS_PATH),
    tickets,
  };
  writeJson(OUTPUT_PATH, { ...payload, payload_hash: hashJson(payload) });
  process.stdout.write(`${artifact.run_id}: prepared ${tickets.length} Terra tickets in one batch\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
