import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import Upload from './Upload';
import { renderWithProviders } from '../test/utils';

/**
 * The queue, not the markup.
 *
 * `Upload.tsx` was the largest untested file in the repository — 156 statements
 * and the only place a failure has to be survivable rather than fatal, because
 * one file the plan will not take must not strand the nine behind it. Every
 * test here is about what the loop does when something goes wrong halfway.
 */

const { uploadFile, navigate, profile, trackFileUpload } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  navigate: vi.fn(),
  profile: {
    profile: { tier: 'free', storage_limit: 500 * 1024 * 1024, allowed_providers: ['r2'] },
  },
  trackFileUpload: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'someone@example.com' } }),
}));

vi.mock('../services/storage.service', () => ({
  default: {
    uploadFile: (...args: unknown[]) => uploadFile(...args),
    getUserStorageSize: vi.fn().mockResolvedValue(0),
    listPendingUploads: vi.fn().mockResolvedValue([]),
    resumeUpload: vi.fn(),
    discardPendingUpload: vi.fn(),
  },
}));

vi.mock('../services/googledrive-auth.service', () => ({
  default: { isAuthorized: vi.fn().mockResolvedValue(false), authorize: vi.fn() },
}));

vi.mock('../hooks/useProfile', () => ({ useProfile: () => profile }));

vi.mock('../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackFileUpload, trackEvent: vi.fn(), trackError: vi.fn() }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate, useParams: () => ({}) };
});

function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Upload />} />
    </Routes>
  );
}

/** The picker is hidden and driven by its change event, as the page drives it. */
function choose(...names: string[]) {
  const input = document.querySelector('#file-input') as HTMLInputElement;
  const files = names.map((name) => new File(['x'], name, { type: 'text/plain' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

function uploadButton(): HTMLElement & { disabled?: boolean } {
  return [...document.querySelectorAll('ion-button')].find((b) =>
    /^Upload/.test(b.textContent ?? '')
  ) as HTMLElement & { disabled?: boolean };
}

/** Ionic controls render as custom elements with no implicit ARIA role, so the
 *  remove button is reached by the label it sets rather than by role. */
function removeButton(name: string): HTMLElement {
  return document.querySelector(`ion-button[aria-label="Remove ${name}"]`) as HTMLElement;
}

function landed(storage_type = 'r2') {
  return { id: crypto.randomUUID(), storage_type, name: 'x', size: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  profile.profile = { tier: 'free', storage_limit: 500 * 1024 * 1024, allowed_providers: ['r2'] };
  uploadFile.mockResolvedValue(landed());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Upload', () => {
  it('queues every file the picker hands it, and says how many will go', async () => {
    show();
    choose('a.txt', 'b.txt', 'c.txt');

    const queue = await screen.findByTestId('upload-queue');
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      expect(within(queue).getByText(name)).toBeInTheDocument();
    }
    expect(uploadButton().textContent).toContain('Upload 3 files');
  });

  /* Sequential on purpose: parallel uploads race for the same quota, the
     trigger serialises them anyway, and the loser gets a 413. */
  it('sends them one at a time, not all at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    uploadFile.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return landed();
    });

    show();
    choose('a.txt', 'b.txt', 'c.txt');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(3));
    expect(maxInFlight).toBe(1);
  });

  /* The reason this page has a queue at all. */
  it('keeps going after a file is refused, and leaves the failure on screen', async () => {
    uploadFile
      .mockResolvedValueOnce(landed())
      .mockRejectedValueOnce(new Error('File exceeds the storage limit'))
      .mockResolvedValueOnce(landed());

    show();
    choose('first.txt', 'refused.txt', 'third.txt');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(/File exceeds the storage limit/)).toBeInTheDocument();
  });

  /* Leaving would hide the failure it belongs to. */
  it('does not navigate away while a file has failed', async () => {
    uploadFile.mockRejectedValue(new Error('provider unavailable'));

    show();
    choose('a.txt');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/provider unavailable/)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes back to the dashboard once every file landed', async () => {
    show();
    choose('a.txt', 'b.txt');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
  });

  /* Pausing raises like a failure and is not one: it stops the queue instead
     of marking the file broken and moving to the next. */
  it('stops the whole queue when an upload is paused, without failing it', async () => {
    const paused = Object.assign(new Error('paused'), { name: 'UploadPausedError' });
    uploadFile.mockRejectedValueOnce(paused).mockResolvedValue(landed());

    show();
    choose('a.txt', 'b.txt', 'c.txt');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(screen.getByText(/paused/)).toBeInTheDocument());
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports the provider a file actually landed on, not the one it asked for', async () => {
    uploadFile.mockResolvedValue(landed('cloudinary'));

    show();
    choose('photo.png');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(trackFileUpload).toHaveBeenCalled());
    expect(trackFileUpload.mock.calls[0][0]).toMatchObject({ storage_provider: 'cloudinary' });
  });

  it('hands the profile limits down to the service rather than deciding itself', async () => {
    profile.profile = {
      tier: 'pro',
      storage_limit: 5 * 1024 ** 3,
      allowed_providers: ['r2', 'dropbox'],
    };

    show();
    choose('a.txt');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    expect(uploadFile.mock.calls[0][5]).toMatchObject({
      allowedProviders: ['r2', 'dropbox'],
      storageLimit: 5 * 1024 ** 3,
    });
  });

  it('has nothing to send until something is chosen', () => {
    show();
    expect(uploadButton().disabled).toBe(true);
  });

  /* A file that has not started can be taken out; one mid-flight cannot, or an
     upload would keep running for a row nobody can see. */
  it('lets a waiting file be removed before the queue starts', async () => {
    show();
    choose('keep.txt', 'drop.txt');

    fireEvent.click(removeButton('drop.txt'));

    await waitFor(() => expect(screen.queryByText('drop.txt')).not.toBeInTheDocument());
    expect(screen.getByText('keep.txt')).toBeInTheDocument();
  });
});
