import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile layout: below the 1024px breakpoint the three builder panels collapse
 * to a full-width roster with the unit picker and the unit-detail panel in
 * bottom sheets. This spec drives that flow — pick a faction, open the picker
 * sheet to add a unit, then tap the roster row to open the detail sheet — none
 * of which exists on the desktop grid path the other specs cover.
 */

test.use({ viewport: { width: 390, height: 844 } });

const factionSelect = (page: Page) =>
	page.locator('label', { hasText: 'Faction' }).locator('select');

test('mobile: picker + detail open as bottom sheets', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: '+ New list' }).click();
	await factionSelect(page).selectOption('adeptus-astartes');

	// The picker is not inline on mobile — its search box lives in a closed
	// sheet (present in the DOM but not visible) until the add button opens it.
	await expect(page.getByRole('button', { name: /Add unit/ })).toBeVisible();
	await expect(page.getByPlaceholder('Search units or keywords…')).not.toBeVisible();

	await page.getByRole('button', { name: /Add unit/ }).click();
	const picker = page.getByRole('dialog');
	await expect(picker).toBeVisible();
	await picker.getByPlaceholder('Search units or keywords…').fill('Helbrecht');
	await picker.locator('li button', { hasText: 'Helbrecht' }).first().click();

	// Adding closes the picker sheet and the unit lands in the roster underneath.
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByText('Helbrecht').first()).toBeVisible();

	// Tapping the roster row opens the detail sheet for that unit.
	await page.getByText('Helbrecht').first().click();
	const detail = page.getByRole('dialog');
	await expect(detail).toBeVisible();
	await expect(detail.getByText(/Helbrecht/).first()).toBeVisible();
	// Exact: the datacard's ability descriptions also mention "models".
	await expect(detail.getByText('Models', { exact: true })).toBeVisible();

	// The sheet closes on its close button, leaving the roster in place.
	await detail.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByText('Helbrecht').first()).toBeVisible();
});
