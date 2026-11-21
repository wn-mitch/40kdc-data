import { test, expect, type Page } from '@playwright/test';

/**
 * Share → Tabletop Simulator: the button posts the list's share token to the
 * TTS worker and shows the returned code, or the failure. The worker is
 * mocked; tts-code.test.ts covers the reply handling in detail.
 */

const TTS_ROUTE = 'https://tts.alpacasoft.dev/yellowscribeArmyCode';

async function openShare(page: Page): Promise<void> {
	await page.goto('/');
	await page.getByRole('button', { name: '+ New list' }).click();
	await page.locator('label', { hasText: 'Faction' }).locator('select').selectOption('adeptus-astartes');
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
}

test('sends the share token and shows the code with instructions', async ({ page }) => {
	let posted = '';
	await page.route(TTS_ROUTE, async (route) => {
		posted = route.request().postData() ?? '';
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ code: 'c0ffee42', skipped: [] }),
		});
	});
	await openShare(page);
	const shareLink = await page.getByRole('dialog').locator('input[readonly]').first().inputValue();

	await page.getByRole('button', { name: 'Send to Tabletop Simulator' }).click();

	await expect(page.getByTestId('tts-code')).toHaveValue('c0ffee42');
	await expect(page.getByText(/enter this code in the Yellow Machine/)).toBeVisible();
	// The body is the same share-v1 token the share link carries.
	expect(posted).toMatch(/^[A-Za-z0-9_-]+$/);
	expect(shareLink.endsWith(`#l=${posted}`)).toBe(true);
});

test('shows the worker refusal and offers a retry', async ({ page }) => {
	await page.route(TTS_ROUTE, (route) =>
		route.fulfill({
			status: 502,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ err: 'Yellowscribe refused the army (HTTP 500)' }),
		}),
	);
	await openShare(page);
	await page.getByRole('button', { name: 'Send to Tabletop Simulator' }).click();

	await expect(page.getByRole('alert')).toContainText('Yellowscribe refused the army');
	await expect(page.getByTestId('tts-code')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Send to Tabletop Simulator' })).toBeEnabled();
});
