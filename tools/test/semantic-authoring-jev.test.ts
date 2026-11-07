import { describe, expect, it } from "vitest";
import { askChoiceRanked, JevBudget, JevPermanentError, type JevClient } from "../src/semantic-authoring/jev-core.js";

describe("Jev request failures", () => {
  const failing = (status: number) => {
    let calls = 0;
    const client = { async systemOne() { calls += 1; throw Object.assign(new Error(`HTTP ${status}`), { status }); } } satisfies JevClient;
    return { client, calls: () => calls };
  };
  const ask = (client: JevClient) => askChoiceRanked(client, 1000, new JevBudget(1), "span:1", "family", { phrase: "x" }, "Which?", { a: "A", b: "B" });

  it("stops the run on an error no retry can fix, such as no credits", async () => {
    const { client, calls } = failing(402);
    await expect(ask(client)).rejects.toBeInstanceOf(JevPermanentError);
    expect(calls()).toBe(1);
  });

  it("keeps a rate limit transient: retried, then unanswered", async () => {
    const { client, calls } = failing(429);
    await expect(ask(client)).resolves.toBeNull();
    expect(calls()).toBe(3);
  });
});
