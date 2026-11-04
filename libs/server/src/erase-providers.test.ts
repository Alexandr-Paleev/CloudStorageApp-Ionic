import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { deleteByPrefix, deleteCustomer } = vi.hoisted(() => ({
  deleteByPrefix: vi.fn(),
  deleteCustomer: vi.fn(),
}));

vi.mock('cloudinary', () => ({
  v2: { config: vi.fn(), api: { delete_resources_by_prefix: deleteByPrefix } },
}));

vi.mock('stripe', () => ({
  default: class {
    customers = { del: deleteCustomer };
  },
}));

import { configuredProviders } from './erase-providers';
import { BillingNotClosed } from './account-erase';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = 'cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
});

afterEach(() => {
  vi.unstubAllEnvs();
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
      .mockResolvedValueOnce({ partial: false })
      .mockResolvedValueOnce({ partial: false });

    await eraseCloudinary('u1');

    expect(deleteByPrefix.mock.calls).toEqual([
      ['users/u1/', { resource_type: 'image', next_cursor: undefined }],
      ['users/u1/', { resource_type: 'image', next_cursor: 'cursor-1' }],
      ['users/u1/', { resource_type: 'image', next_cursor: 'cursor-2' }],
      ['users/u1/', { resource_type: 'raw', next_cursor: undefined }],
      ['users/u1/', { resource_type: 'video', next_cursor: undefined }],
    ]);
  });

  /* The endpoint is in the address an upload is sent to, not in what is
     signed, so an upload signed for a raw file can land as a video. */
  it('asks once per type when one answer covers everything, videos included', async () => {
    deleteByPrefix.mockResolvedValue({ partial: false });

    await eraseCloudinary('u1');

    expect(deleteByPrefix.mock.calls.map(([, options]) => options.resource_type)).toEqual([
      'image',
      'raw',
      'video',
    ]);
  });

  /* Asked again with nothing to continue from, a partial answer would repeat
     until the function timed out, and the account deletion with it. */
  it('stops at a partial answer that brings no cursor', async () => {
    deleteByPrefix.mockResolvedValue({ partial: true });

    await eraseCloudinary('u1');

    expect(deleteByPrefix).toHaveBeenCalledTimes(3);
  });
});

describe('closing what an account pays for', () => {
  function closeBilling(customerId: string): Promise<void> {
    const { closeBilling } = configuredProviders();
    if (!closeBilling) throw new Error('billing should count as configured here');
    return closeBilling(customerId);
  }

  it('is not offered where there is no key to reach Stripe', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    expect(configuredProviders().closeBilling).toBeUndefined();
  });

  it('deletes the customer, which ends its subscriptions at once', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_key');
    deleteCustomer.mockResolvedValue({ id: 'cus_123', deleted: true });

    await closeBilling('cus_123');

    expect(deleteCustomer).toHaveBeenCalledWith('cus_123');
  });

  /* An erase that failed after Stripe had answered leaves an account with no
     customer behind it. Asking again has to get through. */
  it('takes a customer already gone for closed', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_key');
    deleteCustomer.mockRejectedValue(
      Object.assign(new Error('No such customer'), { code: 'resource_missing' })
    );

    await expect(closeBilling('cus_123')).resolves.toBeUndefined();
  });

  it('refuses with 502 when Stripe would not do it', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_key');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deleteCustomer.mockRejectedValue(new Error('api.stripe.com unreachable'));

    const refusal = await closeBilling('cus_123').catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(BillingNotClosed);
    expect(refusal).toMatchObject({
      status: 502,
      message: expect.stringMatching(/nothing was deleted/),
    });
  });
});
