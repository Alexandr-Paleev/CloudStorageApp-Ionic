import { test, expect, supabaseReady } from './fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * A large file, uploaded in parts, paused, and finished in another session.
 *
 * R2 is stubbed rather than real, and that is the whole design of this spec.
 * Every other e2e test here talks to live services on purpose; this one cannot,
 * because the CI environment has no R2 credentials and a test that skips itself
 * proves nothing. What is worth testing anyway is the part that is ours: the
 * state machine that decides which parts still need sending, what survives a
 * reload, and what the page offers afterwards.
 *
 * What the stub therefore does not prove: that R2 accepts these signatures,
 * that the bucket's CORS policy exposes the ETag header, or that a real
 * completion reassembles the object. Those need a bucket, and the README says
 * what to set up before trusting them.
 *
 * The part URLs are same-origin (`/__r2-part/…`) so the browser never runs a
 * preflight against a host that does not exist. Against a real bucket they are
 * cross-origin, which is exactly what the ExposeHeaders rule in the README is
 * about.
 */

/** 20 MiB — three parts at the 8 MiB part size, and over the 16 MiB threshold. */
const FILE_SIZE = 20 * 1024 * 1024;
const PART_COUNT = 3;

interface StubOptions {
  /** Milliseconds to hold each part's response, by part number. */
  delays?: Record<number, number>;
  /** Part numbers that fail once with a 500 before succeeding. */
  failOnce?: number[];
}

interface StubCalls {
  parts: number[];
  completed: { partNumber: number; etag: string }[][];
  aborted: number;
  signed: number[][];
}

/**
 * Answers every call the upload makes, and records what it was asked.
 *
 * The key is fixed rather than random: a resumed upload has to address the same
 * object, and asserting on a constant is how a regression that re-creates the
 * upload becomes visible.
 */
async function stubR2(page: Page, options: StubOptions = {}): Promise<StubCalls> {
  const calls: StubCalls = { parts: [], completed: [], aborted: 0, signed: [] };
  const failed = new Set<number>();
  const key = 'users/e2e/1700000000_large.bin';

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/r2/multipart-create', (route) =>
    json(route, { key, uploadId: 'e2e-upload-1' }, 201)
  );

  await page.route('**/api/r2/multipart-sign', (route) => {
    const { partNumbers } = route.request().postDataJSON() as { partNumbers: number[] };
    calls.signed.push(partNumbers);
    return json(route, {
      urls: partNumbers.map((partNumber) => ({
        partNumber,
        url: `/__r2-part/${partNumber}`,
      })),
    });
  });

  await page.route('**/__r2-part/*', async (route) => {
    const partNumber = Number(new URL(route.request().url()).pathname.split('/').pop());

    if (options.failOnce?.includes(partNumber) && !failed.has(partNumber)) {
      failed.add(partNumber);
      return route.fulfill({ status: 500, body: 'part rejected' });
    }

    const delay = options.delays?.[partNumber] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    calls.parts.push(partNumber);
    // The ETag is what makes the completion possible, and reading it back is
    // the one thing a real bucket has to be configured to allow.
    return route.fulfill({ status: 200, headers: { ETag: `"etag-${partNumber}"` }, body: '' });
  });

  await page.route('**/api/r2/multipart-complete', (route) => {
    const { parts } = route.request().postDataJSON() as {
      parts: { partNumber: number; etag: string }[];
    };
    calls.completed.push(parts);
    return json(route, { key });
  });

  await page.route('**/api/r2/multipart-abort', (route) => {
    calls.aborted += 1;
    return json(route, { aborted: true });
  });

  await page.route('**/api/r2/presign-download', (route) =>
    json(route, { url: 'https://r2.example.test/large.bin?signature=stub' })
  );

  return calls;
}

async function chooseLargeFile(page: Page, name: string) {
  await page.setInputFiles('#file-input', {
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(FILE_SIZE, 7),
  });
  await expect(page.getByTestId('upload-queue')).toContainText(name);
}

const unfinished = (page: Page) => page.locator('ion-card', { hasText: 'Unfinished uploads' });

test.describe('A large file, in parts', () => {
  test.skip(!supabaseReady, 'needs Supabase credentials in .env');

  /* Twenty megabytes of parts travel through Playwright's interception layer
     rather than a socket, and a hosted runner is slower at that than a laptop
     by a wide margin. The generosity is about the harness, not the feature:
     every assertion below still fails on a wrong answer, just not on a slow
     one. */
  test.describe.configure({ timeout: 90_000 });
  const arrival = { timeout: 45_000 };

  test('goes up in parts and is recorded once', async ({ page }) => {
    const calls = await stubR2(page);
    const name = `e2e-large-${Date.now()}.bin`;

    await page.goto('/upload');
    await chooseLargeFile(page, name);
    await page.locator('ion-button', { hasText: 'Upload' }).click();

    await expect(page).toHaveURL(/\/dashboard$/, arrival);
    await expect(page.locator('.file-list-item', { hasText: name })).toBeVisible(arrival);

    expect(calls.parts.sort()).toEqual([1, 2, 3]);

    // One request of paperwork for the whole file, not one per part.
    expect(calls.signed).toEqual([[1, 2, 3]]);

    // Ascending part numbers, each with the ETag its own response carried:
    // R2 rejects a completion that gets either wrong.
    expect(calls.completed).toHaveLength(1);
    expect(calls.completed[0]).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
  });

  test('survives a pause and a reload, and finishes what is left', async ({ page }) => {
    // Part 1 lands at once; the other two are still in flight when Pause is
    // pressed, which is what leaves a record worth resuming.
    const calls = await stubR2(page, { delays: { 2: 5000, 3: 5000 } });
    const name = `e2e-paused-${Date.now()}.bin`;

    await page.goto('/upload');
    await chooseLargeFile(page, name);
    await page.locator('ion-button', { hasText: 'Upload' }).click();

    await page.waitForRequest((request) => request.url().includes('/__r2-part/1'));
    await page.locator('ion-button', { hasText: 'Pause' }).click();

    // The state is now per file, in the queue row rather than in one bar.
    await expect(page.locator('.upload-queue-item--paused')).toBeVisible();
    await expect(unfinished(page)).toBeVisible();
    await expect(unfinished(page)).toContainText(`1 of ${PART_COUNT} parts`);

    await test.step('the record outlives the page', async () => {
      // The whole point of keeping it in IndexedDB rather than in memory.
      await page.reload();
      await expect(unfinished(page)).toBeVisible();
      await expect(unfinished(page)).toContainText(name);
    });

    await test.step('resuming sends only what is missing', async () => {
      // The stubs went with the page; the second session gets its own, fast.
      const resumed = await stubR2(page);
      await page.locator('ion-button', { hasText: 'Resume' }).click();

      await expect(page).toHaveURL(/\/dashboard$/, arrival);
      await expect(page.locator('.file-list-item', { hasText: name })).toBeVisible(arrival);

      expect(resumed.signed).toEqual([[2, 3]]);
      expect(resumed.parts.sort()).toEqual([2, 3]);

      // The part from the first session is carried into the completion with
      // the ETag it was given then.
      expect(resumed.completed[0]).toEqual([
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
      ]);
    });

    expect(calls.completed).toHaveLength(0);
  });

  test('discarding releases the parts and clears the record', async ({ page }) => {
    const calls = await stubR2(page, { delays: { 2: 5000, 3: 5000 } });

    await page.goto('/upload');
    await chooseLargeFile(page, `e2e-discard-${Date.now()}.bin`);
    await page.locator('ion-button', { hasText: 'Upload' }).click();

    await page.waitForRequest((request) => request.url().includes('/__r2-part/1'));
    await page.locator('ion-button', { hasText: 'Pause' }).click();
    await expect(unfinished(page)).toBeVisible();

    await page.locator('ion-button', { hasText: 'Discard' }).click();

    // Parts nobody will resume are billable until a lifecycle rule sweeps them,
    // so this has to reach R2 rather than only forgetting the record locally.
    await expect(unfinished(page)).toHaveCount(0);
    expect(calls.aborted).toBe(1);
  });

  test('retries a part the network refused', async ({ page }) => {
    const calls = await stubR2(page, { failOnce: [2] });
    const name = `e2e-retry-${Date.now()}.bin`;

    await page.goto('/upload');
    await chooseLargeFile(page, name);
    await page.locator('ion-button', { hasText: 'Upload' }).click();

    // A failed part is retried on its own — the other two are not sent again,
    // which is the difference between this and retrying the whole upload.
    await expect(page).toHaveURL(/\/dashboard$/, arrival);
    await expect(page.locator('.file-list-item', { hasText: name })).toBeVisible(arrival);
    expect(calls.parts.sort()).toEqual([1, 2, 3]);
    expect(calls.completed[0]).toHaveLength(PART_COUNT);
  });
});
