import { describe, it, expect, beforeEach, vi } from 'vitest';

const { deleteByPrefix } = vi.hoisted(() => ({ deleteByPrefix: vi.fn() }));

vi.mock('cloudinary', () => ({
  v2: { config: vi.fn(), api: { delete_resources_by_prefix: deleteByPrefix } },
}));

import { configuredProviders } from './erase-providers';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = 'cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
});

function eraseCloudinary(userId: string): Promise<void> {
  const { eraseCloudinary } = configuredProviders();
  if (!eraseCloudinary) throw new Error('Cloudinary should count as configured here');
  return eraseCloudinary(userId);
}

describe('erasing an account from Cloudinary', () => {
  /* Cloudinary deletes at most 1000 assets a call and says `partial` when it
     stopped there. The erase used to take the first answer as the last. */
  it('keeps going past the first thousand assets, from where the last call stopped', async () => {
    deleteByPrefix
      .mockResolvedValueOnce({ partial: true, next_cursor: 'cursor-1' })
      .mockResolvedValueOnce({ partial: true, next_cursor: 'cursor-2' })
      .mockResolvedValueOnce({ partial: false })
      .mockResolvedValueOnce({ partial: false });

    await eraseCloudinary('u1');

    expect(deleteByPrefix.mock.calls).toEqual([
      ['users/u1/', { resource_type: 'image', next_cursor: undefined }],
      ['users/u1/', { resource_type: 'image', next_cursor: 'cursor-1' }],
      ['users/u1/', { resource_type: 'image', next_cursor: 'cursor-2' }],
      ['users/u1/', { resource_type: 'raw', next_cursor: undefined }],
    ]);
  });

  it('asks once per type when one answer covers everything', async () => {
    deleteByPrefix.mockResolvedValue({ partial: false });

    await eraseCloudinary('u1');

    expect(deleteByPrefix).toHaveBeenCalledTimes(2);
  });

  /* Asked again with nothing to continue from, a partial answer would repeat
     until the function timed out, and the account deletion with it. */
  it('stops at a partial answer that brings no cursor', async () => {
    deleteByPrefix.mockResolvedValue({ partial: true });

    await eraseCloudinary('u1');

    expect(deleteByPrefix).toHaveBeenCalledTimes(2);
  });
});
