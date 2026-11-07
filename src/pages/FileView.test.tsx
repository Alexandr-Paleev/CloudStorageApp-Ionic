import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import FileView from './FileView';
import { renderWithProviders } from '../test/utils';
import { whereHotjarWouldRead } from '../test/hotjar';
import { whereSentryWouldRead } from '../test/sentry';
import { overlay, overlays, press } from '../test/overlays';
import { GoogleDriveAuthError } from '../services/googledrive-auth.service';

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
  deleteFile,
  forgetFile,
  createLink,
  listLinks,
  revokeLink,
  runOrQueue,
  navigate,
  offerSystemShare,
  authorize,
} = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  renameFile: vi.fn(),
  deleteFile: vi.fn(),
  forgetFile: vi.fn(),
  createLink: vi.fn(),
  listLinks: vi.fn(),
  revokeLink: vi.fn(),
  runOrQueue: vi.fn(),
  navigate: vi.fn(),
  offerSystemShare: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'someone@example.com' } }),
}));

vi.mock('../services/storage.service', () => ({
  default: {
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    renameFile: (...a: unknown[]) => renameFile(...a),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    forgetFile: (...a: unknown[]) => forgetFile(...a),
  },
}));

/* Google's window, answered here. The rest of the module is the real one. */
vi.mock('../services/googledrive-auth.service', async (importActual) => ({
  ...(await importActual<typeof import('../services/googledrive-auth.service')>()),
  default: { authorize: () => authorize() },
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

/* The real frame, sent nowhere: jsdom does not navigate one. PdfFrame.test.tsx
   says where it goes. */
vi.mock('../components/PdfFrame', async (importOriginal) => {
  const { createElement } = await vi.importActual<typeof import('react')>('react');
  const { default: PdfFrame } = await importOriginal<typeof import('../components/PdfFrame')>();
  return {
    default: (props: { url: string }) => createElement(PdfFrame, { ...props, open: () => {} }),
  };
});

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
  deleteFile.mockResolvedValue(undefined);
  forgetFile.mockResolvedValue(undefined);
  authorize.mockResolvedValue('drive-token');
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
  /**
   * A button inside the sheet that is open.
   *
   * Ionic React renders what is inside a modal only once the modal says it is
   * about to appear, which an element that never upgrades does not: the event
   * is sent here instead, as test/overlays.ts does for the others.
   */
  function modalButton(text: string): HTMLElement {
    const modal = openModal()!;
    fireEvent(modal, new CustomEvent('willPresent'));
    return [...modal.querySelectorAll('ion-button')].find((b) =>
      (b.textContent ?? '').includes(text)
    ) as HTMLElement;
  }

  /** The toast that says a deletion or a rename did not happen. */
  function failureToast() {
    return overlays('ion-toast').find(
      (t) => t.message === 'Failed to delete' || t.message === 'Failed to rename'
    );
  }

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

    /* A Drive token lasts an hour. Past it this page said "Failed to delete",
       and the file could not be deleted from anywhere but the upload page,
       once Drive was connected there again. */
    describe('a file in Google Drive, with Drive not connected any more', () => {
      const driveDialog = () => overlay('ion-alert', 'Google Drive is not connected');

      async function deleteIt() {
        getFileMetadata.mockResolvedValue(IN_DRIVE);
        deleteFile.mockRejectedValueOnce(new GoogleDriveAuthError('Google Drive is not connected'));
        show();
        await screen.findByText('notes.txt');

        fireEvent.click(ionButtonByText('Delete'));
        await waitFor(() => expect(openModal()).toBeTruthy());
        fireEvent.click(modalButton('Delete'));
        await waitFor(() => expect(driveDialog().isOpen).toBe(true));
      }

      const IN_DRIVE = {
        ...FILE,
        name: 'notes.txt',
        type: 'text/plain',
        storage_type: 'googledrive',
        download_url: 'https://drive.google.com/file/d/abc/view',
      };

      it('asks what to do, and shows no failure', async () => {
        await deleteIt();

        expect(failureToast()?.isOpen).toBe(false);
        expect(navigate).not.toHaveBeenCalled();
      });

      it('connects Drive from the press, then deletes it there', async () => {
        await deleteIt();

        press(driveDialog(), 'Connect Drive');

        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(deleteFile).toHaveBeenCalledTimes(2);
      });

      it('takes it off the list and leaves it in Drive, then goes back to the files', async () => {
        await deleteIt();

        press(driveDialog(), 'Remove from list');

        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
        expect(forgetFile).toHaveBeenCalledWith('file-1', 'user-1');
        expect(deleteFile).toHaveBeenCalledTimes(1);
      });

      it('says why when Drive was not connected after all, and stays', async () => {
        authorize.mockRejectedValue(new Error('Google Drive was not connected'));
        await deleteIt();

        press(driveDialog(), 'Connect Drive');

        await waitFor(() =>
          expect(
            overlays('ion-toast').some((t) => t.message === 'Google Drive was not connected')
          ).toBe(true)
        );
        expect(deleteFile).toHaveBeenCalledTimes(1);
        expect(navigate).not.toHaveBeenCalled();
      });
    });

    it('still says a deletion failed when the reason is anything else', async () => {
      deleteFile.mockRejectedValueOnce(
        new Error('Failed to delete file from storage: R2 unreachable')
      );
      show();
      await screen.findByText('report.pdf');

      fireEvent.click(ionButtonByText('Delete'));
      await waitFor(() => expect(openModal()).toBeTruthy());
      fireEvent.click(modalButton('Delete'));

      await waitFor(() => expect(failureToast()?.isOpen).toBe(true));
      expect(overlay('ion-alert', 'Google Drive is not connected').isOpen).toBe(false);
    });
  });
});

describe('FileView and what Hotjar may record', () => {
  it('leaves out the name and the file itself', async () => {
    show();
    await screen.findByText('report.pdf');

    expect(document.querySelector('ion-title')).toHaveAttribute('data-hj-suppress');
    expect(document.querySelector('.preview-area')).toHaveAttribute('data-hj-suppress');
  });

  /* The frame of a PDF is where the file's address would have been an
     attribute, and the address carries the name, and on R2 and Supabase
     Storage a signature. */
  it('shows it neither the name nor the address of the file', async () => {
    show();
    await screen.findByText('report.pdf');

    expect(document.querySelector('iframe.preview-pdf-frame')).not.toBeNull();
    expect(whereHotjarWouldRead('report.pdf')).toEqual([]);
    expect(whereHotjarWouldRead('cdn.example.com')).toEqual([]);
  });
});

/* Sentry sends the last taps with an error, each described by the element
   tapped: the alt of a picture among what it says. */
describe('FileView and what Sentry may be told', () => {
  it('describes no tap on a document by its name', async () => {
    show();
    await screen.findByText('report.pdf');

    expect(whereSentryWouldRead('report.pdf')).toEqual([]);
  });

  /* A HEIC photo in a browser that cannot show one, or a broken file: every
     new signature was a full download of a picture that would not load, for
     as long as the page stayed open. One more try is for a signature that ran
     out; the second failure is the picture. */
  it('asks once more for a picture that will not load, then shows no preview', async () => {
    getFileMetadata.mockResolvedValue({
      ...FILE,
      name: 'photo.heic',
      type: 'image/heic',
      download_url: 'https://cdn.example.com/photo.heic',
    });
    show();

    fireEvent.error(await screen.findByRole('img', { name: 'photo.heic' }));
    await waitFor(() => expect(getFileMetadata).toHaveBeenCalledTimes(2));

    fireEvent.error(await screen.findByRole('img', { name: 'photo.heic' }));
    expect(await screen.findByText('No preview')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'photo.heic' })).not.toBeInTheDocument();
    expect(getFileMetadata).toHaveBeenCalledTimes(2);
  });

  it('describes no tap on a picture by its name, which still names the picture', async () => {
    getFileMetadata.mockResolvedValue({
      ...FILE,
      name: 'sky.jpg',
      type: 'image/jpeg',
      download_url: 'https://cdn.example.com/sky.jpg',
    });
    show();

    expect(await screen.findByRole('img', { name: 'sky.jpg' })).toHaveClass('preview-image');
    expect(whereSentryWouldRead('sky.jpg')).toEqual([]);
  });
});
