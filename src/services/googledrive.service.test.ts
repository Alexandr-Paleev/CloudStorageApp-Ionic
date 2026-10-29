import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { getAccessToken, forget } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  forget: vi.fn(),
}));

vi.mock('../supabase/supabase.config', () => ({ supabase: { auth: {} } }));
vi.mock('../observability/sentry', () => ({ captureMessage: vi.fn() }));

vi.mock('./googledrive-auth.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./googledrive-auth.service')>()),
  default: { getAccessToken, forget, isAuthorized: vi.fn() },
}));

import googleDriveService from './googledrive.service';
import { GoogleDriveAuthError } from './googledrive-auth.service';

/** Answers every upload with the status and body a test sets. */
let answer = { status: 200, body: '{"id":"f1","name":"a.txt","webViewLink":"https://drive"}' };

class FakeXhr {
  status = 0;
  responseText = '';
  upload = {};
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  send() {
    this.status = answer.status;
    this.responseText = answer.body;
    queueMicrotask(() => this.onload?.());
  }
}

const file = () => new File(['x'], 'a.txt', { type: 'text/plain' });

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue('ya29.token');
  answer = { status: 200, body: '{"id":"f1","name":"a.txt","webViewLink":"https://drive"}' };
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploading to Drive', () => {
  it('hands back what Google stored', async () => {
    await expect(googleDriveService.uploadFile(file())).resolves.toMatchObject({ id: 'f1' });
  });

  /* An ended or revoked token: forgotten, so the page offers to connect
     again rather than sending it once more. */
  it('lets go of a token Google refuses, and asks for Drive to be connected again', async () => {
    answer = { status: 401, body: '{"error":{"code":401,"message":"Invalid Credentials"}}' };

    await expect(googleDriveService.uploadFile(file())).rejects.toBeInstanceOf(
      GoogleDriveAuthError
    );
    expect(forget).toHaveBeenCalled();
  });

  /* The whole JSON used to be the message on the screen. */
  it("says Google's reason in words", async () => {
    answer = {
      status: 403,
      body: '{"error":{"code":403,"message":"The user has exceeded their Drive storage quota"}}',
    };

    await expect(googleDriveService.uploadFile(file())).rejects.toThrow(
      'Google Drive upload failed: The user has exceeded their Drive storage quota'
    );
    expect(forget).not.toHaveBeenCalled();
  });

  it('asks for Drive to be connected when there is no token', async () => {
    getAccessToken.mockResolvedValue(null);
    await expect(googleDriveService.uploadFile(file())).rejects.toBeInstanceOf(
      GoogleDriveAuthError
    );
  });
});

describe('deleting from Drive', () => {
  const answering = (status: number) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

  it('deletes', async () => {
    answering(204);
    await expect(googleDriveService.deleteFile('f1')).resolves.toBeUndefined();
  });

  /* Deleted in Drive itself, or by an attempt whose answer never came back.
     Thrown, it kept the row for good: the row goes only after the provider
     says yes. */
  it('takes a file that is already gone as deleted', async () => {
    answering(404);
    await expect(googleDriveService.deleteFile('f1')).resolves.toBeUndefined();
  });

  it('lets go of a token Google refuses', async () => {
    answering(401);
    await expect(googleDriveService.deleteFile('f1')).rejects.toBeInstanceOf(GoogleDriveAuthError);
    expect(forget).toHaveBeenCalled();
  });

  it('fails on anything else', async () => {
    answering(500);
    await expect(googleDriveService.deleteFile('f1')).rejects.toThrow(
      'Failed to delete file from Google Drive'
    );
  });
});
