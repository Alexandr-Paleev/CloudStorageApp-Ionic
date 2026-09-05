import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { anonymousPage, test, expect, seedFile, seedFolder, supabaseReady } from './fixtures';

/**
 * Accessibility, measured on the rendered DOM.
 *
 * `eslint-plugin-jsx-a11y` reads the source and Lighthouse audits the built
 * shell — which, behind a login form, is an empty page and two static legal
 * documents. Everything the app actually is has been checked by neither: the
 * dashboard, the upload queue, the file view and the plans page only exist
 * once React has run and a session exists.
 *
 * Scoped to WCAG 2.1 A and AA. axe also ships best-practice rules, and mixing
 * them in makes a failure ambiguous — "this breaks a standard" and "this is
 * not how we would have written it" are different conversations.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG).analyze();
}

/** Puts the rule id, the count and one example selector in the failure. */
function summarise(violations: Awaited<ReturnType<typeof scan>>['violations']): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}, ${violation.nodes.length}×): ${violation.help}\n` +
        `    ${violation.nodes[0]?.target.join(' ')}`
    )
    .join('\n');
}

test.describe('Accessibility', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  /* A second context with no session: the `user` fixture signs `page` in
     automatically, and a signed-in visitor never sees this page at all. */
  test('the login page, before anyone has signed in', async ({ browser }) => {
    const { page, close } = await anonymousPage(browser);
    try {
      await page.goto('/login');
      /* The native input, not the `ion-input` host. Ionic 9 sets component
         props as properties rather than attributes, so `ion-input[type=...]`
         matches nothing while `host.type` is still 'email' — and the thing a
         person actually types into is this one anyway. */
      await expect(page.locator('input[type="email"]')).toBeVisible();

      const { violations } = await scan(page);
      expect(summarise(violations)).toBe('');
    } finally {
      await close();
    }
  });

  test('the dashboard, with folders and files on it', async ({ page, user }) => {
    await seedFolder(user.id, 'Invoices');
    await seedFile(user.id, { name: 'quarterly-report.pdf' });
    await seedFile(user.id, { name: 'diagram.png', type: 'image/png' });

    await page.goto('/dashboard');
    await expect(page.locator('.file-list-item')).toHaveCount(2);

    const { violations } = await scan(page);
    expect(summarise(violations)).toBe('');
  });

  test('the upload page, with files queued and a provider to pick', async ({ page }) => {
    await page.goto('/upload');
    await expect(page.getByTestId('dropzone')).toBeVisible();

    await page.setInputFiles('#file-input', [
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('queued') },
      { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    ]);
    await expect(page.getByTestId('upload-queue')).toBeVisible();

    const { violations } = await scan(page);
    expect(summarise(violations)).toBe('');
  });

  test('the file view, where sharing and renaming live', async ({ page, user }) => {
    await seedFile(user.id, { name: 'contract.pdf' });

    await page.goto('/dashboard');
    await page.locator('.file-list-item', { hasText: 'contract.pdf' }).click();
    await page.waitForURL(/\/file\/[0-9a-f-]+$/);
    await expect(page.locator('ion-title')).toHaveText('contract.pdf');

    const { violations } = await scan(page);
    expect(summarise(violations)).toBe('');
  });

  test('the plans page, which is where money is asked for', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('ion-title')).toBeVisible();

    const { violations } = await scan(page);
    expect(summarise(violations)).toBe('');
  });
});
