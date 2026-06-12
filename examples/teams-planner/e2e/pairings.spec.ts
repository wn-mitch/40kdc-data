import { test, expect, type Page } from "@playwright/test";

/**
 * Pairings-simulator walkthrough on the card mat: a stored 5-player plan
 * (distinct factions, each with one army granting a distinct disposition)
 * goes through the full official flow — Initial Skirmish then Main
 * Engagement — by clicking cards into slots, and lands on a 5-table summary.
 * The engine is vitest-covered; this exercises the real UI: tab switch,
 * card-based setup, click-to-place picks, simultaneous reveals, layout
 * declaration, and the tables rail.
 */

/** A plan whose 5 players cover all five dispositions via real detachments. */
const PLAN = {
  teamName: "E2E Crew",
  size: 5,
  players: [
    ["p1", "Ash", "orks", "green-tide"], // take-and-hold
    ["p2", "Blair", "aeldari", "aspect-host"], // disruption
    ["p3", "Cam", "necrons", "annihilation-legion"], // purge-the-foe
    ["p4", "Drew", "tau-empire", "kauyon"], // priority-assets
    ["p5", "Em", "chaos-knights", "houndpack-lance"], // reconnaissance
  ].map(([id, name, factionId, detachmentId]) => ({
    id,
    name,
    factionIds: [factionId],
    armies: [{ id: `${id}-a`, name: "Main", factionId, detachmentIds: [detachmentId] }],
    preferences: [],
    locked: {},
  })),
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((plan) => {
    localStorage.setItem("teams-planner.v2", JSON.stringify(plan));
  }, PLAN);
});

const yourPool = (page: Page) => page.getByRole("listbox", { name: "Your pool" });

/** Drive one skirmish/main module's ladder by clicking pool cards into slots. */
async function playModule(page: Page, expectedTables: number) {
  // 1. defender: click the first pool card — it flies to the defender slot.
  await expect(page.getByText("Secretly select one member to be your Defender.")).toBeVisible();
  await yourPool(page).getByRole("button").first().click();
  await page.getByRole("button", { name: "Lock in defender" }).click();
  // 2. reveal
  await expect(page.getByText("Defenders revealed.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // 3. two attackers (await the pool shrinking so the second click can't hit
  //    the first card's outgoing crossfade ghost)
  await expect(page.getByText(/to be Attackers against/)).toBeVisible();
  const before = await yourPool(page).getByRole("button").count();
  await yourPool(page).getByRole("button").first().click();
  await expect(yourPool(page).getByRole("button")).toHaveCount(before - 1);
  await yourPool(page).getByRole("button").first().click();
  await expect(yourPool(page).getByRole("button")).toHaveCount(before - 2);
  await page.getByRole("button", { name: "Lock in attackers" }).click();
  // 4. reveal
  await expect(page.getByText("Attackers revealed.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // 5. accept one opposing attacker (click their now-face-up attacker card)
  await expect(page.getByText(/will play against — click one of their attackers/)).toBeVisible();
  await page
    .getByRole("group", { name: "Their attacker 1 slot" })
    .getByRole("button")
    .click();
  // 6. reveal
  await expect(page.getByText("Match-ups decided.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // 7. declare layout (button text = letter + thumb caption, so prefix-match)
  await expect(page.getByText(/declares the layout/)).toBeVisible();
  await page.getByRole("button", { name: /^B\b/ }).click();
  // module results land in the tables rail
  await expect(page.getByText("Tables set.")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(expectedTables);
}

test("full 5-player pairing round on the mat: skirmish + main → 5 tables", async ({ page }) => {
  await page.goto("/");

  // The plan view shows the seeded roster; switch to the practice tab.
  await expect(page.getByText("All five dispositions covered")).toBeVisible();
  await page.getByRole("tab", { name: "Pairings practice" }).click();
  await expect(page).toHaveURL(/#sim$/);

  // Card setup: all 5 players dealt onto the active roster with FD pickers,
  // CPU dealt as cards.
  await expect(page.getByText("5 selected")).toBeVisible();
  const roster = page.getByRole("list", { name: "Playing this round" });
  await expect(roster.getByRole("button")).toHaveCount(5);
  await expect(roster.getByRole("combobox")).toHaveCount(5);
  await expect(page.getByText("⚠")).toHaveCount(0);

  await page.getByRole("button", { name: "Start pairings" }).click();

  // The mat: pools top and bottom, color-coded slots between.
  await expect(page.getByText("1. Initial Skirmish")).toBeVisible();
  await expect(page.getByText("2. Main Engagement")).toBeVisible();
  await expect(page.getByText("refused/champion tables play Layout A")).toBeVisible();
  await expect(page.getByRole("group", { name: "Your defender slot" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Their defender slot" })).toBeVisible();
  await expect(yourPool(page).getByRole("button")).toHaveCount(5);

  await playModule(page, 2); // skirmish → 2 tables
  await page.getByRole("button", { name: "Next module" }).click();
  await playModule(page, 5); // main → +2 defender tables + refused (rail accumulates)
  await page.getByRole("button", { name: "Finish" }).click();

  // Summary: every player paired exactly once → 5 tables.
  await expect(page.getByText("All pairings — round 1")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(5);
  const refused = page.locator("article", { hasText: "Refused attackers" });
  await expect(refused).toHaveCount(1);
  await expect(refused.getByText("A", { exact: true })).toBeVisible();
  await expect(page.locator("article").first().getByText("You score")).toBeVisible();
  await expect(page.locator("article").first().getByText("They score")).toBeVisible();
});

test("staged cards can be taken back; drag-and-drop places into a slot", async ({ page }) => {
  await page.goto("/#sim");
  await page.getByRole("button", { name: "Start pairings" }).click();

  // Click Ash into the defender slot, then click the staged card to undo.
  await yourPool(page).getByRole("button", { name: /Ash/ }).click();
  await expect(yourPool(page).getByRole("button")).toHaveCount(4);
  const defenderSlot = page.getByRole("group", { name: "Your defender slot" });
  await expect(page.getByRole("button", { name: "Lock in defender" })).toBeEnabled();
  await defenderSlot.getByRole("button", { name: /take back/ }).click();
  await expect(yourPool(page).getByRole("button")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Lock in defender" })).toBeDisabled();

  // Drag Blair onto the defender slot instead. HTML5 DnD needs synthesized
  // DataTransfer events (Playwright's mouse-path dragTo doesn't carry one).
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await yourPool(page)
    .getByRole("button", { name: /Blair/ })
    .dispatchEvent("dragstart", { dataTransfer });
  await defenderSlot.dispatchEvent("dragover", { dataTransfer });
  await defenderSlot.dispatchEvent("drop", { dataTransfer });
  await expect(yourPool(page).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Lock in defender" })).toBeEnabled();
});

test("reroll changes the opposing team; restart returns to setup", async ({ page }) => {
  await page.goto("/#sim");
  const cpuSection = page.locator("section", { hasText: "Opposing team" });
  await expect(cpuSection.getByRole("img")).toHaveCount(5);
  const before = await cpuSection
    .getByRole("img")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    await page.getByRole("button", { name: "↻ Reroll" }).click();
    const after = await cpuSection
      .getByRole("img")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    changed = JSON.stringify(after) !== JSON.stringify(before);
  }
  expect(changed).toBe(true);

  await page.getByRole("button", { name: "Start pairings" }).click();
  await expect(page.getByText("1. Initial Skirmish")).toBeVisible();
  await page.getByRole("button", { name: "Abandon and restart" }).click();
  await expect(page.getByRole("button", { name: "Start pairings" })).toBeVisible();
});

test("setup bench: removing a player moves their card to the bench", async ({ page }) => {
  await page.goto("/#sim");
  const roster = page.getByRole("list", { name: "Playing this round" });
  await expect(roster.getByRole("button")).toHaveCount(5);
  // Click Em off the roster; a bench section appears with her card.
  await roster.getByRole("button", { name: /Em/ }).click();
  await expect(roster.getByRole("button")).toHaveCount(4);
  const bench = page.getByRole("list", { name: "Bench" });
  await expect(bench.getByRole("button", { name: /Em/ })).toBeVisible();
  await expect(page.getByText("4 selected")).toBeVisible();
  // And back on.
  await bench.getByRole("button", { name: /Em/ }).click();
  await expect(roster.getByRole("button")).toHaveCount(5);
});

test("team size widens to 3-8 and the plan round-trips through a share link", async ({ page }) => {
  await page.goto("/");
  const size = page.locator("select").first();
  await expect(size.locator("option")).toHaveCount(6);
  await size.selectOption("3");
  await expect(size).toHaveValue("3");
  await expect(page.getByText("of 3 slots have a faction")).toBeVisible();

  await page.getByRole("button", { name: "Copy share link" }).click();
  await expect(page.locator('[role="status"]')).toBeVisible();
});
