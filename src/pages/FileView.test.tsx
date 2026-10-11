import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import FileView from './FileView';
import { renderWithProviders } from '../test/utils';

/**
 * Sharing, renaming and deleting — the three things this page does to a file
 * that outlive the visit.
 *
 * The share link is the one worth the most care. This page used to hand out
 * `download_url` directly, which is either permanent and unrevocable
 * (Cloudinary, Dropbox) or dead in an hour (R2, Supabase Storage); a share link
 * expires on a schedule its owner can cut short. None of that was tested.
 */

const {
  getFileMetadata,
  renameFile,
  createLink,
  listLinks,
  revokeLink,
  runOrQueue,
  navigate,
  offerSystemShare,
} = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  renameFile: vi.fn(),
  createLink: vi.fn(),
  listLinks: vi.fn(),
  revokeLink: vi.fn(),
  runOrQueue: vi.fn(),
  navigate: vi.fn(),
  offerSystemShare: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'someone@example.com' } }),
}));

vi.mock('../services/storage.service', () => ({
  default: {
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    renameFile: (...a: unknown[]) => renameFile(...a),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/share.service', () => ({
  default: {
    createLink: (...a: unknown[]) => createLink(...a),
    listLinks: (...a: unknown[]) => listLinks(...a),
    revokeLink: (...a: unknown[]) => revokeLink(...a),
  },
}));

vi.mock('../hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    ops: [],
    pending: 0,
    flush: vi.fn(),
    runOrQueue: (...a: unknown[]) => runOrQueue(...a),
    lastResult: null,
  }),
}));

vi.mock('../native/shell', () => ({
  offerSystemShare: (...a: unknown[]) => offerSystemShare(...a),
  warnFeedback: vi.fn(),
  tapFeedback: vi.fn(),
  isNative: () => false,
  syncStatusBarStyle: vi.fn(),
  setStatusBarForDarkBackground: vi.fn(),
  initNativeShell: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigate, useParams: () => ({ fileId: 'file-1' }) };
});

const FILE = {
  id: 'file-1',
  name: 'report.pdf',
  size: 2048,
  type: 'application/pdf',
  download_url: 'https://cdn.example.com/report.pdf',
  storage_type: 'r2',
  created_at: '2026-09-01T00:00:00Z',
};

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<FileView />} />
    </Routes>
  );
}

function ionButtonByLabel(label: string): HTMLElement {
  return document.querySelector(`ion-button[aria-label="${label}"]`) as HTMLElement;
}

function ionButtonByText(text: string): HTMLElement {
  return [...document.querySelectorAll('ion-button')].find((b) =>
    (b.textContent ?? '').includes(text)
  ) as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getFileMetadata.mockResolvedValue(FILE);
  createLink.mockResolvedValue({ url: 'https://app.example.com/s/tok', expiresAt: '2026-09-08' });
  listLinks.mockResolvedValue([]);
  revokeLink.mockResolvedValue(undefined);
  runOrQueue.mockImplementation((_op: unknown, run: () => Promise<unknown>) => run());
  offerSystemShare.mockResolvedValue(false);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('FileView', () => {
  it('shows the file it was asked for', async () => {
    show();
    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(getFileMetadata).toHaveBeenCalledWith('file-1', 'user-1');
  });

  /* Drive and Dropbox store the provider's own viewer, not the file: as an
     <img> it is a broken image and as a frame it is refused. */
  describe('a file kept in Google Drive or Dropbox', () => {
    const drive = {
      ...FILE,
      storage_type: 'googledrive',
      download_url: 'https://drive.google.com/file/d/abc/view',
    };

    it('opens where it lives instead of a preview that cannot load', async () => {
      getFileMetadata.mockResolvedValue(drive);
      show();
      expect(await screen.findByText('Kept in Google Drive')).toBeInTheDocument();
      expect(document.querySelector('iframe, img.preview-image')).toBeNull();

      const open = ionButtonByText('Open in Google Drive');
      expect(open).toBeTruthy();
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);
      fireEvent.click(open);
      expect(opened).toHaveBeenCalledWith(drive.download_url, '_blank');
      opened.mockRestore();
    });

    it('offers no share link for a Drive file, and says where to share it', async () => {
      getFileMetadata.mockResolvedValue(drive);
      show();
      await screen.findByText('Kept in Google Drive');

      expect(ionButtonByText('Copy Link')).toBeUndefined();
      expect(ionButtonByText('Share')).toBeUndefined();
      expect(screen.getByText(/Share it from Google Drive/)).toBeInTheDocument();
    });

    it('still offers a share link for a Dropbox file', async () => {
      getFileMetadata.mockResolvedValue({ ...FILE, storage_type: 'dropbox' });
      show();
      expect(await screen.findByText('Kept in Dropbox')).toBeInTheDocument();
      expect(ionButtonByText('Copy Link')).toBeTruthy();
    });
  });

  describe('sharing', () => {
    /* Never download_url: that is either permanent and unrevocable or dead in
       an hour, depending on which provider the file happens to be on. */
    it('mints a share link rather than handing out the download URL', async () => {
      show();
      await screen.findByText('report.pdf');

      fireEvent.click(ionButtonByText('Copy Link') ?? ionButtonByLabel('Copy link'));

      await waitFor(() => expect(createLink).toHaveBeenCalledWith('file-1'));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://app.example.com/s/tok');
      expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(FILE.download_url);
    });

    /* One link per visit. Pressing Copy twice must not leave two live tokens
       for the same file, each of which would then have to be revoked. */
    it('reuses the link it already made instead of minting a second', async () => {
      show();
      await screen.findByText('report.pdf');

      const copy = ionButtonByText('Copy Link') ?? ionButtonByLabel('Copy link');
      fireEvent.click(copy);
      await waitFor(() => expect(createLink).toHaveBeenCalledTimes(1));

      fireEvent.click(copy);
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
      expect(createLink).toHaveBeenCalledTimes(1);
    });

    /* The link is kept for the visit, and the list under the buttons is where
       a link is taken back. The two were never told about each other. After a
       revoke the page went on copying and sharing the link it held, said it
       expires in 7 days, and what its owner sent on opened "This link has
       been revoked". Only a reload led to a new one. */
    it('makes a new link once the one it made has been revoked', async () => {
      const addresses = ['https://app.example.com/s/first', 'https://app.example.com/s/second'];
      createLink.mockImplementation(async () => ({
        url: addresses[createLink.mock.calls.length - 1],
        expiresAt: '2026-09-08',
      }));

      const made = {
        id: 'link-1',
        created_at: '2026-09-01T00:00:00Z',
        expires_at: '2099-01-01T00:00:00Z',
        revoked_at: null as string | null,
      };
      listLinks.mockImplementation(async () => [{ ...made }]);
      revokeLink.mockImplementation(async () => {
        made.revoked_at = '2026-09-02T00:00:00Z';
      });

      show();
      await screen.findByText('report.pdf');
      const copy = ionButtonByText('Copy Link');

      fireEvent.click(copy);
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
          'https://app.example.com/s/first'
        )
      );

      fireEvent.click(await screen.findByText('Revoke'));
      await waitFor(() => expect(revokeLink).toHaveBeenCalledWith('link-1'));
      await screen.findByText('Revoked');

      fireEvent.click(copy);
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
          'https://app.example.com/s/second'
        )
      );
      expect(createLink).toHaveBeenCalledTimes(2);
    });

    it('says why when the link cannot be made, and copies nothing', async () => {
      createLink.mockRejectedValue(new Error('Too many links for this file'));

      show();
      await screen.findByText('report.pdf');
      fireEvent.click(ionButtonByText('Copy Link') ?? ionButtonByLabel('Copy link'));

      await waitFor(() => expect(createLink).toHaveBeenCalled());
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  /* Both of these open an IonModal, whose children Ionic mounts through its own
     runtime — which does not run under jsdom, so the field and the confirm
     button are not in the DOM to be driven. What a unit test can honestly say
     is that neither action happens on the tap that opens the sheet; the rest of
     both journeys is covered against a real browser in
     e2e/file-lifecycle.spec.ts, which uploads, renames and deletes one file. */
  function openModal(): (HTMLElement & { isOpen?: boolean }) | undefined {
    return [...document.querySelectorAll('ion-modal')].find(
      (m) => (m as HTMLElement & { isOpen?: boolean }).isOpen
    ) as HTMLElement & { isOpen?: boolean };
  }

  describe('renaming', () => {
    it('opens the rename sheet rather than renaming on the tap', async () => {
      show();
      await screen.findByText('report.pdf');

      fireEvent.click(ionButtonByText('Rename'));

      await waitFor(() => expect(openModal()).toBeTruthy());
      expect(runOrQueue).not.toHaveBeenCalled();
      expect(renameFile).not.toHaveBeenCalled();
    });
  });

  describe('deleting', () => {
    /* Permanent, and there is no trash. */
    it('asks before it deletes', async () => {
      show();
      await screen.findByText('report.pdf');

      fireEvent.click(ionButtonByText('Delete'));

      await waitFor(() => expect(openModal()).toBeTruthy());
      expect(runOrQueue).not.toHaveBeenCalled();
    });
  });
});
