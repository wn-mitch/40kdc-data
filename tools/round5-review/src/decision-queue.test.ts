import { describe, expect, it } from "vitest";

import { DecisionQueue, type Send } from "./decision-queue";

/** A server stand-in: replies in call order, failing any path listed in `failing`. */
function server(failing: Set<string> = new Set()) {
  const calls: string[] = [];
  let open = 0;
  let overlapped = false;
  const send: Send = async (path) => {
    calls.push(path);
    open += 1;
    if (open > 1) overlapped = true;
    await new Promise((resolve) => setTimeout(resolve, 1));
    open -= 1;
    if (failing.has(path)) throw new Error("409: that wording already has another meaning");
    return { batch_id: `batch-${path}` };
  };
  return { send, calls, overlapped: () => overlapped };
}

const item = (key: string, onDone?: (result: unknown) => void) => ({ key, label: key, path: key, body: {}, onDone });

describe("decision queue", () => {
  it("sends decisions one at a time, in the order they were made, and reports each batch", async () => {
    const fake = server();
    const batches: string[] = [];
    let drained = 0;
    const queue = new DecisionQueue(fake.send, { onBatch: (id) => batches.push(id), onDrained: () => { drained += 1; } });
    for (const key of ["a", "b", "c"]) queue.enqueue(item(key));
    await queue.idle();
    expect(fake.calls).toEqual(["a", "b", "c"]);
    expect(fake.overlapped()).toBe(false);
    expect(batches).toEqual(["batch-a", "batch-b", "batch-c"]);
    expect(drained).toBe(1);
    expect(queue.snapshot()).toEqual([]);
  });

  it("keeps a failed decision with its reason and carries on with the rest", async () => {
    const fake = server(new Set(["b"]));
    const done: string[] = [];
    const queue = new DecisionQueue(fake.send);
    for (const key of ["a", "b", "c"]) queue.enqueue(item(key, () => done.push(key)));
    await queue.idle();
    expect(done).toEqual(["a", "c"]);
    expect(queue.snapshot()).toMatchObject([{ key: "b", status: "failed", error: expect.stringMatching(/^409/u) }]);
    // A failed item is not a pending write, so it does not hold undo back.
    expect(queue.active).toBe(false);
  });

  it("ignores a second decision for a key that is still waiting", async () => {
    const fake = server();
    const queue = new DecisionQueue(fake.send);
    expect(queue.enqueue(item("a"))).toBe(true);
    expect(queue.enqueue(item("a"))).toBe(false);
    expect(queue.status("a")).toBe("running");
    await queue.idle();
    expect(fake.calls).toEqual(["a"]);
  });

  it("runs decisions made while it is working, and drains once at the end", async () => {
    const fake = server();
    let drained = 0;
    const queue = new DecisionQueue(fake.send, { onDrained: () => { drained += 1; } });
    queue.enqueue(item("a", () => queue.enqueue(item("late"))));
    queue.enqueue(item("b"));
    await queue.idle();
    expect(fake.calls).toEqual(["a", "b", "late"]);
    expect(drained).toBe(1);
  });

  it("retries only the failed decision, behind anything queued after it", async () => {
    const failing = new Set(["b"]);
    const fake = server(failing);
    const queue = new DecisionQueue(fake.send);
    queue.enqueue(item("a"));
    queue.enqueue(item("b"));
    await queue.idle();
    failing.clear();
    queue.enqueue(item("c"));
    queue.retry("b");
    queue.retry("a"); // not failed: nothing to retry
    await queue.idle();
    expect(fake.calls).toEqual(["a", "b", "c", "b"]);
    expect(queue.snapshot()).toEqual([]);
  });

  it("replaces a failed decision when the same key is decided again, and drops on request", async () => {
    const fake = server(new Set(["a"]));
    const queue = new DecisionQueue(fake.send);
    queue.enqueue(item("a"));
    await queue.idle();
    expect(queue.enqueue({ ...item("a"), path: "a2" })).toBe(true);
    await queue.idle();
    expect(fake.calls).toEqual(["a", "a2"]);
    queue.enqueue(item("a"));
    await queue.idle();
    queue.drop("a");
    expect(queue.snapshot()).toEqual([]);
  });
});
