import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import Dashboard from './Dashboard';
import { renderWithProviders } from '../test/utils';
import { overlay, overlays, press } from '../test/overlays';

/**
 * The quota arithmetic, the delete path and what the screen says when a
 * mutation fails: the page's half of each.
 *
 * Not the markup, and not the data. The parts the page is drawn with are
 * components tested beside them in src/components/, for what each shows and
 * which way each of its buttons leads. The hooks the page takes its data from
 * are tested beside them in src/hooks/, for what each decides on its own:
 * which changes go through the offline queue, and what each one makes stale.
 * This file holds the page to putting the two together. The meter reads the
 * limit the profile carries, a delete asks first and then goes through the
 * queue, and a change that fails says so on screen.
 */

const { getItems, deleteFile, createFolder, getUserStorageSize, profile, runOrQueue, ops } =
  vi.hoisted(() => ({
    getItems: vi.fn(),
    deleteFile: vi.fn(),
    createFolder: vi.fn(),
    getUserStorageSize: vi.fn(),
    profile: { profile: undefined as unknown },
    runOrQueue: vi.fn(),
    ops: [] as unknown[],
  }));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'someone@example.com' } }),
}));

vi.mock('../services/storage.service', () => ({
  default: {
    getItems: (...a: unknown[]) => getItems(...a),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    createFolder: (...a: unknown[]) => createFolder(...a),
    getUserStorageSize: (...a: unknown[]) => getUserStorageSize(...a),
    getFolder: vi.fn().mockResolvedValue(null),
    getFolderPath: vi.fn().mockResolvedValue([]),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
  },
}));

/* The queue lives above the pages in a provider, so the hook is what the page
   reaches for — not a module. Mocked rather than wrapped, because the subject
   here is what the page asks of it. */
vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    ops,
    pending: ops.length,
    flush: vi.fn(),
    runOrQueue: (...a: unknown[]) => runOrQueue(...a),
    lastResult: null,
  }),
}));

vi.mock('../services/mutation-queue', async () => {
  const actual = await vi.importActual<typeof import('../services/mutation-queue')>(
    '../services/mutation-queue'
  );
  return { ...actual };
});

vi.mock('../hooks/useProfile', () => ({ useProfile: () => profile }));
vi.mock('../services/auth.service', () => ({ authService: { logout: vi.fn() } }));

const MB = 1024 * 1024;

function show(route = '/') {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/dashboard/:folderId" element={<Dashboard />} />
    </Routes>,
    { route }
  );
}

function ionButtonByText(text: string): HTMLElement {
  return [...document.querySelectorAll('ion-button')].find((b) =>
    (b.textContent ?? '').includes(text)
  ) as HTMLElement;
}

/** The sentence is assembled from several JSX expressions, so it is several
 *  text nodes and getByText cannot see it whole. */
function storageStats(): string {
  return [...document.querySelectorAll('.storage-stats')].map((n) => n.textContent).join(' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  ops.length = 0;
  profile.profile = { tier: 'free', storage_limit: 500 * MB, allowed_providers: ['r2'] };
  getItems.mockResolvedValue({ files: [], folders: [] });
  getUserStorageSize.mockResolvedValue(0);
  runOrQueue.mockImplementation((_op: unknown, run: () => Promise<unknown>) => run());
});

describe('Dashboard', () => {
  describe('the storage meter', () => {
    it('reports what is used against the limit the profile carries, not a constant', async () => {
      profile.profile = { tier: 'pro', storage_limit: 5 * 1024 * MB, allowed_providers: ['r2'] };
      getUserStorageSize.mockResolvedValue(100 * MB);

      show();
      await waitFor(() => expect(storageStats()).toMatch(/100\.00 MB of 5\.00 GB used/));
    });

    /* The bar is capped; the sentence is not. An account over its limit has to
       be told it is blocked, and by how much. */
    it('says how far over the limit an account is, and that uploads are blocked', async () => {
      getUserStorageSize.mockResolvedValue(600 * MB);

      show();
      await waitFor(() => expect(storageStats()).toMatch(/over the limit, uploads are blocked/));
      expect(storageStats()).toMatch(/100\.00 MB over the limit/);
    });

    it('marks a Pro account as one', async () => {
      profile.profile = { tier: 'pro', storage_limit: 5 * 1024 * MB, allowed_providers: ['r2'] };

      show();
      expect(await screen.findByText('Pro')).toBeInTheDocument();
    });

    /* A profile that has not loaded must not read as an account with no room:
       the free tier's limit is the honest placeholder. */
    it('falls back to the default limit before the profile arrives', async () => {
      profile.profile = undefined;

      show();
      await waitFor(() => expect(storageStats()).toMatch(/of 500\.00 MB used/));
    });
  });

  describe('deleting a file', () => {
    beforeEach(() => {
      getItems.mockResolvedValue({
        files: [{ id: 'f1', name: 'report.pdf', size: 1024, type: 'application/pdf' }],
        folders: [],
      });
    });

    const confirmation = () => overlay('ion-alert', 'Delete File');

    async function tapTheBin() {
      show();
      expect(await screen.findByText('report.pdf')).toBeInTheDocument();
      fireEvent.click(document.querySelector('[aria-label="Delete report.pdf"]') as HTMLElement);

      /* Several alerts live on this page — rename, delete folder, delete file —
         and all of them are in the DOM whether showing or not. The one that
         matters is found by its header, and `isOpen` is a property rather than
         an attribute, as every Ionic prop is. */
      await waitFor(() => expect(confirmation().isOpen).toBe(true));
    }

    /* Deletion is permanent and there is no trash, so the one thing this page
       must never do is delete on a single tap. */
    it('asks before deleting rather than deleting on the tap', async () => {
      await tapTheBin();

      expect(runOrQueue).not.toHaveBeenCalled();
    });

    /* Through the queue, which is what lets a delete survive being offline.
       The alert has no button to click under jsdom, so this calls the handler
       the page gave it: see test/overlays.ts. A real press, in a real browser,
       is in e2e/offline-queue.spec.ts. */
    it('deletes through the queue once the person has said yes', async () => {
      await tapTheBin();
      press(confirmation(), 'Delete');

      await waitFor(() =>
        expect(runOrQueue).toHaveBeenCalledWith(
          { kind: 'deleteFile', fileId: 'f1' },
          expect.any(Function)
        )
      );
      expect(deleteFile).toHaveBeenCalledWith('f1', 'user-1');
      expect(confirmation().isOpen).toBe(false);
    });

    it('deletes nothing when the person says no', async () => {
      await tapTheBin();
      press(confirmation(), 'Cancel');

      expect(confirmation().isOpen).toBe(false);
      expect(runOrQueue).not.toHaveBeenCalled();
    });
  });

  describe('making a folder', () => {
    const newFolder = () => overlay('ion-alert', 'New Folder');

    async function askForAFolder(route?: string) {
      show(route);
      fireEvent.click(ionButtonByText('New Folder'));
      await waitFor(() => expect(newFolder().isOpen).toBe(true));
    }

    it('makes it at the root, under the name that was typed', async () => {
      createFolder.mockResolvedValue({ id: 'new', name: 'Invoices' });

      await askForAFolder();
      press(newFolder(), 'Create', { folderName: 'Invoices' });

      await waitFor(() => expect(createFolder).toHaveBeenCalledWith('user-1', 'Invoices', null));
      expect(newFolder().isOpen).toBe(false);
    });

    it('makes it inside the folder that is open', async () => {
      createFolder.mockResolvedValue({ id: 'new', name: 'Invoices' });

      await askForAFolder('/dashboard/folder-9');
      press(newFolder(), 'Create', { folderName: 'Invoices' });

      await waitFor(() =>
        expect(createFolder).toHaveBeenCalledWith('user-1', 'Invoices', 'folder-9')
      );
    });

    /* This is the test that could not fail. It looked in the DOM for a Create
       button, found none, because an alert has no buttons under jsdom, waited
       two seconds for a call that could not come, and caught its own timeout.
       It asserted nothing, and was green from the day it was written. */
    it('says so when the folder cannot be made, instead of failing silently', async () => {
      createFolder.mockRejectedValue(new Error('Ensure Supabase is configured'));

      await askForAFolder();
      press(newFolder(), 'Create', { folderName: 'Invoices' });

      await waitFor(() => expect(createFolder).toHaveBeenCalled());
      await waitFor(() =>
        expect(overlays('ion-toast').find((toast) => toast.isOpen)?.message).toBe(
          'Ensure Supabase is configured'
        )
      );
    });
  });

  describe('what it asks the server for', () => {
    it('asks for the root folder at the root, and for the folder it is inside otherwise', async () => {
      show('/dashboard/folder-9');

      await waitFor(() => expect(getItems).toHaveBeenCalled());
      expect(getItems.mock.calls[0]![1]).toMatchObject({ folderId: 'folder-9' });
    });

    /* Fifteen at a time is what makes the filters a query rather than a filter
       over whatever happened to be loaded. */
    it('pages in fifteens', async () => {
      show();

      await waitFor(() => expect(getItems).toHaveBeenCalled());
      expect(getItems.mock.calls[0]![1]).toMatchObject({ page: 0, pageSize: 15 });
    });
  });
});
