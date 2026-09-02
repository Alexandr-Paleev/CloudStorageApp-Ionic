import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CloudinaryProvider } from './CloudinaryProvider';
import cloudinaryService from '../../services/cloudinary.service';

vi.mock('../../services/cloudinary.service', () => ({
  default: { deleteFile: vi.fn(), isConfigured: () => true, uploadFile: vi.fn() },
}));

const provider = new CloudinaryProvider();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deleting an asset', () => {
  it('asks for an image by the public_id Cloudinary kept — without the extension', () => {
    provider.delete('users/user-1/photo.png', { type: 'image/png', name: 'photo.png' });

    expect(cloudinaryService.deleteFile).toHaveBeenCalledWith('users/user-1/photo', undefined);
  });

  it('leaves a public_id alone when it never had an extension', () => {
    provider.delete('users/user-1/photo', { type: 'image/jpeg', name: 'photo.jpg' });

    expect(cloudinaryService.deleteFile).toHaveBeenCalledWith('users/user-1/photo', undefined);
  });

  it.each([
    ['report.pdf', 'application/pdf'],
    ['notes.txt', 'text/plain'],
    ['archive.zip', 'application/zip'],
  ])('deletes %s from the raw endpoint, keeping its extension', (name, type) => {
    // The other half of resourceTypeFor() in api/cloudinary/[action].ts. It
    // used to ask "is this a PDF", so a .txt took the image branch, had its
    // extension stripped and was never found: the row disappeared and the
    // asset stayed in the account, no longer counted against anyone's quota.
    provider.delete(`users/user-1/${name}`, { type, name });

    expect(cloudinaryService.deleteFile).toHaveBeenCalledWith(`users/user-1/${name}`, 'raw');
  });

  it('treats a file of unknown type as raw rather than guessing image', () => {
    provider.delete('users/user-1/mystery.bin', {});

    expect(cloudinaryService.deleteFile).toHaveBeenCalledWith('users/user-1/mystery.bin', 'raw');
  });
});
