import { test, expect, type Page } from '@playwright/test';

/**
 * Datacard weapon rendering: a weapon whose profiles share a name (e.g. the
 * Adeptus Custodes verutum-lance, whose ranged and melee profiles are both
 * named "Verutum Lance") once crashed the live datacard with Svelte's
 * each_key_duplicate — the weapon-row keyed each keyed on the display name.
 * Adding such a unit must render its datacard without any runtime error.
 */

const factionSelect = (page: Page) =>
	page.locator('label', { hasText: 'Faction' }).locator('select');

test('adding a unit with same-named weapon profiles renders without each_key_duplicate', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});

	await page.goto('/');
	await page.getByRole('button', { name: '+ New list' }).click();
	await page.getByPlaceholder('My list').fill('Custodes datacard');
	await factionSelect(page).selectOption('adeptus-custodes');

	await page.getByPlaceholder('Search units or keywords…').fill('Verutum');
	await page.locator('li button', { hasText: 'Venatari with Verutum Lances' }).first().click();

	// The unit lands in the roster and its live datacard renders in the detail
	// panel — this is where the crash used to fire.
	await expect(page.getByText('Venatari with Verutum Lances').first()).toBeVisible();
	await expect(page.getByText('Ranged', { exact: false }).first()).toBeVisible();

	expect(
		errors.filter((e) => /each_key_duplicate/.test(e)),
		`unexpected each_key_duplicate error(s):\n${errors.join('\n')}`
	).toHaveLength(0);
});
