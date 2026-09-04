import AxeBuilder from '@axe-core/playwright';
import { test, expect, seedFile, seedFolder, submitUpload, supabaseReady } from './fixtures';

/**
 * The app on a phone.
 *
 * It is sold as a PWA and shipped through Capacitor, and until now CI checked
 * one browser at one size: Desktop Chrome at 1280 wide. Everything the README
 * claims about phones was taken on trust, and the failures a phone produces —
 * a row that overflows sideways, a control under the thumb of another one, a
 * tap that lands on the wrong element — are invisible at that width by
 * construction.
 *
 * Runs as its own Playwright project (`mobile`, Pixel 7) rather than by
 * repeating the whole suite at a second size: the desktop specs already prove
 * the behaviour, and what is worth paying for here is the layout and the touch
 * target, not a second copy of the assertions.
 */
test.describe('On a phone', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  /** Horizontal overflow is the mobile bug that never shows up on a desktop. */
  async function overflow(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
      const scroller = document
        .querySelector('ion-content')
        ?.shadowRoot?.querySelector('.inner-scroll');
      const target = (scroller as HTMLElement) ?? document.documentElement;
      return target.scrollWidth - target.clientWidth;
    });
  }

  test('the dashboard fits the screen, with folders and long file names on it', async ({
    page,
    user,
  }) => {
    await seedFolder(user.id, 'Invoices and receipts 2026');
    await seedFile(user.id, {
      name: 'a-quarterly-report-with-a-name-nobody-would-shorten.pdf',
      size: 2_400_000,
    });

    await page.goto('/dashboard');
    await expect(page.locator('.file-list-item')).toHaveCount(1);

    expect(await overflow(page), 'the dashboard scrolls sideways on a phone').toBeLessThanOrEqual(
      1
    );

    // The controls a phone user needs first, at the size they are given.
    await expect(page.locator('ion-searchbar')).toBeVisible();
    await expect(page.locator('.folder-card').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete /i })).toBeVisible();
  });

  test('a file goes up and opens, driven by taps', async ({ page }) => {
    await submitUpload(page, 'from-a-phone.txt');
    await page.waitForURL(/\/dashboard$/);

    const row = page.locator('.file-list-item', { hasText: 'from-a-phone.txt' });
    await expect(row).toBeVisible();

    // tap(), not click(): the mobile project has touch enabled, and a control
    // that only answers a mouse would pass every desktop test and no phone.
    await row.getByRole('button', { name: /^Open / }).tap();
    await page.waitForURL(/\/file\/[0-9a-f-]+$/);
    await expect(page.locator('ion-title')).toHaveText('from-a-phone.txt');

    expect(await overflow(page), 'the file page scrolls sideways on a phone').toBeLessThanOrEqual(
      1
    );
  });

  test('nothing on the phone layout breaks WCAG A or AA', async ({ page, user }) => {
    await seedFile(user.id, { name: 'contract.pdf' });
    await page.goto('/dashboard');
    await expect(page.locator('.file-list-item')).toHaveCount(1);

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toBe('');
  });
});
